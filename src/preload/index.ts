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
  type SidebarPeekState,
  type SidebarToggleMaskState,
  type CommandPalettePayload,
  type HistoryEntry
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
  setSidebar: (intent: SidebarIntent): void => ipcRenderer.send(IPC.VIEW_SET_SIDEBAR, intent),
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

  // Couche d'overlay unique (au-dessus de la page). Depuis la fenêtre principale :
  openSiteControl: (payload: SiteControlPayload): void =>
    ipcRenderer.send(IPC.OVERLAY_SITE_CONTROL, payload),
  openSidebarPeek: (): void => ipcRenderer.send(IPC.SIDEBAR_PEEK_OPEN),
  openCommandPalette: (payload: CommandPalettePayload): void =>
    ipcRenderer.send(IPC.OVERLAY_COMMAND, payload),
  // Depuis la couche d'overlay elle-même :
  closeSiteControl: (): void => ipcRenderer.send(IPC.OVERLAY_CLOSE),
  closeCommandPalette: (): void => ipcRenderer.send(IPC.OVERLAY_COMMAND_CLOSE),
  closeSidebarPeek: (): void => ipcRenderer.send(IPC.SIDEBAR_PEEK_CLOSE),
  setOverlayIgnoreMouse: (ignore: boolean): void =>
    ipcRenderer.send(IPC.OVERLAY_SET_IGNORE, ignore),
  onSiteControlData: (cb: (payload: SiteControlPayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_SITE_CONTROL_DATA, cb),
  onCommandData: (cb: (payload: CommandPalettePayload | null) => void): (() => void) =>
    subscribe(IPC.OVERLAY_COMMAND_DATA, cb),
  onSidebarPeekState: (cb: (state: SidebarPeekState) => void): (() => void) =>
    subscribe(IPC.SIDEBAR_PEEK_STATE, cb),
  onSidebarToggleMask: (cb: (state: SidebarToggleMaskState) => void): (() => void) =>
    subscribe(IPC.SIDEBAR_TOGGLE_MASK, cb),

  // Contrôles de fenêtre (frameless)
  minimizeWindow: (): void => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  toggleMaximizeWindow: (): void => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  closeWindow: (): void => ipcRenderer.send(IPC.WINDOW_CLOSE),

  // Events (Main -> Renderer) — chaque `on*` renvoie un désabonnement
  onTabUpdated: (cb: (batch: TabUpdateBatch) => void): (() => void) =>
    subscribe(IPC.TAB_UPDATED, cb),
  onTabCreated: (cb: (tab: TabState) => void): (() => void) => subscribe(IPC.TAB_CREATED, cb),
  onTabClosed: (cb: (id: string) => void): (() => void) => subscribe(IPC.TAB_CLOSED, cb),
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
