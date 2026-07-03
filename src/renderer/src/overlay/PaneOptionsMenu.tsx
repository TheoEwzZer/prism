import { useLayoutEffect, useRef, useState } from 'react'
import { MoveHorizontal, MoveVertical, Rows2, Columns2, SquareSplitHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import type { SplitPaneMenuPayload } from '@shared/types'

const MENU_WIDTH = 230

/**
 * Menu d'options d'UN panneau d'une vue divisée (bouton de sa barre d'outils), rendu DANS la couche
 * d'overlay → il flotte AU-DESSUS de la `WebContentsView` native. Actions : déplacer ce panneau
 * (échange les deux), le séparer de la vue (dissout la division sans fermer d'onglet), ou basculer
 * l'orientation. Libellés contextuels selon l'orientation et la position du panneau.
 */
export function PaneOptionsMenu({
  data
}: Readonly<{ data: SplitPaneMenuPayload }>): React.JSX.Element | null {
  const { x, y, splitId, paneId } = data
  const split = useTabsStore((s) => s.splits.find((sp) => sp.id === splitId))

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

  const close = (): void => window.prism.closePaneMenu()

  if (!split) return null

  const isFirst = split.tabIds[0] === paneId
  const horizontal = split.orientation === 'horizontal'

  // Déplacer = échanger les deux panneaux. Libellé = destination de CE panneau.
  const moveLabel = horizontal
    ? isFirst
      ? 'Déplacer à droite'
      : 'Déplacer à gauche'
    : isFirst
      ? 'Déplacer en bas'
      : 'Déplacer en haut'
  const moveIcon = horizontal ? (
    <MoveHorizontal className="size-4" />
  ) : (
    <MoveVertical className="size-4" />
  )

  // Convertir l'orientation.
  const convertLabel = horizontal ? 'Empiler verticalement' : 'Mettre côte à côte'
  const convertIcon = horizontal ? <Rows2 className="size-4" /> : <Columns2 className="size-4" />

  const move = (): void => {
    window.prism.moveSplit(splitId)
    close()
  }
  const detach = (): void => {
    // Sépare ce panneau de la vue : dissout la division, garde les deux onglets (celui-ci actif).
    window.prism.detachSplit({ splitId, keepId: paneId })
    close()
  }
  const convert = (): void => {
    window.prism.convertSplit(splitId)
    close()
  }

  return (
    <div
      ref={rootRef}
      data-overlay-hit="panemenu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className={cn(
        'pointer-events-auto absolute overflow-hidden rounded-lg border border-white/10',
        'bg-popover p-1 text-slate-200 shadow-2xl shadow-black/60'
      )}
    >
      <Row icon={moveIcon} label={moveLabel} onClick={move} />
      <Row
        icon={<SquareSplitHorizontal className="size-4" />}
        label="Séparer de la vue"
        onClick={detach}
      />
      <Row icon={convertIcon} label={convertLabel} onClick={convert} />
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
