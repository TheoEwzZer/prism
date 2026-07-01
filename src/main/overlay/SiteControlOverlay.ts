import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { SiteControlPayload } from '@shared/types'

/**
 * Contrôleur d'une fenêtre-overlay native (transparente, sans cadre, always-on-top) qui
 * flotte AU-DESSUS de la `WebContentsView` — la seule façon de rendre un menu par-dessus la
 * page sans la masquer (une WebContentsView se peint toujours au-dessus du DOM React).
 *
 * La fenêtre est dimensionnée exactement au menu → elle ne recouvre pas le reste de la page,
 * donc les clics ailleurs atteignent normalement la page (pas de click-through à gérer).
 * Elle se ferme automatiquement à la perte de focus (comportement d'un vrai menu).
 */
const DEFAULT_W = 300
const DEFAULT_H = 190
const GAP = 6

export class SiteControlOverlay {
  private win: BrowserWindow | null = null
  private payload: SiteControlPayload | null = null
  private anchor = { rightX: 0, topY: 0 } // coordonnées écran

  constructor(private readonly parent: BrowserWindow) {}

  getData(): SiteControlPayload | null {
    return this.payload
  }

  open(payload: SiteControlPayload): void {
    this.destroyWindow()
    this.payload = payload

    const cb = this.parent.getContentBounds()
    this.anchor = {
      rightX: cb.x + payload.anchorRight,
      topY: cb.y + payload.anchorBottom + GAP
    }

    const win = new BrowserWindow({
      parent: this.parent,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      focusable: true,
      width: DEFAULT_W,
      height: DEFAULT_H,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    win.setMenu(null)
    this.win = win
    this.applyBounds(DEFAULT_W, DEFAULT_H)

    const query = 'overlay=siteControl'
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }

    win.once('ready-to-show', () => win.show())
    win.on('blur', () => this.close())
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.payload = null
      }
    })
  }

  /** Ajuste la taille au contenu mesuré côté renderer, en gardant l'alignement à droite. */
  resize(width: number, height: number): void {
    this.applyBounds(Math.round(width), Math.round(height))
  }

  private applyBounds(width: number, height: number): void {
    if (!this.win || this.win.isDestroyed()) return
    this.win.setBounds({
      x: Math.round(this.anchor.rightX - width),
      y: Math.round(this.anchor.topY),
      width,
      height
    })
  }

  close(): void {
    this.destroyWindow()
    this.payload = null
  }

  private destroyWindow(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
    this.win = null
  }

  dispose(): void {
    this.close()
  }
}
