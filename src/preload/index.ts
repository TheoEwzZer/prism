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
  type WindowState
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

  // Contrôles de fenêtre (frameless)
  minimizeWindow: (): void => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  toggleMaximizeWindow: (): void => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  closeWindow: (): void => ipcRenderer.send(IPC.WINDOW_CLOSE),

  // Events (Main -> Renderer) — chaque `on*` renvoie un désabonnement
  onTabUpdated: (cb: (batch: TabUpdateBatch) => void): (() => void) =>
    subscribe(IPC.TAB_UPDATED, cb),
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
