import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/types'

/**
 * Contrôleur du "peek" de la sidebar repliée : une fenêtre-overlay native transparente qui
 * flotte AU-DESSUS de la `WebContentsView` sur le bord gauche (façon Arc). C'est la seule
 * façon de faire apparaître la sidebar par-dessus la page SANS la pousser — un panneau DOM
 * passerait derrière la vue web native.
 *
 * La fenêtre est persistante (créée une fois, réutilisée) et non-focusable : elle ne vole
 * jamais le focus de la page. L'ouverture/fermeture est animée côté renderer (translateX) ;
 * le Main se contente de la montrer (`showInactive`) puis de la masquer après l'animation.
 */
// Doit rester synchronisé avec TOPBAR_HEIGHT de TabManager (classe `h-11` de <TopBar>).
const TOPBAR_HEIGHT = 44
const CLOSE_ANIM_MS = 200

export class SidebarPeekOverlay {
  private win: BrowserWindow | null = null
  private visible = false
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private width = 256
  private ready = false

  constructor(private readonly parent: BrowserWindow) {
    // Préchargement au démarrage : la fenêtre (cachée) est prête AVANT le premier survol, ce
    // qui évite la course où `peekState` serait envoyé avant que le renderer ne soit abonné.
    this.ensureWindow()
  }

  /** Révèle le peek au survol du bord gauche. `width` = largeur courante de la sidebar. */
  open(width: number): void {
    this.width = Math.max(0, Math.round(width))
    const win = this.ensureWindow()
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.applyBounds()
    this.visible = true
    // showInactive : on affiche sans activer la fenêtre (le focus reste sur la page).
    win.showInactive()
    this.sendState()
  }

  /** Souris sortie du panneau : on joue l'animation de sortie puis on masque la fenêtre. */
  close(): void {
    if (!this.win || this.win.isDestroyed() || !this.visible) return
    this.visible = false
    this.sendState()
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (this.win && !this.win.isDestroyed() && !this.visible) this.win.hide()
    }, CLOSE_ANIM_MS)
  }

  /** Envoie l'état courant au renderer (no-op tant que la page n'a pas fini de charger). */
  private sendState(): void {
    if (this.win && !this.win.isDestroyed() && this.ready) {
      this.win.webContents.send(IPC.SIDEBAR_PEEK_STATE, { open: this.visible })
    }
  }

  /** Repositionne/retaille l'overlay si le parent bouge ou est redimensionné pendant le peek. */
  reposition(): void {
    if (this.visible) this.applyBounds()
  }

  /** Relaie un batch `tab:updated` à l'overlay pour qu'il reste synchronisé en direct. */
  forwardBatch(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

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
      focusable: false, // ne vole jamais le focus de la page (flyout au survol)
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    win.setMenu(null)
    this.win = win
    this.ready = false

    // Une fois la page chargée et le renderer abonné, on (re)synchronise l'état courant.
    win.webContents.on('did-finish-load', () => {
      this.ready = true
      this.sendState()
    })

    const query = 'overlay=sidebarPeek'
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }

    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.ready = false
        this.visible = false
      }
    })
    return win
  }

  private applyBounds(): void {
    if (!this.win || this.win.isDestroyed()) return
    const cb = this.parent.getContentBounds()
    this.win.setBounds({
      x: cb.x,
      y: cb.y + TOPBAR_HEIGHT,
      width: this.width,
      height: Math.max(0, cb.height - TOPBAR_HEIGHT)
    })
  }

  dispose(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
    if (this.win && !this.win.isDestroyed()) this.win.close()
    this.win = null
  }
}
