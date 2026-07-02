import { useRef } from 'react'
import { clampSidebarWidth } from '@shared/types'
import { cn } from '@/lib/utils'

/**
 * Poignée de redimensionnement de la sidebar, rendue DANS la couche d'overlay unique (la seule
 * surface qui flotte AU-DESSUS de la `WebContentsView` native — un handle en DOM dans la fenêtre
 * principale perdrait la souris dès qu'elle passe sur la vue web). Elle se cale sur le bord droit
 * de la surface active : la sidebar déployée (mode toggle) ou le panneau de peek.
 *
 * `data-overlay-hit="resize"` : marque la zone pour le hit-test de la couche (capture souris au
 * survol). Pendant le drag, `onStart`/`onEnd` verrouillent cette capture même hors de la bande.
 *
 * Le geste est capté via `setPointerCapture` : les `pointermove` continuent d'arriver même quand le
 * curseur survole la zone recouverte par la vue native. La largeur brute (clientX) est bornée puis
 * throttlée à une frame ; c'est le Main qui reste la source de vérité (bornage + bounds + peek).
 */
export function SidebarResizeHandle({
  left,
  active,
  onStart,
  onMove,
  onEnd
}: {
  /** Position (px) du bord droit de la surface à redimensionner. */
  left: number
  /** Drag en cours (force l'indicateur visuel visible). */
  active: boolean
  onStart: () => void
  onMove: (width: number) => void
  onEnd: () => void
}): React.JSX.Element {
  const dragging = useRef(false)
  const rafId = useRef<number | null>(null)
  const lastX = useRef(0)

  const flush = (): void => {
    rafId.current = null
    onMove(clampSidebarWidth(lastX.current))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging.current = true
    onStart()
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging.current) return
    lastX.current = e.clientX
    if (rafId.current !== null) return
    rafId.current = requestAnimationFrame(flush)
  }

  const end = (): void => {
    if (!dragging.current) return
    dragging.current = false
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    onEnd()
  }

  return (
    <div
      data-overlay-hit="resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ left: left - 3, width: 6 }}
      className="group pointer-events-auto absolute top-8 bottom-0 z-[60] flex cursor-col-resize justify-center"
    >
      <span
        className={cn(
          'h-full w-px transition-colors duration-150',
          active ? 'bg-primary/70' : 'bg-transparent group-hover:bg-primary/50'
        )}
      />
    </div>
  )
}
