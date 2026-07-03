import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type SessionData,
  type TabState,
  type TabUpdateBatch,
  type CreateTabInput,
  type SidebarIntent,
  type UiPersistState,
  type UiSyncState,
  type WindowState,
  type SiteControlPayload,
  type TabMenuPayload,
  type SidebarPeekState,
  type SidebarToggleMaskState,
  type SidebarLayoutState,
  type CommandPalettePayload,
  type HistoryEntry,
  type HistoryListInput,
  type HistoryListResult,
  type SplitActivatePayload,
  type SplitMenuPayload,
  type SplitCreateInput,
  type SplitCreatedPayload,
  type SplitFromTabsInput,
  type SplitPaneMenuPayload,
  type SplitDetachPayload,
  type PageMenuPayload,
  type PageMenuAction
} from '@shared/types'

/** Abonnement typé à un event Main -> Renderer ; retourne une fonction de désabonnement. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/**
 * API sécurisée exposée au Renderer. Whitelist stricte : seuls les canaux définis dans
 * `IPC` sont accessibles, aucune primitive `invoke/send` générique n'est exposée.
 */
const prism = {
  // Commandes (Renderer -> Main)
  getSession: (): Promise<SessionData> => ipcRenderer.invoke(IPC.SESSION_GET),
  createTab: (input: CreateTabInput): Promise<TabState> =>
    ipcRenderer.invoke(IPC.TAB_CREATE, input),
  closeTab: (id: string): void => ipcRenderer.send(IPC.TAB_CLOSE, id),
  activateTab: (id: string): void => ipcRenderer.send(IPC.TAB_ACTIVATE, id),
  navigate: (id: string, input: string): void => ipcRenderer.send(IPC.TAB_NAVIGATE, { id, input }),
  goBack: (id: string): void => ipcRenderer.send(IPC.TAB_BACK, id),
  goForward: (id: string): void => ipcRenderer.send(IPC.TAB_FORWARD, id),
  reload: (id: string): void => ipcRenderer.send(IPC.TAB_RELOAD, id),
  hibernateTab: (id: string): void => ipcRenderer.send(IPC.TAB_HIBERNATE, id),
  createSplit: (input: SplitCreateInput): void => ipcRenderer.send(IPC.SPLIT_CREATE, input),
  createSplitFromTabs: (input: SplitFromTabsInput): void =>
    ipcRenderer.send(IPC.SPLIT_CREATE_FROM_TABS, input),
  activateSplit: (payload: SplitActivatePayload): void =>
    ipcRenderer.send(IPC.SPLIT_ACTIVATE, payload),
  moveSplit: (splitId: string): void => ipcRenderer.send(IPC.SPLIT_MOVE, splitId),
  convertSplit: (splitId: string): void => ipcRenderer.send(IPC.SPLIT_CONVERT, splitId),
  detachSplit: (payload: SplitDetachPayload): void => ipcRenderer.send(IPC.SPLIT_DETACH, payload),
  renameTab: (id: string, title: string | null): void =>
    ipcRenderer.send(IPC.TAB_RENAME, { id, title }),
  // Démarre/arrête l'édition inline d'un onglet (id ou null) ; le Main diffuse aux deux fenêtres.
  setTabRenaming: (id: string | null): void => ipcRenderer.send(IPC.TAB_RENAME_STATE, id),
  onTabRenaming: (cb: (id: string | null) => void): (() => void) =>
    subscribe(IPC.TAB_RENAME_STATE, cb),
  setSidebar: (intent: SidebarIntent): void => ipcRenderer.send(IPC.VIEW_SET_SIDEBAR, intent),
  // Drag de la poignée de resize (émis par la couche d'overlay qui possède le geste).
  setSidebarWidth: (width: number): void => ipcRenderer.send(IPC.SIDEBAR_SET_WIDTH, width),
  saveUiState: (ui: UiPersistState): void => ipcRenderer.send(IPC.SESSION_SAVE_UI, ui),

  // Utilitaires
  openExternal: (url: string): void => ipcRenderer.send(IPC.OPEN_EXTERNAL, url),
  copyText: (text: string): void => ipcRenderer.send(IPC.CLIPBOARD_WRITE, text),

  // Historique + suggestions (palette de commande)
  searchHistory: (query: string, limit?: number): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IPC.HISTORY_SEARCH, { query, limit }),
  removeHistory: (url: string): void => ipcRenderer.send(IPC.HISTORY_REMOVE, url),
  getSuggestions: (query: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.SUGGEST_QUERY, query),

  // Page Historique (onglet interne prism://history/)
  listHistory: (input: HistoryListInput): Promise<HistoryListResult> =>
    ipcRenderer.invoke(IPC.HISTORY_LIST, input),
  removeVisit: (id: string): void => ipcRenderer.send(IPC.HISTORY_REMOVE_VISIT, id),
  clearHistory: (since?: number): void => ipcRenderer.send(IPC.HISTORY_CLEAR, since),
  // Main -> Renderer : Ctrl+H frappé depuis une page → ouvrir/focus l'onglet historique.
  onOpenHistory: (cb: () => void): (() => void) => subscribe(IPC.HISTORY_OPEN, cb),

  // Couche d'overlay unique (au-dessus de la page). Depuis la fenêtre principale :
  openSiteControl: (payload: SiteControlPayload): void =>
    ipcRenderer.send(IPC.OVERLAY_SITE_CONTROL, payload),
  openSidebarPeek: (): void => ipcRenderer.send(IPC.SIDEBAR_PEEK_OPEN),
  openTabMenu: (payload: TabMenuPayload): void => ipcRenderer.send(IPC.OVERLAY_TAB_MENU, payload),
  openSplitMenu: (payload: SplitMenuPayload): void =>
    ipcRenderer.send(IPC.OVERLAY_SPLIT_MENU, payload),
  openPaneMenu: (payload: SplitPaneMenuPayload): void =>
    ipcRenderer.send(IPC.OVERLAY_PANE_MENU, payload),
  openCommandPalette: (payload: CommandPalettePayload): void =>
    ipcRenderer.send(IPC.OVERLAY_COMMAND, payload),
  // Depuis la couche d'overlay elle-même :
  closeSiteControl: (): void => ipcRenderer.send(IPC.OVERLAY_CLOSE),
  closeCommandPalette: (): void => ipcRenderer.send(IPC.OVERLAY_COMMAND_CLOSE),
  closeSplitMenu: (): void => ipcRenderer.send(IPC.OVERLAY_SPLIT_MENU_CLOSE),
  closePaneMenu: (): void => ipcRenderer.send(IPC.OVERLAY_PANE_MENU_CLOSE),
  closeSidebarPeek: (): void => ipcRenderer.send(IPC.SIDEBAR_PEEK_CLOSE),
  closeTabMenu: (): void => ipcRenderer.send(IPC.OVERLAY_TAB_MENU_CLOSE),
  closePageMenu: (): void => ipcRenderer.send(IPC.OVERLAY_PAGE_MENU_CLOSE),
  // Menu contextuel de page : exécute une action nécessitant le WebContents natif (Main).
  pageMenuAction: (tabId: string, action: PageMenuAction): void =>
    ipcRenderer.send(IPC.OVERLAY_PAGE_ACTION, { tabId, action }),
  onPageMenuData: (cb: (payload: PageMenuPayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_PAGE_MENU_DATA, cb),
  setOverlayIgnoreMouse: (ignore: boolean): void =>
    ipcRenderer.send(IPC.OVERLAY_SET_IGNORE, ignore),
  onSiteControlData: (cb: (payload: SiteControlPayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_SITE_CONTROL_DATA, cb),
  onTabMenuData: (cb: (payload: TabMenuPayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_TAB_MENU_DATA, cb),
  onSplitMenuData: (cb: (payload: SplitMenuPayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_SPLIT_MENU_DATA, cb),
  onPaneMenuData: (cb: (payload: SplitPaneMenuPayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_PANE_MENU_DATA, cb),
  onCommandData: (cb: (payload: CommandPalettePayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_COMMAND_DATA, cb),
  onSidebarPeekState: (cb: (state: SidebarPeekState) => void): (() => void) =>
    subscribe(IPC.SIDEBAR_PEEK_STATE, cb),
  onSidebarToggleMask: (cb: (state: SidebarToggleMaskState) => void): (() => void) =>
    subscribe(IPC.SIDEBAR_TOGGLE_MASK, cb),
  // Fenêtre principale : largeur poussée par le Main pendant un drag (la vraie sidebar DOM suit).
  onSidebarWidth: (cb: (width: number) => void): (() => void) => subscribe(IPC.SIDEBAR_WIDTH, cb),
  // Couche d'overlay : layout courant pour positionner la poignée de resize en mode déployé.
  onSidebarLayout: (cb: (state: SidebarLayoutState) => void): (() => void) =>
    subscribe(IPC.SIDEBAR_LAYOUT, cb),

  // Contrôles de fenêtre (frameless)
  minimizeWindow: (): void => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  toggleMaximizeWindow: (): void => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  closeWindow: (): void => ipcRenderer.send(IPC.WINDOW_CLOSE),

  // Events (Main -> Renderer) — chaque `on*` renvoie un désabonnement
  onTabUpdated: (cb: (batch: TabUpdateBatch) => void): (() => void) =>
    subscribe(IPC.TAB_UPDATED, cb),
  onTabCreated: (cb: (tab: TabState) => void): (() => void) => subscribe(IPC.TAB_CREATED, cb),
  onTabClosed: (cb: (id: string) => void): (() => void) => subscribe(IPC.TAB_CLOSED, cb),
  onSplitCreated: (cb: (payload: SplitCreatedPayload) => void): (() => void) =>
    subscribe(IPC.SPLIT_CREATED, cb),
  onUiStateSync: (cb: (sync: UiSyncState) => void): (() => void) =>
    subscribe(IPC.UI_STATE_SYNC, cb),
  onWindowState: (cb: (state: WindowState) => void): (() => void) => subscribe(IPC.WINDOW_STATE, cb)
}

export type PrismApi = typeof prism

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('prism', prism)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (defined in dts)
  window.electron = electronAPI
  // @ts-ignore (defined in dts)
  window.prism = prism
}
