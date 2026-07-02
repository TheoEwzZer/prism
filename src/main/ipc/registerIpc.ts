import { ipcMain, shell, clipboard, type BrowserWindow } from 'electron'
import {
  IPC,
  type SessionData,
  type TabPatch,
  type CreateTabInput,
  type SidebarIntent,
  type UiPersistState,
  type SiteControlPayload,
  type CommandPalettePayload
} from '@shared/types'
import { TabManager } from '../tabs/TabManager'
import { OverlayLayer } from '../overlay/OverlayLayer'
import { FrameCoalescer } from '../utils/scheduler'
import { saveSession, flushSession } from '../persistence/sessionStore'

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
  const tabManager = new TabManager(window, emitPatch, () =>
    overlay.toggleCommand({ mode: 'newTab', activeId: tabManager.getActiveTabId() })
  )

  // Restauration lazy : on enregistre les metas (hibernées), sans créer de vue.
  for (const meta of initialSession.tabs) tabManager.registerTab(meta)
  tabManager.setSidebar(session.sidebarWidth, session.sidebarCollapsed)

  // --- Persistance (debouncée) ---
  function buildSession(): SessionData {
    return {
      tabs: tabManager.getAllMeta(),
      folders: session.folders,
      pinnedApps: session.pinnedApps,
      order: session.order,
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
    // Diffusion à la fenêtre principale : c'est la SEULE source qui ajoute l'onglet au store UI
    // (peu importe l'initiateur — sidebar, favori, ou palette de commande dans l'overlay).
    if (!window.isDestroyed()) window.webContents.send(IPC.TAB_CREATED, meta)
    persist()
    return meta
  })

  ipcMain.on(IPC.TAB_CLOSE, (_e, id: string) => {
    tabManager.closeTab(id)
    persist()
  })
  ipcMain.on(IPC.TAB_ACTIVATE, (_e, id: string) => {
    tabManager.activateTab(id)
    persist()
  })
  ipcMain.on(IPC.TAB_NAVIGATE, (_e, payload: { id: string; input: string }) => {
    tabManager.navigate(payload.id, payload.input)
  })
  ipcMain.on(IPC.TAB_BACK, (_e, id: string) => tabManager.goBack(id))
  ipcMain.on(IPC.TAB_FORWARD, (_e, id: string) => tabManager.goForward(id))
  ipcMain.on(IPC.TAB_RELOAD, (_e, id: string) => tabManager.reload(id))

  ipcMain.on(IPC.VIEW_SET_SIDEBAR, (_e, intent: SidebarIntent) => {
    session.sidebarWidth = intent.width
    session.sidebarCollapsed = intent.collapsed
    tabManager.setSidebar(intent.width, intent.collapsed)
  })

  ipcMain.on(IPC.OPEN_EXTERNAL, (_e, url: string) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
  ipcMain.on(IPC.CLIPBOARD_WRITE, (_e, text: string) => clipboard.writeText(text))

  // Couche d'overlay unique (au-dessus de la page).
  ipcMain.on(IPC.OVERLAY_SITE_CONTROL, (_e, payload: SiteControlPayload) =>
    overlay.toggleSiteControl(payload)
  )
  ipcMain.on(IPC.OVERLAY_CLOSE, () => overlay.hideSiteControl())
  ipcMain.on(IPC.OVERLAY_COMMAND, (_e, payload: CommandPalettePayload) =>
    overlay.toggleCommand(payload)
  )
  ipcMain.on(IPC.OVERLAY_COMMAND_CLOSE, () => overlay.hideCommand())
  ipcMain.on(IPC.OVERLAY_SET_IGNORE, (_e, ignore: boolean) => overlay.setIgnore(ignore))
  ipcMain.on(IPC.SIDEBAR_PEEK_OPEN, () => overlay.openPeek(session.sidebarWidth))
  ipcMain.on(IPC.SIDEBAR_PEEK_CLOSE, () => overlay.closePeek())

  ipcMain.on(IPC.SESSION_SAVE_UI, (_e, ui: UiPersistState) => {
    session.order = ui.order
    session.folders = ui.folders
    session.pinnedApps = ui.pinnedApps
    session.activeTabId = ui.activeTabId
    session.sidebarWidth = ui.sidebarWidth
    session.sidebarCollapsed = ui.sidebarCollapsed
    persist()
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
    for (const ch of [IPC.SESSION_GET, IPC.TAB_CREATE]) {
      ipcMain.removeHandler(ch)
    }
    ipcMain.removeAllListeners(IPC.TAB_CLOSE)
    ipcMain.removeAllListeners(IPC.TAB_ACTIVATE)
    ipcMain.removeAllListeners(IPC.TAB_NAVIGATE)
    ipcMain.removeAllListeners(IPC.TAB_BACK)
    ipcMain.removeAllListeners(IPC.TAB_FORWARD)
    ipcMain.removeAllListeners(IPC.TAB_RELOAD)
    ipcMain.removeAllListeners(IPC.VIEW_SET_SIDEBAR)
    ipcMain.removeAllListeners(IPC.OPEN_EXTERNAL)
    ipcMain.removeAllListeners(IPC.CLIPBOARD_WRITE)
    ipcMain.removeAllListeners(IPC.OVERLAY_SITE_CONTROL)
    ipcMain.removeAllListeners(IPC.OVERLAY_CLOSE)
    ipcMain.removeAllListeners(IPC.OVERLAY_COMMAND)
    ipcMain.removeAllListeners(IPC.OVERLAY_COMMAND_CLOSE)
    ipcMain.removeAllListeners(IPC.OVERLAY_SET_IGNORE)
    ipcMain.removeAllListeners(IPC.SIDEBAR_PEEK_OPEN)
    ipcMain.removeAllListeners(IPC.SIDEBAR_PEEK_CLOSE)
    ipcMain.removeAllListeners(IPC.SESSION_SAVE_UI)
    ipcMain.removeAllListeners(IPC.WINDOW_MINIMIZE)
    ipcMain.removeAllListeners(IPC.WINDOW_MAXIMIZE)
    ipcMain.removeAllListeners(IPC.WINDOW_CLOSE)
  }

  const persistNow = (): void => {
    saveSession(buildSession(), 0)
    flushSession()
  }

  return { tabManager, persistNow, dispose }
}
