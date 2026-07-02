import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { loadSession } from './persistence/sessionStore'
import { setupBrowser, type BrowserRuntime } from './ipc/registerIpc'

let runtime: BrowserRuntime | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    // Barre de titre masquée mais boutons natifs conservés (Window Controls Overlay) : Windows
    // dessine min/agrandir/fermer en haut à droite → les Snap Layouts (menu de disposition au
    // survol du bouton agrandir) fonctionnent nativement. Le reste de la barre reste custom.
    // `color`/`symbolColor` matchent la couleur `--sidebar` ; `height` = classe `h-8` de <TopBar>.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#04040a',
      symbolColor: '#dddde5',
      height: 32
    },
    backgroundColor: '#0b0b12',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Liens externes de l'UI React → navigateur système (les WebContentsView ont leur propre
  // politique, gérée dans TabManager).
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Runtime navigateur : TabManager + IPC + persistance.
  const session = loadSession()
  runtime = setupBrowser(mainWindow, session)

  mainWindow.on('closed', () => {
    runtime?.dispose()
    runtime = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.prism.browser')

  // Pas de menu applicatif : évite les accélérateurs par défaut (dont le DevTools docké natif
  // de Chromium, qui se superposerait à la page). Le DevTools est géré par TabManager.
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Sauvegarde synchrone de la session avant de quitter.
app.on('before-quit', () => {
  runtime?.persistNow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
