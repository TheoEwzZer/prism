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
  /** Nom personnalisé (« Renommer ») ; prioritaire sur `title` à l'affichage. null = titre auto. */
  customTitle?: string | null
}

/** Dossier rétractable de la sidebar (espace / groupe d'onglets). */
export interface FolderState {
  id: string
  name: string
  collapsed: boolean
}

/** Orientation d'une vue divisée : `horizontal` = côte à côte (G→D), `vertical` = empilé (H→B). */
export type SplitOrientation = 'horizontal' | 'vertical'

/**
 * Vue divisée (façon Arc) : deux onglets affichés simultanément. `tabIds` est ordonné dans le sens
 * visuel (gauche→droite pour `horizontal`, haut→bas pour `vertical`). MVP : exactement 2 panneaux.
 */
export interface SplitState {
  id: string
  orientation: SplitOrientation
  tabIds: [string, string]
}

/** Position du NOUVEAU panneau relativement à l'onglet actif (choix du menu de la TopBar). */
export type SplitPosition = 'right' | 'left' | 'top' | 'bottom'

/** Demande de création d'une vue divisée (Renderer -> Main, orchestrée par le Main). */
export interface SplitCreateInput {
  position: SplitPosition
  /** Onglet source (deviendra l'autre panneau de la division). */
  sourceId: string
  /**
   * URL à charger directement dans le NOUVEAU panneau (ex. « Ouvrir le lien dans une vue divisée »).
   * Si absent, le panneau est vierge et la palette de commande s'ouvre pour choisir le site.
   */
  url?: string
}

/**
 * Crée une vue divisée à partir de DEUX onglets EXISTANTS (drag & drop d'un onglet sur un autre dans
 * la sidebar). `firstId` = panneau gauche, `secondId` = panneau droit (l'onglet déposé). Pas de
 * nouvel onglet ni de palette.
 */
export interface SplitFromTabsInput {
  firstId: string
  secondId: string
}

/**
 * Vue divisée créée, diffusée par le Main aux DEUX fenêtres en UN SEUL event atomique : le nouvel
 * onglet + la division + le focus sont appliqués ensemble (un seul `set`). Indispensable pour éviter
 * une course de persistance : si l'onglet était ajouté séparément (tab:created), la fenêtre
 * renverrait un `saveUiState` avec `splits` encore vide, écrasant la division tout juste créée.
 */
export interface SplitCreatedPayload {
  tab: TabState
  split: SplitState
  focusedId: string
}

// ---------------------------------------------------------------------------
// Géométrie du layout — source UNIQUE partagée Main <-> Renderer.
//
// Le Main l'utilise pour les bounds natifs des WebContentsView ; le Renderer l'utilise pour
// positionner les barres d'outils par panneau (vue divisée), en coordonnées client alignées 1:1.
// ---------------------------------------------------------------------------

/** Hauteur de la barre supérieure pleine largeur (doit rester synchro avec la classe `h-8`). */
export const TOPBAR_HEIGHT = 32
/** Marge autour de la vue (look "carte" arrondie façon Arc). */
export const VIEW_INSET = 8
export const VIEW_RADIUS = 10
/** Hauteur de la barre d'outils propre à chaque panneau en vue divisée. */
export const SPLIT_TOOLBAR_HEIGHT = 36

export interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}

/** Aire de base disponible pour la/les vue(s) web (sous la top bar, à droite de la sidebar). */
export function contentArea(
  contentW: number,
  contentH: number,
  effectiveSidebar: number
): LayoutRect {
  return {
    x: effectiveSidebar + VIEW_INSET,
    y: TOPBAR_HEIGHT,
    width: Math.max(0, contentW - effectiveSidebar - VIEW_INSET * 2),
    height: Math.max(0, contentH - TOPBAR_HEIGHT - VIEW_INSET)
  }
}

/** Découpe une aire en deux moitiés (gouttière `VIEW_INSET`) selon l'orientation. */
function splitHalves(area: LayoutRect, orientation: SplitOrientation): [LayoutRect, LayoutRect] {
  if (orientation === 'horizontal') {
    const wHalf = Math.max(0, Math.floor((area.width - VIEW_INSET) / 2))
    return [
      { x: area.x, y: area.y, width: wHalf, height: area.height },
      {
        x: area.x + wHalf + VIEW_INSET,
        y: area.y,
        width: Math.max(0, area.width - wHalf - VIEW_INSET),
        height: area.height
      }
    ]
  }
  const hHalf = Math.max(0, Math.floor((area.height - VIEW_INSET) / 2))
  return [
    { x: area.x, y: area.y, width: area.width, height: hHalf },
    {
      x: area.x,
      y: area.y + hHalf + VIEW_INSET,
      width: area.width,
      height: Math.max(0, area.height - hHalf - VIEW_INSET)
    }
  ]
}

/**
 * Layout d'une vue divisée : pour chaque panneau, le rect de sa barre d'outils (haut) et de sa
 * vue web (dessous). Ratio 50/50 fixe (MVP).
 */
export function splitPaneLayout(
  contentW: number,
  contentH: number,
  effectiveSidebar: number,
  orientation: SplitOrientation
): Array<{ toolbar: LayoutRect; view: LayoutRect }> {
  const area = contentArea(contentW, contentH, effectiveSidebar)
  return splitHalves(area, orientation).map((h) => ({
    toolbar: { x: h.x, y: h.y, width: h.width, height: SPLIT_TOOLBAR_HEIGHT },
    view: {
      x: h.x,
      y: h.y + SPLIT_TOOLBAR_HEIGHT,
      width: h.width,
      height: Math.max(0, h.height - SPLIT_TOOLBAR_HEIGHT)
    }
  }))
}

/**
 * Demande d'activation d'une division (browser state) : le Main affiche les deux vues natives.
 * `focusedId` = panneau qui reçoit le focus clavier.
 */
export interface SplitActivatePayload {
  orientation: SplitOrientation
  tabIds: [string, string]
  focusedId: string
}

/**
 * Menu « Options de vue divisée » (bouton de la TopBar), rendu dans la couche d'overlay (au-dessus
 * de la vue web native). `x`/`y` = coin haut-gauche voulu, en coordonnées client (alignées 1:1 sur
 * la fenêtre principale). `activeId` = onglet source qui deviendra un des panneaux.
 */
export interface SplitMenuPayload {
  x: number
  y: number
  activeId: string | null
}

/**
 * Menu d'options d'UN panneau d'une vue divisée (bouton dans sa barre d'outils), rendu dans la
 * couche d'overlay. Permet de déplacer ce panneau, le séparer de la vue, ou convertir l'orientation.
 */
export interface SplitPaneMenuPayload {
  x: number
  y: number
  splitId: string
  paneId: string
}

/** « Séparer de la vue » : dissout la division mais garde les onglets (celui-ci devient actif). */
export interface SplitDetachPayload {
  splitId: string
  /** Panneau conservé actif en plein écran. L'autre reste un onglet normal. */
  keepId: string
}

/** État de session persisté sur disque et restauré au démarrage. */
export interface SessionData {
  tabs: TabState[]
  folders: FolderState[]
  /** Ordre d'affichage des onglets (ids) au niveau racine + dans les dossiers. */
  order: string[]
  /** Onglets « favoris » (épinglés), dans l'ordre de la liste de favoris de la sidebar. */
  pinnedTabIds: string[]
  /** Vues divisées actives (façon Arc). */
  splits: SplitState[]
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
  splits: SplitState[]
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
  splits: SplitState[]
  activeTabId: string | null
}

/** Intention de layout envoyée par le Renderer (jamais de pixels de bounds bruts). */
export interface SidebarIntent {
  width: number
  collapsed: boolean
}

/**
 * Contraintes de largeur de la sidebar (px). `DEFAULT` = largeur historique (taille de base). La
 * même largeur sert le mode déployé (toggle) ET le peek — c'est la source unique `sidebarWidth`.
 */
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 460
export const SIDEBAR_DEFAULT_WIDTH = 256

/** Borne une largeur de sidebar demandée dans [MIN, MAX] (arrondie au pixel). */
export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
}

/**
 * Layout courant de la sidebar poussé du Main vers la couche d'overlay : lui permet de positionner
 * la poignée de resize sur le bord droit de la sidebar déployée (mode toggle), le peek ayant sa
 * propre largeur via `SidebarPeekState`.
 */
export interface SidebarLayoutState {
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
  TAB_HIBERNATE: 'tab:hibernate', // send : hiberne manuellement un onglet (menu contextuel)
  SPLIT_CREATE: 'split:create', // send : crée une vue divisée (orchestré par le Main)
  SPLIT_CREATE_FROM_TABS: 'split:createFromTabs', // send : divise deux onglets existants (drag&drop)
  SPLIT_ACTIVATE: 'split:activate', // send : affiche une vue divisée (2 vues natives simultanées)
  SPLIT_MOVE: 'split:move', // send : échange les deux panneaux d'une division
  SPLIT_CONVERT: 'split:convert', // send : bascule l'orientation d'une division (H <-> V)
  SPLIT_DETACH: 'split:detach', // send : dissout la division en gardant les onglets
  TAB_RENAME: 'tab:rename', // send : renomme un onglet (customTitle) via le menu contextuel
  TAB_RENAME_STATE: 'tab:renameState', // window <-> Main : onglet en édition inline (id | null), diffusé
  VIEW_SET_SIDEBAR: 'view:setSidebar',
  SESSION_SAVE_UI: 'session:saveUi',
  OPEN_EXTERNAL: 'app:openExternal',
  CLIPBOARD_WRITE: 'app:clipboardWrite',
  HISTORY_SEARCH: 'history:search', // invoke : recherche dans l'historique local (frecency)
  HISTORY_REMOVE: 'history:remove', // send : supprime toutes les visites d'une URL (palette)
  HISTORY_LIST: 'history:list', // invoke : page chronologique de l'historique (page Historique)
  HISTORY_REMOVE_VISIT: 'history:removeVisit', // send : supprime une visite précise (par id)
  HISTORY_CLEAR: 'history:clear', // send : efface l'historique (tout ou depuis un timestamp)
  SUGGEST_QUERY: 'suggest:query', // invoke : suggestions de recherche (Google Suggest)
  // Couche d'overlay unique : UNE fenêtre transparente persistante qui recouvre toute la zone
  // contenu et flotte AU-DESSUS de la WebContentsView (peek de la sidebar + Contrôles du site
  // + futurs menus). Ouverture instantanée, animations CSS, click-through géré par hit-test.
  OVERLAY_SITE_CONTROL: 'overlay:siteControl', // main -> Main : ouvrir les Contrôles du site
  OVERLAY_CLOSE: 'overlay:close', // overlay -> Main : fermer les Contrôles du site
  OVERLAY_SET_IGNORE: 'overlay:setIgnore', // overlay -> Main : capter/laisser passer la souris
  OVERLAY_TAB_MENU: 'overlay:tabMenu', // main -> Main : clic droit sur un onglet (menu contextuel)
  OVERLAY_TAB_MENU_CLOSE: 'overlay:tabMenuClose', // overlay -> Main : fermer le menu contextuel
  OVERLAY_SPLIT_MENU: 'overlay:splitMenu', // main -> Main : ouvrir le menu « Options de vue divisée »
  OVERLAY_SPLIT_MENU_CLOSE: 'overlay:splitMenuClose', // overlay -> Main : fermer le menu split
  OVERLAY_PANE_MENU: 'overlay:paneMenu', // main -> Main : ouvrir le menu d'options d'un panneau
  OVERLAY_PANE_MENU_CLOSE: 'overlay:paneMenuClose', // overlay -> Main : fermer le menu de panneau
  OVERLAY_PAGE_MENU_CLOSE: 'overlay:pageMenuClose', // overlay -> Main : fermer le menu contextuel de page
  OVERLAY_PAGE_ACTION: 'overlay:pageAction', // overlay -> Main : exécuter une action sur le WebContents
  SIDEBAR_PEEK_OPEN: 'sidebar:peekOpen', // main -> Main : survol du bord gauche
  SIDEBAR_PEEK_CLOSE: 'sidebar:peekClose', // overlay -> Main : souris sortie du panneau
  SIDEBAR_SET_WIDTH: 'sidebar:setWidth', // overlay -> Main : drag de la poignée de resize (px)
  OVERLAY_COMMAND: 'overlay:command', // main/Main -> Main : ouvrir la palette de commande
  OVERLAY_COMMAND_CLOSE: 'overlay:commandClose', // overlay -> Main : fermer la palette
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  // Main -> Renderer (events)
  OVERLAY_SITE_CONTROL_DATA: 'overlay:siteControlData', // Main -> overlay : push données (ou null)
  OVERLAY_TAB_MENU_DATA: 'overlay:tabMenuData', // Main -> overlay : ouvrir/fermer le menu (ou null)
  OVERLAY_SPLIT_MENU_DATA: 'overlay:splitMenuData', // Main -> overlay : ouvrir/fermer le menu split
  OVERLAY_PANE_MENU_DATA: 'overlay:paneMenuData', // Main -> overlay : ouvrir/fermer le menu de panneau
  OVERLAY_PAGE_MENU_DATA: 'overlay:pageMenuData', // Main -> overlay : ouvrir/fermer le menu contextuel de page
  OVERLAY_COMMAND_DATA: 'overlay:commandData', // Main -> overlay : ouvrir/fermer la palette (ou null)
  HISTORY_OPEN: 'history:open', // Main -> Renderer : ouvrir/focus l'onglet prism://history/ (Ctrl+H)
  SIDEBAR_PEEK_STATE: 'sidebar:peekState', // Main -> overlay : ouverture/fermeture animée
  SIDEBAR_TOGGLE_MASK: 'sidebar:toggleMask', // Main -> overlay : masque animé du repli/dépli sidebar
  SIDEBAR_WIDTH: 'sidebar:width', // Main -> fenêtre principale : largeur suivie pendant le drag
  SIDEBAR_LAYOUT: 'sidebar:layout', // Main -> overlay : layout courant (poignée de resize déployée)
  UI_STATE_SYNC: 'ui:stateSync', // Main -> autres fenêtres : convergence de l'état organisationnel
  TAB_UPDATED: 'tab:updated',
  TAB_CREATED: 'tab:created',
  TAB_CLOSED: 'tab:closed',
  SPLIT_CREATED: 'split:created', // Main -> deux fenêtres : onglet + division + focus (atomique)
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

/**
 * Masque animé du repli/dépli de la sidebar, poussé du Main vers la couche d'overlay. La vraie vue
 * web + la vraie sidebar DOM se calent INSTANTANÉMENT à leur état final ; toute l'animation vit dans
 * ce masque (copie de la sidebar) qui anime sa largeur en CSS/GPU par-dessus la vue native — fluide,
 * impossible à obtenir en repositionnant la vue native frame par frame. Repli = plein → 0 ; dépli =
 * 0 → plein (miroir exact).
 */
export interface SidebarToggleMaskState {
  visible: boolean
  /** Largeur cible à pleine ouverture (= largeur de la sidebar). */
  width: number
  /** Cible de l'animation : `true` = pleine largeur (dépli) ; `false` = 0 (repli). */
  expanded: boolean
}

/**
 * Menu contextuel d'un onglet (clic droit), rendu dans la couche d'overlay (au-dessus de la vue
 * web native). `x`/`y` sont en coordonnées client, alignées 1:1 sur la fenêtre principale.
 */
export interface TabMenuPayload {
  tabId: string
  url: string
  isHibernated: boolean
  x: number
  y: number
}

/**
 * Menu contextuel de la PAGE web (clic droit dans la `WebContentsView`), rendu dans la couche
 * d'overlay (au-dessus de la vue native). Émis par le Main à partir de l'event natif `context-menu`
 * du `WebContents`. `x`/`y` sont en coordonnées client (alignées 1:1 sur la fenêtre principale)
 * pour positionner le menu ; `pageX`/`pageY` restent relatifs à la page (pour `inspect`/`copyImage`).
 */
export interface PageMenuPayload {
  tabId: string
  x: number
  y: number
  pageX: number
  pageY: number
  canGoBack: boolean
  canGoForward: boolean
  /** URL du lien sous le curseur (chaîne vide si aucun). */
  linkURL: string
  /** URL de la ressource média sous le curseur (image/vidéo…). */
  srcURL: string
  /** Type de média sous le curseur : `'none' | 'image' | 'video' | 'audio' | ...`. */
  mediaType: string
  /** Texte sélectionné sous le curseur (chaîne vide si aucun). */
  selectionText: string
  /** Le curseur est-il dans un champ éditable (input/textarea/contenteditable) ? */
  isEditable: boolean
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
  /** URL de la page courante (cible de « Copier l'adresse » / « Afficher le code source »). */
  pageURL: string
}

/**
 * Action du menu contextuel de page qui doit s'exécuter sur le `WebContents` natif (Main). Les
 * actions purement Renderer (copier du texte, ouvrir un onglet, rechercher) passent par les canaux
 * existants (`copyText`, `createTab`) et ne figurent pas ici.
 */
export type PageMenuAction =
  | { type: 'print' }
  | { type: 'inspect'; x: number; y: number }
  | { type: 'copyImage'; x: number; y: number }
  | { type: 'saveImage'; url: string }
  | { type: 'saveLink'; url: string }
  | { type: 'cut' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'selectAll' }

/** Enveloppe d'une action de menu de page (overlay -> Main). */
export interface PageMenuActionInput {
  tabId: string
  action: PageMenuAction
}

/**
 * Contexte d'ouverture de la palette de commande (façon Arc).
 * - `newTab` : Entrée crée un onglet.
 * - `currentTab` : Entrée navigue l'onglet actif (`activeId`).
 * - `split` : ouverte pour remplir le panneau vide d'une vue divisée (`activeId` = ce panneau).
 *   Entrée navigue ce panneau ; choisir un onglet ouvert charge SON URL dans ce panneau (pas de
 *   switch, qui dissoudrait le split).
 */
export type CommandMode = 'newTab' | 'currentTab' | 'split'

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

/**
 * Entrée d'historique AGRÉGÉE par URL (frecency). Sert la palette de commande, dérivée du
 * journal des visites.
 */
export interface HistoryEntry {
  url: string
  title: string
  favicon: string | null
  /** Nombre de visites (utilisé pour le classement frecency). */
  visitCount: number
  /** Timestamp (ms) de la dernière visite. */
  lastVisit: number
}

/**
 * Visite individuelle (une ligne par navigation), source de vérité de l'historique. La page
 * Historique (Ctrl+H) affiche ces visites groupées par jour ; l'agrégat frecency en est dérivé.
 */
export interface VisitEntry {
  /** Identifiant stable d'une visite (suppression unitaire). */
  id: string
  url: string
  title: string
  favicon: string | null
  /** Timestamp (ms) de la visite. */
  ts: number
}

/** Requête paginée de la page Historique (filtrage + pagination côté Main). */
export interface HistoryListInput {
  /** Filtre plein texte (title/url), insensible à la casse. */
  query?: string
  /** Nombre de visites déjà chargées (défilement infini). */
  offset?: number
  /** Taille de page (borne côté Main). */
  limit?: number
}

/** Page de visites renvoyée par le Main (triée du plus récent au plus ancien). */
export interface HistoryListResult {
  items: VisitEntry[]
  /** Reste-t-il des visites au-delà de cette page (pour le défilement infini) ? */
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Pages internes (prism://…)
//
// Une page interne est un onglet SANS `WebContentsView` : le Main masque la vue native et le
// chrome React (WebViewArea) rend le composant correspondant. Cf. principe fondateur (vue native
// au-dessus du DOM React) — une page interne est du pur UI state, donc rendue par le Renderer.
// ---------------------------------------------------------------------------

/** URL canonique de la page Historique (Ctrl+H). */
export const HISTORY_URL = 'prism://history/'

/** Vrai si l'URL désigne une page interne Prism (rendue par le chrome React, pas de vue native). */
export function isInternalUrl(url: string): boolean {
  return /^prism:\/\//i.test(url)
}

/** Titre affiché (sidebar / Omnibox) d'une page interne. */
export function internalPageTitle(url: string): string {
  if (/^prism:\/\/history/i.test(url)) return 'Historique'
  return 'Prism'
}
