import { useEffect, useRef, useState } from 'react'
import { useTabsStore } from '@/store/tabsStore'
import { useTabEvents } from '@/hooks/useTabEvents'
import { usePersistUiState } from '@/hooks/useSession'
import type { SiteControlPayload, SidebarPeekState, CommandPalettePayload } from '@shared/types'
import { PeekSidebar } from './PeekSidebar'
import { SiteControlPopover } from './SiteControlPopover'
import { CommandPalette } from './CommandPalette'

const PEEK_ARM_MS = 150

/**
 * Racine de la couche d'overlay unique (approche B) : une fenêtre transparente persistante,
 * calée sur toute la zone contenu de la fenêtre principale, qui héberge TOUTE l'UI flottant
 * au-dessus de la page (peek de la sidebar, Contrôles du site, futurs menus). Rendu instantané
 * (aucune création de fenêtre par ouverture), animations CSS.
 *
 * Click-through : la fenêtre laisse passer la souris par défaut (`ignore=true` côté Main) ; on
 * fait un hit-test sur `mousemove` (les moves sont forwardés même en mode ignore) et on demande
 * la capture (`ignore=false`) uniquement au survol d'un panneau (`[data-overlay-hit]`).
 */
export function OverlayLayer(): React.JSX.Element {
  const hydrate = useTabsStore((s) => s.hydrate)
  const [ready, setReady] = useState(false)
  const [peek, setPeek] = useState<SidebarPeekState>({ open: false, width: 256 })
  const [site, setSite] = useState<SiteControlPayload | null>(null)
  const [command, setCommand] = useState<CommandPalettePayload | null>(null)

  useTabEvents() // patchs + convergence de l'état organisationnel relayés par le Main
  usePersistUiState(ready) // le peek est pleinement fonctionnel : ses changements remontent au Main

  // Hydratation initiale (snapshot de session), sans réveiller d'onglet (overlay passif).
  useEffect(() => {
    window.prism.getSession().then((session) => {
      hydrate(session)
      setReady(true)
    })
  }, [hydrate])

  useEffect(() => window.prism.onSidebarPeekState(setPeek), [])
  useEffect(() => window.prism.onSiteControlData(setSite), [])
  useEffect(() => window.prism.onCommandData(setCommand), [])

  // --- Click-through : hit-test global ---
  const ignoreRef = useRef(true)
  const lastPos = useRef({ x: -1, y: -1 })
  const rafRef = useRef<number | null>(null)
  // Miroirs "live" de l'état pour le listener global (évite les closures périmées).
  const peekOpenRef = useRef(false)
  const anyOpenRef = useRef(false)
  const armedRef = useRef(false)

  const setIgnore = (ignore: boolean): void => {
    if (ignoreRef.current === ignore) return
    ignoreRef.current = ignore
    window.prism.setOverlayIgnoreMouse(ignore)
  }

  const hitTest = (x: number, y: number): void => {
    // Drag & drop en cours dans le peek : on garde la capture souris et on ne ferme pas le peek,
    // même si le curseur survole le DragOverlay (hors `[data-overlay-hit]`).
    if (document.body.hasAttribute('data-dnd-dragging')) {
      setIgnore(false)
      return
    }
    if (!anyOpenRef.current) {
      setIgnore(true)
      return
    }
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const panel = el?.closest('[data-overlay-hit]') as HTMLElement | null
    const kind = panel?.dataset.overlayHit ?? null
    setIgnore(kind === null)
    // Fermeture auto du peek dès que la souris n'est plus dessus (armée après l'ouverture).
    if (peekOpenRef.current && armedRef.current && kind !== 'peek') {
      window.prism.closeSidebarPeek()
    }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      lastPos.current = { x: e.clientX, y: e.clientY }
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        hitTest(lastPos.current.x, lastPos.current.y)
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // hitTest lit tout via refs → listener stable, aucune dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Réagit aux changements d'ouverture : (dé)verrouille la capture et arme la fermeture du peek.
  const anyOpen = peek.open || site !== null || command !== null
  useEffect(() => {
    anyOpenRef.current = anyOpen
    peekOpenRef.current = peek.open
    if (!anyOpen) {
      setIgnore(true)
      armedRef.current = false
      return
    }
    // Le peek s'ouvre sous le curseur : petite garde avant d'autoriser sa fermeture au survol.
    if (peek.open) {
      armedRef.current = false
      const t = setTimeout(() => (armedRef.current = true), PEEK_ARM_MS)
      // Hit-test immédiat (le curseur peut déjà être sur un panneau).
      hitTest(lastPos.current.x, lastPos.current.y)
      return () => clearTimeout(t)
    }
    hitTest(lastPos.current.x, lastPos.current.y)
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyOpen, peek.open])

  // Contrôles du site : menu au clic → fermeture sur clic extérieur (blur) ou Échap.
  useEffect(() => {
    if (!site) return
    const onBlur = (): void => window.prism.closeSiteControl()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.prism.closeSiteControl()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }, [site])

  // Palette de commande : même logique (clic extérieur / Échap). Échap est géré ici plutôt que
  // par cmdk pour fermer la fenêtre-overlay (et pas seulement vider le champ).
  useEffect(() => {
    if (!command) return
    const onBlur = (): void => window.prism.closeCommandPalette()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.prism.closeCommandPalette()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }, [command])

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <PeekSidebar open={peek.open} width={peek.width} />
      {site && <SiteControlPopover data={site} />}
      {command && <CommandPalette data={command} />}
    </div>
  )
}
