import { useLayoutEffect, useRef, useState } from 'react'
import { PanelRight, PanelLeft, PanelTop, PanelBottom } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SplitMenuPayload, SplitPosition } from '@shared/types'

const MENU_WIDTH = 236

/**
 * Menu « Options de vue divisée » (bouton de la TopBar), rendu DANS la couche d'overlay unique → il
 * flotte AU-DESSUS de la `WebContentsView` native (un menu DOM de la fenêtre principale, qui s'ouvre
 * sous la barre supérieure, passerait derrière la vue). Positionné en coordonnées client (overlay
 * calé 1:1 sur la principale). `data-overlay-hit="splitmenu"` marque la zone pour le hit-test.
 *
 * Choisir une position crée un panneau vierge du côté voulu, active la division, puis ouvre la
 * palette de commande sur ce nouveau panneau : le site choisi s'affiche alors de ce côté.
 */
export function SplitMenu({ data }: Readonly<{ data: SplitMenuPayload }>): React.JSX.Element {
  const { x, y, activeId } = data

  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - width - 8)
    const top = Math.min(y, window.innerHeight - height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  const close = (): void => window.prism.closeSplitMenu()

  // Toute l'orchestration (création du panneau vierge, formation + activation de la division,
  // convergence des deux fenêtres) est faite côté Main. Le site du nouveau panneau se saisit ensuite
  // dans sa propre barre d'outils (per-pane omnibox, auto-focus).
  const pick = (position: SplitPosition): void => {
    if (activeId) window.prism.createSplit({ position, sourceId: activeId })
    close()
  }

  return (
    <div
      ref={rootRef}
      data-overlay-hit="splitmenu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className={cn(
        'pointer-events-auto absolute overflow-hidden rounded-lg border border-white/10',
        'bg-popover p-1 text-slate-200 shadow-2xl shadow-black/60'
      )}
    >
      <Row
        icon={<PanelRight className="size-4" />}
        label="Ajouter une division à droite"
        onClick={() => pick('right')}
      />
      <Row
        icon={<PanelLeft className="size-4" />}
        label="Ajouter une division à gauche"
        onClick={() => pick('left')}
      />
      <Row
        icon={<PanelTop className="size-4" />}
        label="Ajouter une division en haut"
        onClick={() => pick('top')}
      />
      <Row
        icon={<PanelBottom className="size-4" />}
        label="Ajouter une division en bas"
        onClick={() => pick('bottom')}
      />
    </div>
  )
}

function Row({
  icon,
  label,
  onClick
}: Readonly<{
  icon: React.ReactNode
  label: string
  onClick: () => void
}>): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        'hover:bg-white/10'
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
