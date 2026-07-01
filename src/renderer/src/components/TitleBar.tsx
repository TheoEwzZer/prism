import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * En-tête draggable de la fenêtre frameless + contrôles Windows custom (min/max/close).
 * Placé en haut de la sidebar (zone contrôlée par React ; la partie droite est occupée par
 * la WebContentsView native qui se peint par-dessus le DOM).
 */
export function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.prism.onWindowState((s) => setMaximized(s.isMaximized)), [])

  return (
    <div className="app-drag flex h-9 items-center justify-end gap-0.5 pr-1 pl-2">
      <WindowButton label="Réduire" onClick={() => window.prism.minimizeWindow()}>
        <Minus className="size-3.5" />
      </WindowButton>
      <WindowButton label="Agrandir" onClick={() => window.prism.toggleMaximizeWindow()}>
        {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
      </WindowButton>
      <WindowButton label="Fermer" danger onClick={() => window.prism.closeWindow()}>
        <X className="size-3.5" />
      </WindowButton>
    </div>
  )
}

function WindowButton({
  children,
  onClick,
  label,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        'app-no-drag flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors',
        danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-white/10 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}
