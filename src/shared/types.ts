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

/** État de session persisté sur disque et restauré au démarrage. */
export interface SessionData {
  tabs: TabState[]
  folders: FolderState[]
  /** Ordre d'affichage des onglets (ids) au niveau racine + dans les dossiers. */
  order: string[]
  /** Onglets « favoris » (épinglés), dans l'ordre de la liste de favoris de la sidebar. */
  pinnedTabIds: string[]
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
  pinnedTabIds: string[]
  folders: FolderState[]
  activeTabId: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
}

/**
 * Sous-ensemble « organisationnel » de l'état UI rediffusé par le Main à TOUTES les fenêtres
 * (principale + overlay) pour les garder convergentes (réordonnancement, épinglage, dossiers,
 * onglet actif). Exclut la sidebar (width/collapsed), propre à la fenêtre principale.
 */
export interface UiSyncState {
  order: string[]
  pinnedTabIds: string[]
  folders: FolderState[]
  activeTabId: string | null
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
  HISTORY_SEARCH: 'history:search', // invoke : recherche dans l'historique local
  HISTORY_REMOVE: 'history:remove', // send : supprime une entrée d'historique
  SUGGEST_QUERY: 'suggest:query', // invoke : suggestions de recherche (Google Suggest)
  // Couche d'overlay unique : UNE fenêtre transparente persistante qui recouvre toute la zone
  // contenu et flotte AU-DESSUS de la WebContentsView (peek de la sidebar + Contrôles du site
  // + futurs menus). Ouverture instantanée, animations CSS, click-through géré par hit-test.
  OVERLAY_SITE_CONTROL: 'overlay:siteControl', // main -> Main : ouvrir les Contrôles du site
  OVERLAY_CLOSE: 'overlay:close', // overlay -> Main : fermer les Contrôles du site
  OVERLAY_SET_IGNORE: 'overlay:setIgnore', // overlay -> Main : capter/laisser passer la souris
  SIDEBAR_PEEK_OPEN: 'sidebar:peekOpen', // main -> Main : survol du bord gauche
  SIDEBAR_PEEK_CLOSE: 'sidebar:peekClose', // overlay -> Main : souris sortie du panneau
  OVERLAY_COMMAND: 'overlay:command', // main/Main -> Main : ouvrir la palette de commande
  OVERLAY_COMMAND_CLOSE: 'overlay:commandClose', // overlay -> Main : fermer la palette
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  // Main -> Renderer (events)
  OVERLAY_SITE_CONTROL_DATA: 'overlay:siteControlData', // Main -> overlay : push données (ou null)
  OVERLAY_COMMAND_DATA: 'overlay:commandData', // Main -> overlay : ouvrir/fermer la palette (ou null)
  SIDEBAR_PEEK_STATE: 'sidebar:peekState', // Main -> overlay : ouverture/fermeture animée
  UI_STATE_SYNC: 'ui:stateSync', // Main -> autres fenêtres : convergence de l'état organisationnel
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
 * Données des « Contrôles du site » transmises à la fenêtre-overlay native.
 * `anchorRight`/`anchorBottom` sont en coordonnées client (relatives au contenu de la fenêtre
 * principale) : le Main les convertit en coordonnées écran pour positionner l'overlay.
 */
export interface SiteControlPayload {
  url: string
  activeId: string | null
  anchorRight: number
  anchorBottom: number
}

/** État du peek de la sidebar poussé du Main vers la couche d'overlay. */
export interface SidebarPeekState {
  open: boolean
  /** Largeur courante de la sidebar (px) pour dimensionner le panneau. */
  width: number
}

/** Contexte d'ouverture de la palette de commande (façon Arc). */
export type CommandMode = 'newTab' | 'currentTab'

/**
 * Payload d'ouverture de la palette de commande transmis à la couche d'overlay.
 * `mode` décide le comportement d'Entrée sur une URL/recherche : `newTab` (Ctrl+T, « Nouvel
 * onglet ») crée un onglet ; `currentTab` (clic sur l'URL) navigue l'onglet actif.
 */
export interface CommandPalettePayload {
  mode: CommandMode
  activeId: string | null
  /** Texte pré-rempli dans le champ (ex. l'URL courante quand on clique dessus). */
  initialQuery?: string
}

/** Entrée d'historique de navigation (persistée). */
export interface HistoryEntry {
  url: string
  title: string
  favicon: string | null
  /** Nombre de visites (utilisé pour le classement frecency). */
  visitCount: number
  /** Timestamp (ms) de la dernière visite. */
  lastVisit: number
}
