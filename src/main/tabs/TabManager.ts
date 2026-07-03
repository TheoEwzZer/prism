import { BrowserWindow, WebContentsView, shell } from 'electron'
import { randomUUID } from 'crypto'
import {
  isInternalUrl,
  internalPageTitle,
  contentArea,
  splitPaneLayout,
  VIEW_RADIUS,
  VIEW_INSET,
  type TabState,
  type TabPatch,
  type CreateTabInput,
  type SplitActivatePayload,
  type PageMenuPayload,
  type PageMenuAction
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

/** Réglages d'hibernation (ajustables). Les constantes de layout viennent de `@shared/types`. */
const HIBERNATE_AFTER_MS = 15 * 60 * 1000 // marque un onglet inactif comme éligible
const MAX_LIVE_VIEWS = 8 // cap strict de WebContentsView vivantes (LRU au-delà)
/** Part de la largeur de la zone contenu réservée au panneau DevTools (docké à droite). */
const DEVTOOLS_RATIO = 0.4
const DEVTOOLS_MIN_WIDTH = 320

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
  // Vue divisée active (2 vues natives simultanées), ou null pour le mode plein écran classique.
  private activeSplit: SplitActivatePayload | null = null
  // Ids des vues natives actuellement affichées (1 en plein écran, 2 en division).
  private visibleIds: string[] = []
  // DevTools dockés à droite : rendus dans NOTRE propre WebContentsView (une vue de WebContentsView
  // native ne peut pas docker ses DevTools dans la BrowserWindow → sinon fenêtre détachée). On la
  // positionne nous-mêmes à droite de la page. `null` si fermés.
  private devtools: { ownerId: string; view: WebContentsView } | null = null

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
    /** Ouvre le menu contextuel de page (clic droit dans la vue web native). */
    private readonly onPageMenu: (payload: PageMenuPayload) => void = () => {},
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

  private applyBoundsNow(): void {
    const { width, height } = this.window.getContentBounds()
    const dt = this.devtools
    const sig = JSON.stringify({ width, height, sb: this.effectiveSidebar, active: this.activeTabId, split: this.activeSplit, dt: dt?.ownerId ?? null }) // prettier-ignore
    if (sig === this.lastLayoutSig) return // rien n'a changé : pas de setBounds inutile
    this.lastLayoutSig = sig
    if (this.activeSplit) {
      const [a, b] = this.activeSplit.tabIds
      const panes = splitPaneLayout(
        width,
        height,
        this.effectiveSidebar,
        this.activeSplit.orientation
      )
      this.tabs.get(a)?.view?.setBounds(panes[0].view)
      this.tabs.get(b)?.view?.setBounds(panes[1].view)
      return
    }
    const area = contentArea(width, height, this.effectiveSidebar)
    const entry = this.activeTabId ? this.tabs.get(this.activeTabId) : null
    // DevTools ouverts pour l'onglet actif : la page prend la moitié gauche, DevTools la droite.
    if (dt && dt.ownerId === this.activeTabId && entry?.view) {
      const dtWidth = Math.min(
        area.width,
        Math.max(DEVTOOLS_MIN_WIDTH, Math.round(area.width * DEVTOOLS_RATIO))
      )
      const pageWidth = Math.max(0, area.width - dtWidth - VIEW_INSET)
      entry.view.setBounds({ x: area.x, y: area.y, width: pageWidth, height: area.height })
      dt.view.setBounds({
        x: area.x + pageWidth + VIEW_INSET,
        y: area.y,
        width: Math.max(0, area.width - pageWidth - VIEW_INSET),
        height: area.height
      })
      return
    }
    entry?.view?.setBounds(area)
  }

  /**
   * Affiche exactement les vues `ids` (1 en plein écran, 2 en division) : masque les vues visibles
   * absentes de la liste, réveille/crée les demandées, applique les bounds puis les rend visibles et
   * donne le focus au pane `focusedId`. Une page interne (`prism://`) n'a pas de vue native (peinte
   * par le chrome React) mais reste comptée comme « visible ».
   */
  private showViews(ids: string[], focusedId: string | null): void {
    // DevTools attachés à un onglet qui n'est plus affiché → on les ferme (ils sont per-vue active).
    if (this.devtools && !ids.includes(this.devtools.ownerId)) this.closeDevToolsPanel()
    for (const vid of this.visibleIds) if (!ids.includes(vid)) this.hideView(vid)
    this.visibleIds = []
    this.lastLayoutSig = null

    for (const id of ids) {
      const entry = this.tabs.get(id)
      if (!entry) continue
      if (isInternalUrl(entry.meta.url)) {
        if (entry.meta.isHibernated) {
          entry.meta.isHibernated = false
          this.emitStore(id, { isHibernated: false })
        }
        this.visibleIds.push(id)
        continue
      }
      const view = this.ensureView(id)
      if (view && !view.webContents.isDestroyed()) this.visibleIds.push(id)
    }

    this.applyBoundsNow()

    for (const id of this.visibleIds) {
      const view = this.tabs.get(id)?.view
      if (view && !view.webContents.isDestroyed()) view.setVisible(true)
    }
    if (focusedId) {
      const fv = this.tabs.get(focusedId)?.view
      if (fv && !fv.webContents.isDestroyed()) fv.webContents.focus()
    }
  }

  /** Un onglet est-il protégé de l'éviction d'hibernation (affiché en plein écran / dans un split) ? */
  private isProtected(id: string): boolean {
    return id === this.activeTabId || this.visibleIds.includes(id)
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
      if (!/^(https?|about|view-source):/.test(url)) event.preventDefault()
    })

    // Clic droit dans la page : l'event natif est capté ici (aucun menu natif n'est construit) et
    // relayé à la couche d'overlay, qui rend un menu React AU-DESSUS de la vue native (façon Arc).
    // `params.x/y` sont relatifs à la page ; on ajoute l'offset des bounds de la vue pour obtenir des
    // coordonnées client alignées 1:1 sur la fenêtre principale (donc sur l'overlay).
    wc.on('context-menu', (_e, params) => {
      if (wc.isDestroyed()) return
      const b = view.getBounds()
      this.onPageMenu({
        tabId: id,
        x: b.x + params.x,
        y: b.y + params.y,
        pageX: params.x,
        pageY: params.y,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        linkURL: params.linkURL,
        srcURL: params.srcURL,
        mediaType: params.mediaType,
        selectionText: params.selectionText,
        isEditable: params.isEditable,
        editFlags: {
          canCut: params.editFlags.canCut,
          canCopy: params.editFlags.canCopy,
          canPaste: params.editFlags.canPaste
        },
        pageURL: params.pageURL || this.tabs.get(id)?.meta.url || ''
      })
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
      } else if (isReloadShortcut(input)) {
        // Ctrl+R / F5 : le menu applicatif (et donc ses accélérateurs par défaut) est désactivé →
        // on recâble le rechargement ici. Ctrl+Shift+R force le contournement du cache.
        event.preventDefault()
        if (input.shift) wc.reloadIgnoringCache()
        else wc.reload()
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

  /**
   * Active un onglet en plein écran : dissout toute vue divisée, réveille sa vue, masque les
   * anciennes, gère le focus explicite. `WebContents` n'expose pas `blur()` : `focus()` sur la
   * nouvelle vue retire implicitement le focus de l'ancienne (masquée par `showViews`).
   */
  activateTab(id: string): void {
    const entry = this.tabs.get(id)
    if (!entry) return
    this.activeSplit = null
    this.activeTabId = id
    entry.lastActive = Date.now()
    this.showViews([id], id)
    this.enforceHibernation()
  }

  /** Active une vue divisée : affiche les deux vues natives côte à côte / empilées. */
  activateSplit(payload: SplitActivatePayload): void {
    const [a, b] = payload.tabIds
    const ea = this.tabs.get(a)
    const eb = this.tabs.get(b)
    if (!ea || !eb) return
    this.activeSplit = payload
    this.activeTabId = payload.focusedId
    const now = Date.now()
    ea.lastActive = now
    eb.lastActive = now
    this.showViews(payload.tabIds, payload.focusedId)
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
    this.visibleIds = this.visibleIds.filter((v) => v !== id)
    // Fermer un panneau dissout la division : le Renderer réactive ensuite l'onglet restant en plein
    // écran via TAB_ACTIVATE.
    if (this.activeSplit && this.activeSplit.tabIds.includes(id)) this.activeSplit = null
    if (this.activeTabId === id) this.activeTabId = null
  }

  // ---------------------------------------------------------------------------
  // DevTools (natif Electron — comme un vrai navigateur)
  // ---------------------------------------------------------------------------

  /**
   * Ouvre/ferme les DevTools de la page active, dockés à DROITE. Comme la page est une
   * `WebContentsView` (et non le `webContents` de la fenêtre), Chromium ne peut pas docker ses
   * DevTools dans la BrowserWindow : `openDevTools({ mode: 'right' })` retombait sur une fenêtre
   * détachée. On les rend donc dans NOTRE propre `WebContentsView` (`setDevToolsWebContents`) que
   * l'on positionne à droite via `applyBoundsNow`, la page occupant la moitié gauche.
   */
  toggleDevTools(): void {
    const id = this.activeTabId
    if (!id) return
    if (this.devtools?.ownerId === id) this.closeDevToolsPanel()
    else this.openDevToolsPanel(id)
  }

  /**
   * Ouvre (ou réutilise) le panneau DevTools docké à droite pour l'onglet `id`. Retourne le
   * `webContents` de la page inspectée (pour enchaîner un `inspectElement`), ou `null`.
   */
  private openDevToolsPanel(id: string): Electron.WebContents | null {
    const wc = this.tabs.get(id)?.view?.webContents
    if (!wc || wc.isDestroyed()) return null
    if (this.devtools?.ownerId === id) return wc // déjà ouverts pour cet onglet
    // Fermer d'éventuels DevTools d'un autre onglet avant d'en ouvrir de nouveaux.
    this.closeDevToolsPanel()

    const dtView = new WebContentsView()
    dtView.setBorderRadius(VIEW_RADIUS)
    this.window.contentView.addChildView(dtView)
    wc.setDevToolsWebContents(dtView.webContents)
    // `detach` : on gère nous-mêmes le placement (aucune fenêtre native n'est créée puisque la cible
    // DevTools est notre WebContentsView).
    wc.openDevTools({ mode: 'detach' })
    this.devtools = { ownerId: id, view: dtView }

    // Fermeture depuis l'UI DevTools (bouton × / Échap dans l'inspecteur) → nettoie notre vue.
    wc.once('devtools-closed', () => {
      if (this.devtools?.ownerId === id) this.closeDevToolsPanel()
    })

    this.lastLayoutSig = null
    this.applyBoundsNow()
    dtView.setVisible(true)
    dtView.webContents.focus()
    return wc
  }

  /** Ferme le panneau DevTools docké (le cas échéant) et rétablit la page en pleine largeur. */
  private closeDevToolsPanel(): void {
    const dt = this.devtools
    if (!dt) return
    this.devtools = null
    const wc = this.tabs.get(dt.ownerId)?.view?.webContents
    if (wc && !wc.isDestroyed() && wc.isDevToolsOpened()) wc.closeDevTools()
    try {
      this.window.contentView.removeChildView(dt.view)
      if (!dt.view.webContents.isDestroyed()) dt.view.webContents.close()
    } catch (err) {
      console.error('[TabManager] closeDevToolsPanel', err)
    }
    this.lastLayoutSig = null
    this.applyBoundsNow()
  }

  /**
   * Exécute une action du menu contextuel de page qui nécessite le `WebContents` natif de l'onglet
   * (impression, inspection, copie/enregistrement d'image, presse-papiers d'un champ éditable). Les
   * actions purement UI (copier une URL, ouvrir un onglet) sont gérées côté Renderer.
   */
  pageAction(tabId: string, action: PageMenuAction): void {
    const wc = this.tabs.get(tabId)?.view?.webContents
    if (!wc || wc.isDestroyed()) return
    switch (action.type) {
      case 'print':
        wc.print()
        break
      case 'copyImage':
        wc.copyImageAt(action.x, action.y)
        break
      case 'saveImage':
      case 'saveLink':
        if (action.url) wc.downloadURL(action.url)
        break
      case 'inspect':
        // Ouvre nos DevTools dockés à droite (pas une fenêtre détachée) puis pointe l'élément.
        this.openDevToolsPanel(tabId)?.inspectElement(action.x, action.y)
        break
      case 'cut':
        wc.cut()
        break
      case 'copy':
        wc.copy()
        break
      case 'paste':
        wc.paste()
        break
      case 'selectAll':
        wc.selectAll()
        break
    }
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
      .filter(([id, e]) => !this.isProtected(id) && now - e.lastActive > HIBERNATE_AFTER_MS)
      .sort((a, b) => a[1].lastActive - b[1].lastActive)

    // Si rien n'est "vieux", on autorise quand même l'éviction du plus ancien non actif
    // pour tenir le cap strict (pression mémoire).
    const pool =
      evictable.length > 0
        ? evictable
        : live
            .filter(([id]) => !this.isProtected(id))
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
    // Détruire la vue propriétaire des DevTools → fermer d'abord le panneau docké.
    if (this.devtools && this.tabs.get(this.devtools.ownerId) === entry) this.closeDevToolsPanel()
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

/** Détecte Ctrl+R, Ctrl+Shift+R ou F5 (keydown) pour recharger la page. */
function isReloadShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  if (input.key === 'F5') return true
  return input.control && !input.alt && input.key.toLowerCase() === 'r'
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
  // Affichage du code source d'une page (menu contextuel) : conservé tel quel.
  if (/^view-source:/i.test(input)) return input
  // Domaine "brut" (contient un point sans espace) → https://
  if (/^[^\s]+\.[^\s]+$/.test(input) && !input.includes(' ')) return `https://${input}`
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}
