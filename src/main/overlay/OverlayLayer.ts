import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  IPC,
  type SiteControlPayload,
  type CommandPalettePayload,
  type TabMenuPayload
} from '@shared/types'

/** Durée de l'animation de repli/dépli (doit rester synchro avec la transition CSS du masque). */
const SIDEBAR_TOGGLE_MS = 200
/** Délai laissé à l'overlay pour peindre l'état initial du masque avant de lancer la transition. */
const MASK_PAINT_MS = 32

/**
 * Couche d'overlay UNIQUE (approche B). Une seule fenêtre transparente, sans cadre,
 * always-on-top, **persistante**, qui recouvre exactement la zone contenu de la fenêtre
 * principale et flotte AU-DESSUS de la `WebContentsView`. Elle héberge TOUTE l'UI au-dessus de
 * la page (peek de la sidebar, Contrôles du site, futurs menus) en DOM React.
 *
 * Avantages vs une fenêtre par overlay : ouverture **instantanée** (aucune création de fenêtre
 * par ouverture, plus de démarrage à froid du bundle), animations CSS, un seul process, et des
 * coordonnées client alignées 1:1 sur la fenêtre principale (l'overlay est calé sur ses bounds).
 *
 * La fenêtre reste toujours affichée mais **transparente et click-through** au repos
 * (`setIgnoreMouseEvents(true, { forward: true })`) : elle est invisible et laisse passer la
 * souris vers la page. Le renderer fait un hit-test sur `mousemove` (forwardé même en mode
 * ignore) et demande la capture (`ignore=false`) au survol d'un panneau, puis rend la main.
 */
export class OverlayLayer {
  private win: BrowserWindow | null = null
  private ready = false
  private siteControl: SiteControlPayload | null = null
  private tabMenu: TabMenuPayload | null = null
  private command: CommandPalettePayload | null = null
  private peekOpen = false
  // Largeur du peek mémorisée : conservée à la fermeture pour que le slide-out (`-translate-x-full`,
  // relatif à la largeur de l'élément) sorte réellement le panneau de l'écran au lieu de le laisser
  // déborder à `width: 0`.
  private peekWidth = 256
  private lastHideAt = 0
  // Timers de l'animation de toggle en cours (pour l'annuler si l'utilisateur re-bascule entre-temps).
  private toggleMaskTimers: ReturnType<typeof setTimeout>[] = []

  private readonly track = (): void => this.applyBounds()

  constructor(private readonly parent: BrowserWindow) {
    this.ensureWindow()
    parent.on('resize', this.track)
    parent.on('move', this.track)
    parent.on('maximize', this.track)
    parent.on('unmaximize', this.track)
    parent.on('restore', this.track)
  }

  // --- Commandes depuis la fenêtre principale ---

  /**
   * Clic sur le bouton ancre : bascule le popover. Ouvert → on ferme. Fermé → on ouvre, SAUF
   * si une fermeture vient d'avoir lieu (< 250 ms) : dans ce cas le clic sur le bouton a lui-même
   * provoqué le `blur` qui a fermé le popover, donc on ne le rouvre pas (vrai toggle).
   */
  toggleSiteControl(payload: SiteControlPayload): void {
    if (this.siteControl !== null) {
      this.hideSiteControl()
      return
    }
    if (Date.now() - this.lastHideAt < 250) return
    this.siteControl = payload
    const win = this.ensureWindow()
    // Menu au clic : on prend le focus pour pouvoir se fermer au clic extérieur (blur) et gérer
    // Échap. Le focus est indépendant du click-through (géré par hit-test côté renderer).
    win.focus()
    this.send(IPC.OVERLAY_SITE_CONTROL_DATA, payload)
  }

  hideSiteControl(): void {
    if (this.siteControl === null) return
    this.siteControl = null
    this.lastHideAt = Date.now()
    this.send(IPC.OVERLAY_SITE_CONTROL_DATA, null)
  }

  /**
   * Menu contextuel d'un onglet (clic droit). Comme les Contrôles du site, il prend le focus pour
   * se fermer au clic extérieur (blur) / Échap. Rendu dans l'overlay → flotte au-dessus de la page.
   */
  openTabMenu(payload: TabMenuPayload): void {
    this.tabMenu = payload
    const win = this.ensureWindow()
    win.focus()
    this.send(IPC.OVERLAY_TAB_MENU_DATA, payload)
  }

  hideTabMenu(): void {
    if (this.tabMenu === null) return
    this.tabMenu = null
    this.lastHideAt = Date.now()
    this.send(IPC.OVERLAY_TAB_MENU_DATA, null)
  }

  /**
   * Palette de commande (façon Arc). Comme les Contrôles du site, c'est un menu au clic qui
   * prend le focus pour taper dans le champ de recherche et se fermer au clic extérieur (blur)
   * ou sur Échap. Toggle : rouvrir alors qu'elle est ouverte la referme (Ctrl+T / clic URL).
   */
  toggleCommand(payload: CommandPalettePayload): void {
    if (this.command !== null) {
      this.hideCommand()
      return
    }
    if (Date.now() - this.lastHideAt < 250) return
    this.command = payload
    const win = this.ensureWindow()
    win.focus()
    this.send(IPC.OVERLAY_COMMAND_DATA, payload)
  }

  hideCommand(): void {
    if (this.command === null) return
    this.command = null
    this.lastHideAt = Date.now()
    this.send(IPC.OVERLAY_COMMAND_DATA, null)
  }

  openPeek(width: number): void {
    this.peekOpen = true
    this.peekWidth = width
    this.send(IPC.SIDEBAR_PEEK_STATE, { open: true, width })
  }

  closePeek(): void {
    this.peekOpen = false
    // On garde `peekWidth` : indispensable au slide-out hors écran (cf. commentaire du champ).
    this.send(IPC.SIDEBAR_PEEK_STATE, { open: false, width: this.peekWidth })
  }

  /**
   * Met à jour la largeur mémorisée du peek (drag de la poignée de resize). Si le peek est ouvert,
   * le panneau suit en direct ; sinon on ne fait que mémoriser (la prochaine ouverture l'utilisera).
   */
  setPeekWidth(width: number): void {
    this.peekWidth = width
    if (this.peekOpen) this.send(IPC.SIDEBAR_PEEK_STATE, { open: true, width })
  }

  /** Pousse le layout courant de la sidebar à l'overlay (positionne la poignée de resize déployée). */
  pushLayout(width: number, collapsed: boolean): void {
    this.send(IPC.SIDEBAR_LAYOUT, { width, collapsed })
  }

  /**
   * Repli/dépli fluide de la sidebar. La vue web native ne peut pas s'animer sans saccade ; on la
   * cale donc INSTANTANÉMENT à son état final (via `snap`) et on joue l'animation dans l'overlay :
   * un masque (copie de la sidebar) anime sa largeur en CSS/GPU par-dessus la vue native.
   *
   * - Repli (`expand=false`) : masque affiché pleine largeur (identique à la vraie sidebar → échange
   *   invisible), puis après une frame on cale la vue à gauche et on rétrécit le masque → 0.
   * - Dépli (`expand=true`) : on cale la vue à droite tout de suite (la zone sidebar devient vide),
   *   masque monté à 0, puis après une frame on le fait grandir → pleine largeur.
   *
   * Dans les deux cas la vraie sidebar DOM est instantanée (masquée), le masque porte l'animation.
   */
  playSidebarToggle(width: number, expand: boolean, snap: () => void): void {
    this.cancelSidebarToggle()
    if (expand) {
      snap() // vue calée à droite immédiatement : la zone [0,width] devient vide, le masque y grandit
      this.send(IPC.SIDEBAR_TOGGLE_MASK, { visible: true, width, expanded: false })
      this.toggleMaskTimers.push(
        setTimeout(() => {
          this.send(IPC.SIDEBAR_TOGGLE_MASK, { visible: true, width, expanded: true })
        }, MASK_PAINT_MS)
      )
    } else {
      this.send(IPC.SIDEBAR_TOGGLE_MASK, { visible: true, width, expanded: true })
      this.toggleMaskTimers.push(
        setTimeout(() => {
          snap() // vue calée à gauche sous le masque plein
          this.send(IPC.SIDEBAR_TOGGLE_MASK, { visible: true, width, expanded: false })
        }, MASK_PAINT_MS)
      )
    }
    this.toggleMaskTimers.push(
      setTimeout(
        () => {
          this.send(IPC.SIDEBAR_TOGGLE_MASK, { visible: false, width, expanded: expand })
        },
        MASK_PAINT_MS + SIDEBAR_TOGGLE_MS + 40
      )
    )
  }

  /**
   * Annule une animation de toggle en cours et retire le masque (appelé quand la sidebar est
   * re-basculée / redimensionnée entre-temps, pour éviter qu'un `snap` différé ne s'applique après
   * coup).
   */
  cancelSidebarToggle(): void {
    if (this.toggleMaskTimers.length === 0) return
    for (const t of this.toggleMaskTimers) clearTimeout(t)
    this.toggleMaskTimers = []
    this.send(IPC.SIDEBAR_TOGGLE_MASK, { visible: false, width: this.peekWidth, expanded: true })
  }

  /** Donne le focus OS à la fenêtre-overlay (ex. édition inline dans le peek). */
  focusWindow(): void {
    const win = this.ensureWindow()
    win.focus()
  }

  /** Bascule le click-through demandé par le renderer (hit-test des panneaux). */
  setIgnore(ignore: boolean): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
  }

  /** Relaie un event (ex. `tab:updated`) à la couche pour la garder synchronisée. */
  forward(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  /** Id des webContents de l'overlay (pour ne pas lui réémettre ce qu'il vient d'envoyer). */
  get webContentsId(): number | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.id : null
  }

  private send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed() && this.ready) {
      this.win.webContents.send(channel, payload)
    }
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
      focusable: true,
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

    win.webContents.on('did-finish-load', () => {
      this.ready = true
      this.applyBounds()
      this.setIgnore(true) // repos : click-through
      win.showInactive() // affichée en permanence, sans voler le focus
      // Resynchronise l'état courant après (re)chargement.
      this.send(IPC.OVERLAY_SITE_CONTROL_DATA, this.siteControl)
      this.send(IPC.OVERLAY_TAB_MENU_DATA, this.tabMenu)
      this.send(IPC.OVERLAY_COMMAND_DATA, this.command)
      this.send(IPC.SIDEBAR_PEEK_STATE, { open: this.peekOpen, width: this.peekWidth })
    })

    const query = 'overlay=layer'
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
    }

    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.ready = false
      }
    })
    return win
  }

  private applyBounds(): void {
    if (!this.win || this.win.isDestroyed()) return
    const cb = this.parent.getContentBounds()
    this.win.setBounds({ x: cb.x, y: cb.y, width: cb.width, height: cb.height })
  }

  dispose(): void {
    this.parent.removeListener('resize', this.track)
    this.parent.removeListener('move', this.track)
    this.parent.removeListener('maximize', this.track)
    this.parent.removeListener('unmaximize', this.track)
    this.parent.removeListener('restore', this.track)
    if (this.win && !this.win.isDestroyed()) this.win.close()
    this.win = null
  }
}
