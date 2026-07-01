/**
 * Types partagés entre le Main process et le Renderer.
 *
 * Frontière stricte :
 *  - Le Main est la source de vérité du "browser state" (navigation, WebContentsView,
 *    layout/bounds réels).
 *  - Le Renderer ne détient que du "UI state" (titre, favicon, loading, ordre, dossiers,
 *    onglet actif) et n'émet que des intentions.
 */

/** Métadonnées d'un onglet — sérialisables, partagées Main <-> Renderer. */
export interface TabState {
  id: string
  url: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** true = la WebContentsView native est détruite (RAM libérée), meta conservée. */
  isHibernated: boolean
  /** Dossier parent dans la sidebar, ou null si à la racine. */
  parentFolderId: string | null
}

/** Dossier rétractable de la sidebar (espace / groupe d'onglets). */
export interface FolderState {
  id: string
  name: string
  collapsed: boolean
}

/** Application épinglée (favori) affichée en haut de la sidebar. */
export interface PinnedApp {
  id: string
  name: string
  url: string
  favicon: string | null
}

/** État de session persisté sur disque et restauré au démarrage. */
export interface SessionData {
  tabs: TabState[]
  folders: FolderState[]
  pinnedApps: PinnedApp[]
  /** Ordre d'affichage des onglets (ids) au niveau racine + dans les dossiers. */
  order: string[]
  activeTabId: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
}

/** Patch partiel d'un onglet (jamais l'id). */
export type TabPatch = Partial<Omit<TabState, 'id'>>

/** Lot de patchs coalescés émis par le Main, avec un id monotone anti-race. */
export interface TabUpdateBatch {
  batchId: number
  patches: Array<{ id: string; patch: TabPatch }>
}

/** État "organisationnel" (UI) que le Renderer pousse au Main pour la persistance. */
export interface UiPersistState {
  order: string[]
  folders: FolderState[]
  pinnedApps: PinnedApp[]
  activeTabId: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
}

/** Intention de layout envoyée par le Renderer (jamais de pixels de bounds bruts). */
export interface SidebarIntent {
  width: number
  collapsed: boolean
}

/** Noms de canaux IPC — source unique de vérité, importée des deux côtés. */
export const IPC = {
  // Renderer -> Main (invoke, réponse attendue)
  SESSION_GET: 'session:get',
  TAB_CREATE: 'tab:create',
  // Renderer -> Main (send, fire-and-forget)
  TAB_CLOSE: 'tab:close',
  TAB_ACTIVATE: 'tab:activate',
  TAB_NAVIGATE: 'tab:navigate',
  TAB_BACK: 'tab:back',
  TAB_FORWARD: 'tab:forward',
  TAB_RELOAD: 'tab:reload',
  VIEW_SET_SIDEBAR: 'view:setSidebar',
  SESSION_SAVE_UI: 'session:saveUi',
  OPEN_EXTERNAL: 'app:openExternal',
  CLIPBOARD_WRITE: 'app:clipboardWrite',
  // Fenêtre-overlay native (flotte au-dessus de la WebContentsView sans la masquer)
  OVERLAY_SITE_CONTROL: 'overlay:siteControl',
  OVERLAY_GET_DATA: 'overlay:getData',
  OVERLAY_RESIZE: 'overlay:resize',
  OVERLAY_CLOSE: 'overlay:close',
  // Peek de la sidebar repliée : fenêtre-overlay native qui flotte AU-DESSUS de la page
  // (façon Arc), révélée au survol du bord gauche. Elle ne pousse jamais la vue web.
  SIDEBAR_PEEK_OPEN: 'sidebar:peekOpen', // main -> Main (survol du bord gauche)
  SIDEBAR_PEEK_CLOSE: 'sidebar:peekClose', // overlay -> Main (souris sortie du panneau)
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  // Main -> Renderer (events)
  SIDEBAR_PEEK_STATE: 'sidebar:peekState', // Main -> overlay (ouverture/fermeture animée)
  TAB_UPDATED: 'tab:updated',
  TAB_CREATED: 'tab:created',
  TAB_CLOSED: 'tab:closed',
  SESSION_LOADED: 'session:loaded',
  WINDOW_STATE: 'window:state'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Payload de création d'onglet (Renderer -> Main). */
export interface CreateTabInput {
  url?: string
  parentFolderId?: string | null
  /** Active immédiatement l'onglet après création (défaut true). */
  activate?: boolean
}

/** État de la fenêtre remonté au Renderer (icône max/restore). */
export interface WindowState {
  isMaximized: boolean
}

/**
 * Données du "Site Control Center" transmises à la fenêtre-overlay native.
 * `anchorRight`/`anchorBottom` sont en coordonnées client (relatives au contenu de la fenêtre
 * principale) : le Main les convertit en coordonnées écran pour positionner l'overlay.
 */
export interface SiteControlPayload {
  url: string
  activeId: string | null
  anchorRight: number
  anchorBottom: number
}
