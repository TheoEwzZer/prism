import { BrowserWindow, WebContentsView, shell, type Rectangle } from 'electron'
import { randomUUID } from 'crypto'
import type { TabState, TabPatch, CreateTabInput } from '@shared/types'
import { FrameCoalescer } from '../utils/scheduler'

/** Réglages d'hibernation / layout (ajustables). */
const HIBERNATE_AFTER_MS = 15 * 60 * 1000 // marque un onglet inactif comme éligible
const MAX_LIVE_VIEWS = 8 // cap strict de WebContentsView vivantes (LRU au-delà)
const VIEW_INSET = 8 // marge autour de la vue (look "carte" arrondie façon Arc)
const VIEW_RADIUS = 10
const COLLAPSED_SIDEBAR_WIDTH = 0 // repliée : la sidebar disparaît, la vue web occupe tout
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

  private sidebarWidth = 256
  private sidebarCollapsed = false
  private lastLayoutSig: string | null = null

  private readonly boundsCoalescer: FrameCoalescer
  private hibernationTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly window: BrowserWindow,
    private readonly emitPatch: EmitPatch,
    /** Ouvre la palette de commande (Ctrl+T depuis une page ayant le focus). */
    private readonly onCommandShortcut: () => void = () => {},
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
    this.sidebarWidth = Math.max(0, Math.round(width))
    this.sidebarCollapsed = collapsed
    this.boundsCoalescer.schedule()
  }

  /** Aire de base disponible pour la vue web (sous la top bar, à droite de la sidebar). */
  private computeBounds(): Rectangle {
    const { width, height } = this.window.getContentBounds()
    const sidebar = this.sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : this.sidebarWidth
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

  // ---------------------------------------------------------------------------
  // Création / enregistrement d'onglets
  // ---------------------------------------------------------------------------

  /** Restaure la meta d'un onglet SANS créer de vue (lazy / hibernated au boot). */
  registerTab(meta: TabState): void {
    this.tabs.set(meta.id, {
      meta: { ...meta, isHibernated: true, isLoading: false },
      view: null,
      lastActive: 0
    })
  }

  /** Crée un onglet utilisateur (vue vivante), l'active par défaut. Retourne la meta. */
  createTab(input: CreateTabInput): TabState {
    const id = randomUUID()
    const url = normalizeInput(input.url ?? '')
    const meta: TabState = {
      id,
      url,
      title: url ? 'Chargement…' : 'Nouvel onglet',
      favicon: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isHibernated: false,
      parentFolderId: input.parentFolderId ?? null
    }
    this.tabs.set(id, { meta, view: null, lastActive: Date.now() })
    this.ensureView(id)
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
    this.emitPatch(id, { isHibernated: false })

    if (entry.meta.url) {
      entry.meta.isLoading = true
      view.webContents.loadURL(entry.meta.url).catch(() => {
        this.emitPatch(id, { isLoading: false })
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
      }
    })

    wc.on('page-title-updated', (_e, title) => {
      this.emitPatch(id, { title })
      const url = this.tabs.get(id)?.meta.url
      if (url) this.history?.updateMeta(url, { title })
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      const favicon = favicons[0] ?? null
      this.emitPatch(id, { favicon })
      const url = this.tabs.get(id)?.meta.url
      if (url && favicon) this.history?.updateMeta(url, { favicon })
    })
    wc.on('did-start-loading', () => this.emitPatch(id, { isLoading: true }))
    wc.on('did-stop-loading', () => {
      this.emitPatch(id, { isLoading: false, ...this.navFlags(id) })
    })
    wc.on('did-navigate', (_e, url) => {
      const entry = this.tabs.get(id)
      if (entry) entry.meta.url = url
      this.emitPatch(id, { url, ...this.navFlags(id) })
      this.history?.visit(url)
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      const entry = this.tabs.get(id)
      if (entry) entry.meta.url = url
      this.emitPatch(id, { url, ...this.navFlags(id) })
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

  /** Active un onglet : réveille sa vue, masque l'ancienne, gère le focus explicite. */
  activateTab(id: string): void {
    const entry = this.tabs.get(id)
    if (!entry) return

    // Masquer l'ancienne vue active (+ fermer son DevTools natif s'il était ouvert).
    // `WebContents` n'expose pas `blur()` : focus() sur la nouvelle vue (plus bas) retire
    // implicitement le focus de l'ancienne, et setVisible(false) la sort du rendu.
    if (this.activeTabId && this.activeTabId !== id) {
      const prev = this.tabs.get(this.activeTabId)
      if (prev?.view && !prev.view.webContents.isDestroyed()) {
        if (prev.view.webContents.isDevToolsOpened()) prev.view.webContents.closeDevTools()
        prev.view.setVisible(false)
      }
    }

    const view = this.ensureView(id)
    this.activeTabId = id
    entry.lastActive = Date.now()

    if (view && !view.webContents.isDestroyed()) {
      // Le Main applique les bounds (source de vérité) avant d'afficher.
      this.applyBoundsNow()
      view.setVisible(true)
      view.webContents.focus()
    }

    this.enforceHibernation()
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
    const view = this.ensureView(id)
    view?.webContents.loadURL(url).catch(() => this.emitPatch(id, { isLoading: false }))
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
      this.emitPatch(id, { isHibernated: true, isLoading: false })
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
  if (/^https?:\/\//i.test(input) || input.startsWith('about:')) return input
  // Domaine "brut" (contient un point sans espace) → https://
  if (/^[^\s]+\.[^\s]+$/.test(input) && !input.includes(' ')) return `https://${input}`
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}
