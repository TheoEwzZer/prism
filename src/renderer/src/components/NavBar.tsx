import { Menu, PanelLeft, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'

/** Rangée d'icônes de navigation en haut de la sidebar (style Arc). */
export function NavBar(): React.JSX.Element {
  const activeId = useTabsStore((s) => s.activeTabId)
  const canGoBack = useTabsStore((s) => (activeId ? s.tabs[activeId]?.canGoBack : false))
  const canGoForward = useTabsStore((s) => (activeId ? s.tabs[activeId]?.canGoForward : false))
  const toggleCollapsed = useTabsStore((s) => s.setSidebarCollapsed)
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)

  return (
    <div className="app-no-drag flex items-center gap-0.5 px-2 pb-1">
      <IconButton label="Menu">
        <Menu className="size-4" />
      </IconButton>
      <IconButton label="Replier la barre latérale" onClick={() => toggleCollapsed(!collapsed)}>
        <PanelLeft className="size-4" />
      </IconButton>
      <div className="flex-1" />
      <IconButton
        label="Précédent"
        disabled={!canGoBack}
        onClick={() => activeId && window.prism.goBack(activeId)}
      >
        <ArrowLeft className="size-4" />
      </IconButton>
      <IconButton
        label="Suivant"
        disabled={!canGoForward}
        onClick={() => activeId && window.prism.goForward(activeId)}
      >
        <ArrowRight className="size-4" />
      </IconButton>
      <IconButton
        label="Rafraîchir"
        disabled={!activeId}
        onClick={() => activeId && window.prism.reload(activeId)}
      >
        <RotateCw className="size-4" />
      </IconButton>
    </div>
  )
}

function IconButton({
  children,
  label,
  onClick,
  disabled
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors',
        'hover:bg-white/10 hover:text-white',
        'disabled:pointer-events-none disabled:opacity-30'
      )}
    >
      {children}
    </button>
  )
}
