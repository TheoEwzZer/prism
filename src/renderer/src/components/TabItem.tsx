import { memo } from 'react'
import { X, Globe, Loader2, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Un onglet vertical de la sidebar.
 *
 * Perf : abonnements par CHAMP atomique (title/favicon/isLoading/isActive). Un patch favicon
 * ne re-render que l'icône ; réordonner la liste (`order`) ne re-render aucun `TabItem`.
 * Mémoïsé pour ignorer les re-renders du parent qui ne changent pas la prop `id`.
 */
export const TabItem = memo(function TabItem({ id }: { id: string }): React.JSX.Element | null {
  const title = useTabsStore((s) => s.tabs[id]?.title)
  const favicon = useTabsStore((s) => s.tabs[id]?.favicon)
  const isLoading = useTabsStore((s) => s.tabs[id]?.isLoading)
  const isHibernated = useTabsStore((s) => s.tabs[id]?.isHibernated)
  const isActive = useTabsStore((s) => s.activeTabId === id)

  const setActive = useTabsStore((s) => s.setActive)
  const removeTab = useTabsStore((s) => s.removeTab)

  // Onglet retiré du store entre-temps.
  if (title === undefined) return null

  const activate = (): void => {
    setActive(id)
    window.prism.activateTab(id)
  }

  const close = (e: React.MouseEvent): void => {
    e.stopPropagation()
    window.prism.closeTab(id)
    removeTab(id)
  }

  return (
    <div
      onClick={activate}
      className={cn(
        'group flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-sm',
        'transition-colors',
        isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin text-slate-400" />
        ) : favicon ? (
          <img src={favicon} alt="" className="size-4 rounded-sm" />
        ) : (
          <Globe className="size-3.5 text-slate-500" />
        )}
      </span>

      <span className={cn('flex-1 truncate', isHibernated && 'opacity-60')}>
        {title || 'Nouvel onglet'}
      </span>

      {isHibernated && <Moon className="size-3 shrink-0 text-slate-500" />}

      <button
        aria-label="Fermer l'onglet"
        onClick={close}
        className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/15"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
})
