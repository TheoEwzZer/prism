import { BrowserWindow, WebContentsView, shell, type Rectangle } from 'electron'
import { randomUUID } from 'crypto'
import {
  isInternalUrl,
  internalPageTitle,
  type TabState,
  type TabPatch,
  type CreateTabInput
} from '@shared/types'
import { FrameCoalescer } from '../utils/scheduler'

/** Nom lisible dérivé d'une URL (hostname sans `www.`) pour titrer un onglet avant chargement. */
function urlLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

/**
 * Titre à afficher pour un onglet restauré (hiberné, sans vue). On corrige les titres périmés :
 * page interne → titre canonique ; titre vide ou placeholder de chargement → nom de domaine. Les
 * vrais titres de page persistés (« Gmail… ») sont conservés tels quels.
 */
function restoredTitle(meta: TabState): string {
  if (isInternalUrl(meta.url)) return internalPageTitle(meta.url)
  const t = meta.title?.trim()
  // Vide / placeholder de chargement / titre interne réservé ayant fui sur une URL normale (séquelle
  // d'anciennes sessions corrompues) → on retombe sur le nom de domaine. Le vrai titre reviendra au
  // réveil de l'onglet.
  if (!t || t === 'Chargement…' || t === 'Historique' || t === 'Prism') return urlLabel(meta.url)
  return t
}

/** Réglages d'hibernation / layout (ajustables). */
const HIBERNATE_AFTER_MS = 15 * 60 * 1000 // marque un onglet inactif comme éligible
const MAX_LIVE_VIEWS = 8 // cap strict de WebContentsView vivantes (LRU au-delà)
const VIEW_INSET = 8 // marge autour de la vue (look "carte" arrondie façon Arc)
const VIEW_RADIUS = 10
// Hauteur de la barre supérieure pleine largeur (doit rester synchronisée avec la classe
// `h-8` de <TopBar> côté renderer). La vue web démarre juste sous cette barre : la barre
// englobe déjà la marge haute de la carte, donc pas de VIEW_INSET supplémentaire en haut.
const TOPBAR_HEIGHT = 32

interface TabEntry {
  meta: TabState
  view: WebContentsView | null
  lastActive: number
}

/** Callback d'émission d'un patch d'onglet vers le Renderer (coalescé en amont). */
export type EmitPatch = (id: string, patch: TabPatch) => void

/** Hooks d'historique (découplés du store : injectés par le runtime). */
export interface HistoryHooks {
  /** Nouvelle navigation principale → enregistre une visite. */
  visit: (url: string) => void
  /** Title/favicon arrivés après coup → met à jour l'entrée existante. */
  updateMeta: (url: string, patch: { title?: string; favicon?: string | null }) => void
}

/**
 * Cœur métier : gère le cycle de vie des WebContentsView, le layout (source de vérité des
 * bounds), le focus, l'hibernation, et remonte les changements via `emitPatch`.
 */
export class TabManager {
  private readonly tabs = new Map<string, TabEntry>()
  private activeTabId: string | null = null

  // Largeur de sidebar *effective* utilisée pour le layout de la vue web (0 si repliée).
  private effectiveSidebar = 256
  private lastLayoutSig: string | null = null

  private readonly boundsCoalescer: FrameCoalescer
  private hibernationTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly window: BrowserWindow,
    private readonly emitPatch: EmitPatch,
    /** Ouvre la palette de commande (Ctrl+T depuis une page ayant le focus). */
    private readonly onCommandShortcut: () => void = () => {},
    /** Ouvre la page Historique (Ctrl+H depuis une page ayant le focus). */
    private readonly onHistoryShortcut: () => void = () => {},
    /** Hooks d'historique (optionnels). */
    private readonly history?: HistoryHooks
  ) {
    // Recalcul des bounds coalescé (une source unique : le Main).
    this.boundsCoalescer = new FrameCoalescer(() => this.applyBoundsNow(), 16)
    this.window.on('resize', () => this.boundsCoalescer.schedule())
    this.window.on('maximize', () => this.boundsCoalescer.schedule())
    this.window.on('unmaximize', () => this.boundsCoalescer.schedule())

    // Vérification périodique de l'hibernation.
    this.hibernationTimer = setInterval(() => this.enforceHibernation(), 60 * 1000)
  }

  // ---------------------------------------------------------------------------
  // Layout (bounds) — le Main est la SEULE source de vérité.
  // ---------------------------------------------------------------------------

  /** Intention de layout venant du Renderer (jamais de pixels bruts). */
  setSidebar(width: number, collapsed: boolean): void {
    this.effectiveSidebar = collapsed ? 0 : Math.max(0, Math.round(width))
    this.boundsCoalescer.schedule()
  }

  /** Aire de base disponible pour la vue web (sous la top bar, à droite de la sidebar). */
  private computeBounds(): Rectangle {
    const { width, height } = this.window.getContentBounds()
    const sidebar = this.effectiveSidebar
    const x = sidebar + VIEW_INSET
    const y = TOPBAR_HEIGHT
    return {
      x,
      y,
      width: Math.max(0, width - sidebar - VIEW_INSET * 2),
      height: Math.max(0, height - TOPBAR_HEIGHT - VIEW_INSET)
    }
  }

  private applyBoundsNow(): void {
    const b = this.computeBounds()
    const sig = JSON.stringify({ b, active: this.activeTabId })
    if (sig === this.lastLayoutSig) return // rien n'a changé : pas de setBounds inutile
    this.lastLayoutSig = sig
    const entry = this.activeTabId ? this.tabs.get(this.activeTabId) : null
    entry?.view?.setBounds(b)
  }

  /**
   * Applique un patch à la meta (SEULE source de vérité persistée côté Main) PUIS le remonte au
   * Renderer. Indispensable : sans la mise à jour de `entry.meta`, les events `page-title-updated` /
   * `page-favicon-updated` ne mettaient à jour QUE l'UI, et la session sauvegardée (`getAllMeta`)
   * conservait les valeurs périmées de `createTab` (« Chargement… », favicon `null`, ancien titre).
   */
  private emitStore(id: string, patch: TabPatch): void {
    const entry = this.tabs.get(id)
    if (entry) Object.assign(entry.meta, patch)
    this.emitPatch(id, patch)
  }

  // ---------------------------------------------------------------------------
  // Création / enregistrement d'onglets
  // ---------------------------------------------------------------------------

  /** Restaure la meta d'un onglet SANS créer de vue (lazy / hibernated au boot). */
  registerTab(meta: TabState): void {
    this.tabs.set(meta.id, {
      meta: { ...meta, isHibernated: true, isLoading: false, title: restoredTitle(meta) },
      view: null,
      lastActive: 0
    })
  }

  /** Crée un onglet utilisateur (vue vivante), l'active par défaut. Retourne la meta. */
  createTab(input: CreateTabInput): TabState {
    const id = randomUUID()
    const url = normalizeInput(input.url ?? '')
    const internal = isInternalUrl(url)
    const meta: TabState = {
      id,
      url,
      title: internal ? internalPageTitle(url) : url ? urlLabel(url) : 'Nouvel onglet',
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isHibernated: false,
      parentFolderId: input.parentFolderId ?? null
    }
    this.tabs.set(id, { meta, view: null, lastActive: Date.now() })
    // Page interne : aucune WebContentsView (rendue par le chrome React). Sinon, on crée la vue.
    if (!internal) this.ensureView(id)
    if (input.activate !== false) this.activateTab(id)
    return meta
  }

  // ---------------------------------------------------------------------------
  // Cycle de vie des WebContentsView
  // ---------------------------------------------------------------------------

  /** Crée la WebContentsView si absente (réveil d'un onglet hiberné) et charge l'URL. */
  private ensureView(id: string): WebContentsView | null {
    const entry = this.tabs.get(id)
    if (!entry) return null
    // Page interne : jamais de vue native (le chrome React la peint).
    if (isInternalUrl(entry.meta.url)) return null
    if (entry.view && !entry.view.webContents.isDestroyed()) return entry.view

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    view.setBorderRadius(VIEW_RADIUS)
    view.setVisible(false)
    this.window.contentView.addChildView(view)
    this.wireWebContents(id, view)

    entry.view = view
    entry.meta.isHibernated = false
    this.emitStore(id, { isHibernated: false })

    if (entry.meta.url) {
      entry.meta.isLoading = true
      view.webContents.loadURL(entry.meta.url).catch(() => {
        this.emitStore(id, { isLoading: false })
      })
    }
    return view
  }

  /** Branche les events webContents (throttlés en amont via le batch) + la sécurité. */
  private wireWebContents(id: string, view: WebContentsView): void {
    const wc = view.webContents

    // Sécurité : popups contrôlées + navigations externes ouvertes dans le navigateur système.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (!/^(https?|about):/.test(url)) event.preventDefault()
    })

    // F12 / Ctrl+Shift+I → notre DevTools docké géré (et on empêche le DevTools natif docké
    // de Chromium, qui se superposerait à la page dans notre layout custom).
    wc.on('before-input-event', (event, input) => {
      if (isDevToolsShortcut(input)) {
        event.preventDefault()
        this.toggleDevTools()
      } else if (isNewTabShortcut(input)) {
        // Ctrl+T frappé alors qu'une page a le focus : la palette vit dans l'overlay, pas dans
        // cette WebContentsView → on capture ici et on délègue au runtime pour l'ouvrir.
        event.preventDefault()
        this.onCommandShortcut()
      } else if (isHistoryShortcut(input)) {
        // Ctrl+H frappé alors qu'une page a le focus : on délègue au runtime l'ouverture/focus de
        // l'onglet interne prism://history/ (le chrome React n'a pas reçu ce keydown).
        event.preventDefault()
        this.onHistoryShortcut()
      }
    })

    wc.on('page-title-updated', (_e, title) => {
      this.emitStore(id, { title })
      const url = this.tabs.get(id)?.meta.url
      if (url) this.history?.updateMeta(url, { title })
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      const favicon = favicons[0] ?? null
      this.emitStore(id, { favicon })
      const url = this.tabs.get(id)?.meta.url
      if (url && favicon) this.history?.updateMeta(url, { favicon })
    })
    wc.on('did-start-loading', () => this.emitStore(id, { isLoading: true }))
    wc.on('did-stop-loading', () => {
      this.emitStore(id, { isLoading: false, ...this.navFlags(id) })
    })
    wc.on('did-navigate', (_e, url) => {
      const entry = this.tabs.get(id)
      if (entry) entry.meta.url = url
      this.emitStore(id, { url, ...this.navFlags(id) })
      this.history?.visit(url)
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      const entry = this.tabs.get(id)
      if (entry) entry.meta.url = url
      this.emitStore(id, { url, ...this.navFlags(id) })
    })
  }

  private navFlags(id: string): TabPatch {
    const wc = this.tabs.get(id)?.view?.webContents
    if (!wc || wc.isDestroyed()) return {}
    return {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    }
  }

  /** Masque la vue native d'un onglet (+ ferme son DevTools). No-op si page interne / hibernée. */
  private hideView(id: string | null): void {
    if (!id) return
    const entry = this.tabs.get(id)
    if (entry?.view && !entry.view.webContents.isDestroyed()) {
      if (entry.view.webContents.isDevToolsOpened()) entry.view.webContents.closeDevTools()
      entry.view.setVisible(false)
    }
  }

  /** Active un onglet : réveille sa vue, masque l'ancienne, gère le focus explicite. */
  activateTab(id: string): void {
    const entry = this.tabs.get(id)
    if (!entry) return

    // Masquer l'ancienne vue active. `WebContents` n'expose pas `blur()` : focus() sur la nouvelle
    // vue (plus bas) retire implicitement le focus de l'ancienne, et setVisible(false) la sort du rendu.
    if (this.activeTabId && this.activeTabId !== id) this.hideView(this.activeTabId)

    this.activeTabId = id
    entry.lastActive = Date.now()
    // L'identité de la vue active a pu changer (interne↔normale, ou vue recréée) : on force le
    // recompute des bounds (le garde `lastLayoutSig` ne voit sinon pas le changement de vue).
    this.lastLayoutSig = null

    // Page interne : aucune vue à afficher, le chrome React peint la zone contenu.
    if (isInternalUrl(entry.meta.url)) {
      if (entry.meta.isHibernated) {
        entry.meta.isHibernated = false
        this.emitStore(id, { isHibernated: false })
      }
      this.applyBoundsNow()
      this.enforceHibernation()
      return
    }

    const view = this.ensureView(id)
    if (view && !view.webContents.isDestroyed()) {
      // Le Main applique les bounds (source de vérité) avant d'afficher.
      this.applyBoundsNow()
      view.setVisible(true)
      view.webContents.focus()
    }

    this.enforceHibernation()
  }

  /**
   * Hibernation manuelle (menu contextuel) : détruit le process de rendu tout en conservant la
   * meta (favicon/titre). No-op si déjà hiberné ou page interne (pas de process). Si l'onglet
   * était actif, on masque simplement la zone (la meta reste, la vue renaîtra au prochain clic).
   */
  hibernateTab(id: string): void {
    const entry = this.tabs.get(id)
    if (!entry || !entry.view || isInternalUrl(entry.meta.url)) return
    this.destroyView(entry)
    entry.meta.isHibernated = true
    entry.meta.isLoading = false
    this.emitStore(id, { isHibernated: true, isLoading: false })
  }

  /** Renomme un onglet (nom personnalisé). `title` vidé/`null` = retour au titre automatique. */
  renameTab(id: string, title: string | null): void {
    const entry = this.tabs.get(id)
    if (!entry) return
    const customTitle = title && title.trim() ? title.trim() : null
    entry.meta.customTitle = customTitle
    this.emitStore(id, { customTitle })
  }

  /** Ferme définitivement un onglet (détruit la vue + libère les ressources). */
  closeTab(id: string): void {
    const entry = this.tabs.get(id)
    if (!entry) return
    this.destroyView(entry)
    this.tabs.delete(id)
    if (this.activeTabId === id) this.activeTabId = null
  }

  // ---------------------------------------------------------------------------
  // DevTools (natif Electron — comme un vrai navigateur)
  // ---------------------------------------------------------------------------

  /**
   * Ouvre/ferme le DevTools NATIF de la page active. Chromium gère lui-même la barre
   * d'outils complète (dont le bouton fermer), le dock et le redimensionnement fluide.
   * On ne bricole plus de vue/splitter/instantanés.
   */
  toggleDevTools(): void {
    const wc = this.activeTabId ? this.tabs.get(this.activeTabId)?.view?.webContents : null
    if (!wc || wc.isDestroyed()) return
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'right' })
  }

  navigate(id: string, input: string): void {
    const entry = this.tabs.get(id)
    if (!entry) return
    const url = normalizeInput(input)
    entry.meta.url = url

    // Navigation vers une page interne : on détruit la vue native de l'onglet (le chrome React
    // prend le relais) et on remet la meta à plat.
    if (isInternalUrl(url)) {
      this.destroyView(entry)
      Object.assign(entry.meta, {
        title: internalPageTitle(url),
        favicon: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isHibernated: false
      })
      this.emitStore(id, {
        url,
        title: entry.meta.title,
        favicon: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isHibernated: false
      })
      if (this.activeTabId === id) {
        this.lastLayoutSig = null
        this.applyBoundsNow()
      }
      return
    }

    // Navigation normale : crée la vue si besoin (ex. l'onglet était interne) et charge l'URL.
    const view = this.ensureView(id)
    if (!view || view.webContents.isDestroyed()) return
    // On repart d'un titre/favicon neufs (nom de domaine) : sinon l'ancien titre — ex. « Historique »
    // d'une page interne quittée — persisterait tant que la nouvelle page n'a pas émis le sien.
    this.emitStore(id, { url, title: urlLabel(url), favicon: null, isLoading: true })
    view.webContents.loadURL(url).catch(() => this.emitStore(id, { isLoading: false }))
    // Si l'onglet actif redevient une vue native (interne→normale), il faut l'afficher.
    if (this.activeTabId === id) {
      this.lastLayoutSig = null
      this.applyBoundsNow()
      view.setVisible(true)
      view.webContents.focus()
    }
  }

  goBack(id: string): void {
    const wc = this.tabs.get(id)?.view?.webContents
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(id: string): void {
    const wc = this.tabs.get(id)?.view?.webContents
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward()
    }
  }

  reload(id: string): void {
    const wc = this.tabs.get(id)?.view?.webContents
    if (wc && !wc.isDestroyed()) wc.reload()
  }

  // ---------------------------------------------------------------------------
  // Hibernation
  // ---------------------------------------------------------------------------

  /**
   * Politique proche d'Arc :
   *  - onglet inactif > seuil = simple pause (déjà masqué) → restauration instantanée.
   *  - destruction UNIQUEMENT si le nombre de vues vivantes dépasse le cap (LRU).
   */
  private enforceHibernation(): void {
    const now = Date.now()
    const live = [...this.tabs.entries()].filter(
      ([, e]) => e.view && !e.view.webContents.isDestroyed()
    )
    if (live.length <= MAX_LIVE_VIEWS) return

    // Candidats à la destruction : inactifs, pas l'onglet actif, triés LRU.
    const evictable = live
      .filter(([id, e]) => id !== this.activeTabId && now - e.lastActive > HIBERNATE_AFTER_MS)
      .sort((a, b) => a[1].lastActive - b[1].lastActive)

    // Si rien n'est "vieux", on autorise quand même l'éviction du plus ancien non actif
    // pour tenir le cap strict (pression mémoire).
    const pool =
      evictable.length > 0
        ? evictable
        : live
            .filter(([id]) => id !== this.activeTabId)
            .sort((a, b) => a[1].lastActive - b[1].lastActive)

    let toEvict = live.length - MAX_LIVE_VIEWS
    for (const [id, entry] of pool) {
      if (toEvict <= 0) break
      this.destroyView(entry)
      entry.meta.isHibernated = true
      entry.meta.isLoading = false
      this.emitStore(id, { isHibernated: true, isLoading: false })
      toEvict--
    }
  }

  /** Destruction stricte d'une vue : retrait du hiérarchie + destroy du webContents. */
  private destroyView(entry: TabEntry): void {
    const view = entry.view
    if (!view) return
    try {
      this.window.contentView.removeChildView(view)
      // `WebContents.close()` = méthode publique de destruction : libère le process de
      // rendu (équivalent à la fermeture de la page). Combiné au retrait de la hiérarchie
      // + `entry.view = null`, la vue devient éligible au GC → pas de leak.
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch (err) {
      console.error('[TabManager] destroyView', err)
    }
    entry.view = null
  }

  // ---------------------------------------------------------------------------
  // Divers
  // ---------------------------------------------------------------------------

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  /** Snapshot des métadonnées de tous les onglets (pour la persistance). */
  getAllMeta(): TabState[] {
    return [...this.tabs.values()].map((e) => ({ ...e.meta }))
  }

  dispose(): void {
    if (this.hibernationTimer) clearInterval(this.hibernationTimer)
    this.hibernationTimer = null
    this.boundsCoalescer.dispose()
    for (const entry of this.tabs.values()) this.destroyView(entry)
    this.tabs.clear()
  }
}

/** Détecte F12 ou Ctrl+Shift+I (keydown) pour (dé)basculer le DevTools. */
function isDevToolsShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  if (input.key === 'F12') return true
  return input.control && input.shift && input.key.toLowerCase() === 'i'
}

/** Détecte Ctrl+H (keydown) pour ouvrir la page Historique. */
function isHistoryShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  return input.control && !input.shift && !input.alt && input.key.toLowerCase() === 'h'
}

/** Détecte Ctrl+T (keydown) pour ouvrir la palette de commande. */
function isNewTabShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  return input.control && !input.shift && !input.alt && input.key.toLowerCase() === 't'
}

/**
 * Heuristique Omnibox : URL directe, domaine, ou recherche Google.
 */
function normalizeInput(raw: string): string {
  const input = raw.trim()
  if (!input) return ''
  // Page interne prism:// → canonicalisée avec un slash final (ex. `prism://history` → `prism://history/`).
  if (/^prism:\/\//i.test(input)) {
    const rest = input.replace(/^prism:\/\//i, '').replace(/\/+$/, '')
    return `prism://${rest.toLowerCase()}/`
  }
  if (/^https?:\/\//i.test(input) || input.startsWith('about:')) return input
  // Domaine "brut" (contient un point sans espace) → https://
  if (/^[^\s]+\.[^\s]+$/.test(input) && !input.includes(' ')) return `https://${input}`
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}
