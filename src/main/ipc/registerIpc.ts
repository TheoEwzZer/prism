import { ipcMain, shell, clipboard, net, type BrowserWindow } from 'electron'
import {
  IPC,
  clampSidebarWidth,
  type SessionData,
  type TabPatch,
  type CreateTabInput,
  type SidebarIntent,
  type UiPersistState,
  type UiSyncState,
  type SiteControlPayload,
  type CommandPalettePayload,
  type TabMenuPayload,
  type HistoryListInput
} from '@shared/types'
import { TabManager } from '../tabs/TabManager'
import { OverlayLayer } from '../overlay/OverlayLayer'
import { FrameCoalescer } from '../utils/scheduler'
import { saveSession, flushSession } from '../persistence/sessionStore'
import {
  recordVisit,
  updateMeta,
  searchHistory,
  listHistory,
  removeEntry,
  removeVisit,
  clearHistory,
  flushHistory
} from '../persistence/historyStore'

// Cache mémoire des suggestions. Deux niveaux : (1) exact — l'utilisateur efface/retape le même
// terme ; (2) préfixe — en tapant `chat`→`chatg`→`chatgp`, on réutilise la liste du plus long
// préfixe déjà connu au lieu de re-solliciter Google. Seules les vraies réponses parsées sont
// mises en cache (jamais les timeouts/erreurs, transitoires).
const SUGGEST_TTL_MS = 5 * 60_000
const SUGGEST_CACHE_MAX = 200
// En-dessous de ce nombre de suggestions réutilisables, le préfixe est jugé trop pauvre (ranking
// trop dégradé) → on préfère un vrai fetch. Borne la perte de qualité du cache de préfixe.
const SUGGEST_MIN_REUSE = 4
const suggestCache = new Map<string, { value: string[]; expiry: number }>()

/** Normalisation pour la comparaison de préfixe : minuscule + sans espaces (`chat gpt`≈`chatgpt`). */
function normSuggest(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

function cacheSuggest(key: string, value: string[]): void {
  suggestCache.set(key, { value, expiry: Date.now() + SUGGEST_TTL_MS })
  if (suggestCache.size > SUGGEST_CACHE_MAX) {
    const oldest = suggestCache.keys().next().value // Map = ordre d'insertion
    if (oldest !== undefined) suggestCache.delete(oldest)
  }
}

/**
 * Cherche le PLUS LONG préfixe caché (non expiré) de `q`, puis filtre ses suggestions à celles
 * encore pertinentes pour `q` (préfixe insensible aux espaces). Retourne null si aucun préfixe
 * ou trop peu de résultats réutilisables (on refera alors un vrai fetch).
 */
function prefixCacheHit(q: string): string[] | null {
  const nq = normSuggest(q)
  const now = Date.now()
  let best: { len: number; value: string[] } | null = null
  for (const [key, entry] of suggestCache) {
    if (entry.expiry <= now) continue
    const nk = normSuggest(key)
    if (nk.length < nq.length && nq.startsWith(nk) && (!best || key.length > best.len)) {
      best = { len: key.length, value: entry.value }
    }
  }
  if (!best) return null
  const filtered = best.value.filter((s) => normSuggest(s).startsWith(nq))
  return filtered.length >= SUGGEST_MIN_REUSE ? filtered.slice(0, 8) : null
}

/** Requête réseau réelle vers Google Suggest (+ mise en cache de la réponse parsée). */
function networkFetch(q: string, key: string): Promise<string[]> {
  return new Promise((resolve) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=fr&q=${encodeURIComponent(q)}`
    let body = ''
    let settled = false
    // `cache` = true seulement pour une vraie réponse parsée (pas les timeouts/erreurs).
    const finish = (val: string[], cache = false): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (cache) cacheSuggest(key, val)
      resolve(val)
    }
    const req = net.request(url)
    const timeout = setTimeout(() => {
      try {
        req.abort()
      } catch {
        // ignore
      }
      finish([])
    }, 2500)
    req.on('response', (res) => {
      res.on('data', (chunk) => (body += chunk.toString()))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as unknown
          const list = Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : []
          finish(list.filter((s): s is string => typeof s === 'string').slice(0, 8), true)
        } catch {
          finish([])
        }
      })
    })
    req.on('error', () => finish([]))
    req.end()
  })
}

/**
 * Suggestions de recherche via Google Suggest, exécuté côté Main (pas de CORS). Cache à deux
 * niveaux (exact puis préfixe) avant tout appel réseau. Erreur/timeout → [].
 */
function fetchSuggestions(query: string): Promise<string[]> {
  const q = query.trim()
  if (!q) return Promise.resolve([])

  const key = q.toLowerCase()
  const exact = suggestCache.get(key)
  if (exact && exact.expiry > Date.now()) return Promise.resolve(exact.value)
  if (exact) suggestCache.delete(key) // expiré

  const prefix = prefixCacheHit(q)
  if (prefix) return Promise.resolve(prefix)

  return networkFetch(q, key)
}

export interface BrowserRuntime {
  tabManager: TabManager
  /** Force l'écriture disque immédiate (before-quit). */
  persistNow: () => void
  dispose: () => void
}

/**
 * Construit le runtime navigateur : instancie le TabManager, câble tous les canaux IPC,
 * gère le batch d'events `tab:updated` (avec `batchId` monotone anti-race) et la persistance.
 */
export function setupBrowser(window: BrowserWindow, initialSession: SessionData): BrowserRuntime {
  // État "organisationnel" (UI) conservé côté Main pour la persistance.
  const session: SessionData = { ...initialSession }

  // --- Batch des patchs d'onglets vers le Renderer (coalescé par frame + batchId) ---
  const pending = new Map<string, TabPatch>()
  let batchId = 0

  const flushPatches = (): void => {
    if (pending.size === 0 || window.isDestroyed()) {
      pending.clear()
      return
    }
    const patches = [...pending.entries()].map(([id, patch]) => ({ id, patch }))
    pending.clear()
    batchId += 1
    const batch = { batchId, patches }
    window.webContents.send(IPC.TAB_UPDATED, batch)
    // La couche d'overlay (peek de la sidebar) est une fenêtre séparée : on lui relaie le batch.
    overlay.forward(IPC.TAB_UPDATED, batch)
    persist()
  }
  const patchCoalescer = new FrameCoalescer(flushPatches, 16)

  const emitPatch = (id: string, patch: TabPatch): void => {
    const prev = pending.get(id)
    pending.set(id, prev ? { ...prev, ...patch } : patch)
    patchCoalescer.schedule()
  }

  const overlay = new OverlayLayer(window)

  /** Diffuse un event aux DEUX fenêtres (principale + overlay) pour les garder synchronisées. */
  const broadcast = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
    overlay.forward(channel, payload)
  }

  const tabManager = new TabManager(
    window,
    emitPatch,
    () => overlay.toggleCommand({ mode: 'newTab', activeId: tabManager.getActiveTabId() }),
    () => {
      // Ctrl+H depuis une page ayant le focus : on demande au chrome React d'ouvrir/focus l'onglet
      // interne prism://history/ (la logique ouvrir-ou-focus vit côté Renderer, source de l'UI state).
      if (!window.isDestroyed()) window.webContents.send(IPC.HISTORY_OPEN)
    },
    { visit: recordVisit, updateMeta }
  )

  // Restauration lazy : on enregistre les metas (hibernées), sans créer de vue.
  for (const meta of initialSession.tabs) tabManager.registerTab(meta)
  tabManager.setSidebar(session.sidebarWidth, session.sidebarCollapsed)

  // Exception à l'hibernation lazy : le dernier onglet actif avant la fermeture est réveillé
  // immédiatement (vue recréée + URL chargée) pour rouvrir « direct » à la restauration, sans
  // flash « lune ». Fait ici côté Main pour que `session:get` le renvoie déjà non hiberné.
  if (session.activeTabId && initialSession.tabs.some((t) => t.id === session.activeTabId)) {
    tabManager.activateTab(session.activeTabId)
  }

  // --- Persistance (debouncée) ---
  function buildSession(): SessionData {
    return {
      tabs: tabManager.getAllMeta(),
      folders: session.folders,
      order: session.order,
      pinnedTabIds: session.pinnedTabIds,
      activeTabId: tabManager.getActiveTabId() ?? session.activeTabId,
      sidebarWidth: session.sidebarWidth,
      sidebarCollapsed: session.sidebarCollapsed
    }
  }
  function persist(): void {
    saveSession(buildSession())
  }

  // --- Handlers Renderer -> Main ---
  ipcMain.handle(IPC.SESSION_GET, () => buildSession())

  ipcMain.handle(IPC.TAB_CREATE, (_e, input: CreateTabInput) => {
    const meta = tabManager.createTab(input ?? {})
    // Diffusion aux DEUX fenêtres : c'est la SEULE source qui ajoute l'onglet au store UI
    // (peu importe l'initiateur — sidebar, favori, ou palette de commande dans l'overlay).
    broadcast(IPC.TAB_CREATED, meta)
    persist()
    return meta
  })

  ipcMain.on(IPC.TAB_CLOSE, (_e, id: string) => {
    tabManager.closeTab(id)
    // Diffusion aux DEUX fenêtres : chacune retire l'onglet de son store (idempotent).
    broadcast(IPC.TAB_CLOSED, id)
    persist()
  })
  ipcMain.on(IPC.TAB_ACTIVATE, (_e, id: string) => {
    tabManager.activateTab(id)
    session.activeTabId = id
    // Convergence de l'onglet actif vers TOUTES les surfaces (fenêtre + overlay). Indispensable
    // quand l'activation vient de la palette de commande (overlay) : sans ça, la sidebar de la
    // fenêtre principale garde son ancien onglet sélectionné.
    const sync: UiSyncState = {
      order: session.order,
      pinnedTabIds: session.pinnedTabIds,
      folders: session.folders,
      activeTabId: session.activeTabId
    }
    if (!window.isDestroyed()) window.webContents.send(IPC.UI_STATE_SYNC, sync)
    if (overlay.webContentsId !== null) overlay.forward(IPC.UI_STATE_SYNC, sync)
    persist()
  })
  ipcMain.on(IPC.TAB_NAVIGATE, (_e, payload: { id: string; input: string }) => {
    tabManager.navigate(payload.id, payload.input)
  })
  ipcMain.on(IPC.TAB_BACK, (_e, id: string) => tabManager.goBack(id))
  ipcMain.on(IPC.TAB_FORWARD, (_e, id: string) => tabManager.goForward(id))
  ipcMain.on(IPC.TAB_RELOAD, (_e, id: string) => tabManager.reload(id))
  ipcMain.on(IPC.TAB_HIBERNATE, (_e, id: string) => {
    tabManager.hibernateTab(id)
    persist()
  })
  ipcMain.on(IPC.TAB_RENAME, (_e, payload: { id: string; title: string | null }) => {
    tabManager.renameTab(payload.id, payload.title)
    persist()
  })

  ipcMain.on(IPC.VIEW_SET_SIDEBAR, (_e, intent: SidebarIntent) => {
    // Toggle repli/dépli : on joue l'animation fluide via l'overlay (masque CSS) tandis que la vue
    // web est calée INSTANTANÉMENT à son état final sous le masque. Un simple resize (collapsed
    // inchangé, ex. drag de la poignée) est appliqué directement, sans animation.
    const toggled = session.sidebarCollapsed !== intent.collapsed
    session.sidebarWidth = intent.width
    session.sidebarCollapsed = intent.collapsed
    if (toggled) {
      overlay.playSidebarToggle(intent.width, !intent.collapsed, () =>
        tabManager.setSidebar(intent.width, intent.collapsed)
      )
    } else {
      overlay.cancelSidebarToggle() // annule un toggle en cours (re-bascule / resize rapide)
      tabManager.setSidebar(intent.width, intent.collapsed)
    }
    // L'overlay a besoin du layout courant pour caler la poignée de resize (mode déployé).
    overlay.pushLayout(intent.width, intent.collapsed)
  })

  // Drag de la poignée de resize : le geste est possédé par la couche d'overlay (seule à capter la
  // souris AU-DESSUS de la vue web native). La largeur est partagée entre toggle et peek (source
  // unique `session.sidebarWidth`, façon Arc).
  ipcMain.on(IPC.SIDEBAR_SET_WIDTH, (_e, raw: number) => {
    const width = clampSidebarWidth(raw)
    if (session.sidebarWidth === width) return
    session.sidebarWidth = width
    // Bounds natifs en direct (no-op si repliée : effective=0).
    tabManager.setSidebar(width, session.sidebarCollapsed)
    // La vraie sidebar DOM (fenêtre principale) suit ; useSidebarLayout NE ré-émet PAS (anti-écho).
    if (!window.isDestroyed()) window.webContents.send(IPC.SIDEBAR_WIDTH, width)
    // Le panneau de peek (overlay) suit sa largeur en direct ; la poignée déployée aussi (l'anti-écho
    // supprime le VIEW_SET_SIDEBAR qui pousserait sinon ce layout → on le pousse explicitement).
    overlay.setPeekWidth(width)
    overlay.pushLayout(width, session.sidebarCollapsed)
    persist()
  })

  ipcMain.on(IPC.OPEN_EXTERNAL, (_e, url: string) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
  ipcMain.on(IPC.CLIPBOARD_WRITE, (_e, text: string) => clipboard.writeText(text))

  // Historique + suggestions (palette de commande).
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, payload: { query: string; limit?: number }) =>
    searchHistory(payload.query, payload.limit)
  )
  ipcMain.on(IPC.HISTORY_REMOVE, (_e, url: string) => removeEntry(url))
  ipcMain.handle(IPC.HISTORY_LIST, (_e, input: HistoryListInput) => listHistory(input ?? {}))
  ipcMain.on(IPC.HISTORY_REMOVE_VISIT, (_e, id: string) => removeVisit(id))
  ipcMain.on(IPC.HISTORY_CLEAR, (_e, since?: number) => clearHistory(since))
  ipcMain.handle(IPC.SUGGEST_QUERY, (_e, query: string) => fetchSuggestions(query))

  // Couche d'overlay unique (au-dessus de la page).
  ipcMain.on(IPC.OVERLAY_SITE_CONTROL, (_e, payload: SiteControlPayload) =>
    overlay.toggleSiteControl(payload)
  )
  ipcMain.on(IPC.OVERLAY_CLOSE, () => overlay.hideSiteControl())
  ipcMain.on(IPC.OVERLAY_TAB_MENU, (_e, payload: TabMenuPayload) => overlay.openTabMenu(payload))
  ipcMain.on(IPC.OVERLAY_TAB_MENU_CLOSE, () => overlay.hideTabMenu())
  ipcMain.on(IPC.OVERLAY_COMMAND, (_e, payload: CommandPalettePayload) =>
    overlay.toggleCommand(payload)
  )
  ipcMain.on(IPC.OVERLAY_COMMAND_CLOSE, () => overlay.hideCommand())
  ipcMain.on(IPC.OVERLAY_SET_IGNORE, (_e, ignore: boolean) => overlay.setIgnore(ignore))
  let peekOpen = false
  ipcMain.on(IPC.SIDEBAR_PEEK_OPEN, () => {
    peekOpen = true
    overlay.openPeek(session.sidebarWidth)
  })
  ipcMain.on(IPC.SIDEBAR_PEEK_CLOSE, () => {
    peekOpen = false
    overlay.closePeek()
  })

  // Édition inline du nom d'un onglet (« Renommer »). Diffusée aux DEUX fenêtres (l'onglet peut être
  // dans la sidebar principale OU dans le peek de l'overlay), et on donne le focus OS à la fenêtre
  // concernée pour que le champ inline reçoive bien le clavier (le menu contextuel avait le focus).
  ipcMain.on(IPC.TAB_RENAME_STATE, (_e, tabId: string | null) => {
    // Focus AVANT diffusion : la fenêtre cible est déjà focalisée quand le champ inline se monte
    // (autofocus stable, sinon le champ se blur aussitôt à la bascule de focus overlay→principale).
    if (tabId !== null) {
      if (peekOpen) overlay.focusWindow()
      else if (!window.isDestroyed()) window.focus()
    }
    broadcast(IPC.TAB_RENAME_STATE, tabId)
  })

  ipcMain.on(IPC.SESSION_SAVE_UI, (event, ui: UiPersistState) => {
    session.order = ui.order
    session.pinnedTabIds = ui.pinnedTabIds
    session.folders = ui.folders
    session.activeTabId = ui.activeTabId
    // La largeur/repli de la sidebar sont propres à la fenêtre principale : l'overlay (qui
    // ne rend pas le toggle) ne doit jamais les écraser avec ses valeurs par défaut.
    if (event.sender.id === window.webContents.id) {
      session.sidebarWidth = ui.sidebarWidth
      session.sidebarCollapsed = ui.sidebarCollapsed
    }
    persist()

    // Rediffusion de l'état organisationnel à l'AUTRE fenêtre pour les garder convergentes.
    const sync: UiSyncState = {
      order: session.order,
      pinnedTabIds: session.pinnedTabIds,
      folders: session.folders,
      activeTabId: session.activeTabId
    }
    if (!window.isDestroyed() && window.webContents.id !== event.sender.id) {
      window.webContents.send(IPC.UI_STATE_SYNC, sync)
    }
    if (overlay.webContentsId !== null && overlay.webContentsId !== event.sender.id) {
      overlay.forward(IPC.UI_STATE_SYNC, sync)
    }
  })

  // --- Contrôles de fenêtre (frameless) ---
  ipcMain.on(IPC.WINDOW_MINIMIZE, () => window.minimize())
  ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IPC.WINDOW_CLOSE, () => window.close())

  const sendWindowState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.WINDOW_STATE, { isMaximized: window.isMaximized() })
    }
  }
  window.on('maximize', sendWindowState)
  window.on('unmaximize', sendWindowState)

  const dispose = (): void => {
    patchCoalescer.dispose()
    tabManager.dispose()
    overlay.dispose()
    // Retrait des handlers pour éviter les doublons en cas de recréation de fenêtre.
    for (const ch of [
      IPC.SESSION_GET,
      IPC.TAB_CREATE,
      IPC.HISTORY_SEARCH,
      IPC.HISTORY_LIST,
      IPC.SUGGEST_QUERY
    ]) {
      ipcMain.removeHandler(ch)
    }
    ipcMain.removeAllListeners(IPC.HISTORY_REMOVE)
    ipcMain.removeAllListeners(IPC.HISTORY_REMOVE_VISIT)
    ipcMain.removeAllListeners(IPC.HISTORY_CLEAR)
    ipcMain.removeAllListeners(IPC.TAB_CLOSE)
    ipcMain.removeAllListeners(IPC.TAB_ACTIVATE)
    ipcMain.removeAllListeners(IPC.TAB_NAVIGATE)
    ipcMain.removeAllListeners(IPC.TAB_BACK)
    ipcMain.removeAllListeners(IPC.TAB_FORWARD)
    ipcMain.removeAllListeners(IPC.TAB_RELOAD)
    ipcMain.removeAllListeners(IPC.TAB_HIBERNATE)
    ipcMain.removeAllListeners(IPC.TAB_RENAME)
    ipcMain.removeAllListeners(IPC.VIEW_SET_SIDEBAR)
    ipcMain.removeAllListeners(IPC.OPEN_EXTERNAL)
    ipcMain.removeAllListeners(IPC.CLIPBOARD_WRITE)
    ipcMain.removeAllListeners(IPC.OVERLAY_SITE_CONTROL)
    ipcMain.removeAllListeners(IPC.OVERLAY_CLOSE)
    ipcMain.removeAllListeners(IPC.OVERLAY_TAB_MENU)
    ipcMain.removeAllListeners(IPC.OVERLAY_TAB_MENU_CLOSE)
    ipcMain.removeAllListeners(IPC.OVERLAY_COMMAND)
    ipcMain.removeAllListeners(IPC.OVERLAY_COMMAND_CLOSE)
    ipcMain.removeAllListeners(IPC.OVERLAY_SET_IGNORE)
    ipcMain.removeAllListeners(IPC.SIDEBAR_PEEK_OPEN)
    ipcMain.removeAllListeners(IPC.SIDEBAR_PEEK_CLOSE)
    ipcMain.removeAllListeners(IPC.TAB_RENAME_STATE)
    ipcMain.removeAllListeners(IPC.SIDEBAR_SET_WIDTH)
    ipcMain.removeAllListeners(IPC.SESSION_SAVE_UI)
    ipcMain.removeAllListeners(IPC.WINDOW_MINIMIZE)
    ipcMain.removeAllListeners(IPC.WINDOW_MAXIMIZE)
    ipcMain.removeAllListeners(IPC.WINDOW_CLOSE)
  }

  const persistNow = (): void => {
    saveSession(buildSession(), 0)
    flushSession()
    flushHistory()
  }

  return { tabManager, persistNow, dispose }
}
