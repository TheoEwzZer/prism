import { useLayoutEffect, useRef, useState } from 'react'
import { Copy, Pencil, Columns2, CopyPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TabMenuPayload } from '@shared/types'

const MENU_WIDTH = 190

/**
 * Menu contextuel d'un onglet (clic droit), rendu DANS la couche d'overlay unique → il flotte
 * AU-DESSUS de la `WebContentsView` native (impossible depuis la fenêtre principale, dont le DOM
 * passe derrière la vue). Positionné en coordonnées client (overlay calé 1:1 sur la principale).
 *
 * `data-overlay-hit="tabmenu"` marque la zone interactive pour le hit-test de la couche. La
 * fermeture (clic extérieur / Échap) est gérée par la couche.
 */
export function TabContextMenu({ data }: Readonly<{ data: TabMenuPayload }>): React.JSX.Element {
  const { tabId, url, x, y } = data

  const rootRef = useRef<HTMLDivElement>(null)
  // Position clampée dans le viewport (le clic peut être près d'un bord).
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - width - 8)
    const top = Math.min(y, window.innerHeight - height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  const close = (): void => window.prism.closeTabMenu()

  const copyUrl = (): void => {
    if (url) window.prism.copyText(url)
    close()
  }
  const rename = (): void => {
    // Démarre l'édition inline dans la sidebar (façon Arc) ; le Main la diffuse à la bonne fenêtre.
    window.prism.setTabRenaming(tabId)
    close()
  }
  const addSplit = (): void => {
    // Équivalent de « Ajouter une division à droite » : cet onglet reste à gauche, nouveau panneau à
    // droite, puis la palette de commande s'ouvre pour choisir le site (orchestré côté Main).
    window.prism.createSplit({ position: 'right', sourceId: tabId })
    close()
  }

  const duplicateTab = (): void => {
    if (url) window.prism.createTab({ url })
    else window.prism.createTab({})
    close()
  }

  return (
    <div
      ref={rootRef}
      data-overlay-hit="tabmenu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      className={cn(
        'pointer-events-auto absolute overflow-hidden rounded-lg border border-white/10',
        'bg-popover p-1 text-slate-200 shadow-2xl shadow-black/60'
      )}
    >
      <Row
        icon={<Copy className="size-4" />}
        label="Copier l'URL"
        disabled={!url}
        onClick={copyUrl}
      />
      <Row icon={<Pencil className="size-4" />} label="Renommer" onClick={rename} />
      <Row icon={<CopyPlus className="size-4" />} label="Dupliquer" onClick={duplicateTab} />
      <Row
        icon={<Columns2 className="size-4" />}
        label="Ajouter une vue divisée"
        onClick={addSplit}
      />
    </div>
  )
}

function Row({
  icon,
  label,
  onClick,
  disabled
}: Readonly<{
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}>): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        'hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40'
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
