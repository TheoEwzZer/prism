import { memo } from 'react'
import { X, Globe, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import type { SplitState } from '@shared/types'

/**
 * Pilule d'une vue divisée dans la sidebar (façon Arc) : les deux onglets membres regroupés dans un
 * seul élément, séparés par un fin trait. Cliquer une moitié réactive la division en focalisant ce
 * panneau. Fermer une moitié dissout la division ; l'onglet restant repasse en plein écran.
 *
 * MVP : non-draggable (les onglets membres sont exclus des listes triables de la sidebar).
 */
export const SplitItem = memo(function SplitItem({
  split
}: {
  split: SplitState
}): React.JSX.Element {
  const [a, b] = split.tabIds
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const isActive = activeTabId ? split.tabIds.includes(activeTabId) : false

  return (
    <div
      className={cn(
        'group/split flex h-9 items-stretch overflow-hidden rounded-lg',
        'bg-white/5 ring-1 ring-white/10'
      )}
    >
      <SplitHalf paneId={a} split={split} />
      <div className={cn('my-1 w-px shrink-0', isActive ? 'bg-white/5' : 'bg-white/10')} />
      <SplitHalf paneId={b} split={split} />
    </div>
  )
})

function SplitHalf({
  paneId,
  split
}: {
  paneId: string
  split: SplitState
}): React.JSX.Element | null {
  const title = useTabsStore((s) => s.tabs[paneId]?.title)
  const customTitle = useTabsStore((s) => s.tabs[paneId]?.customTitle)
  const favicon = useTabsStore((s) => s.tabs[paneId]?.favicon)
  const isLoading = useTabsStore((s) => s.tabs[paneId]?.isLoading)
  const isActive = useTabsStore((s) =>
    s.activeTabId ? split.tabIds.includes(s.activeTabId) : false
  )

  if (title === undefined) return null
  const displayName = customTitle || title || 'Nouvel onglet'

  const focusPane = (): void => {
    useTabsStore.getState().setActive(paneId)
    window.prism.activateSplit({
      orientation: split.orientation,
      tabIds: split.tabIds,
      focusedId: paneId
    })
  }

  const closePane = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const remaining = split.tabIds.find((id) => id !== paneId)
    window.prism.closeTab(paneId)
    // Dissout la division côté store (active l'onglet restant) puis l'affiche en plein écran.
    useTabsStore.getState().removeTab(paneId)
    if (remaining) window.prism.activateTab(remaining)
  }

  return (
    <button
      onClick={focusPane}
      className={cn(
        'group/half relative flex min-w-0 flex-1 items-center gap-1.5 px-2 text-xs transition-colors',
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
      <span className="min-w-0 flex-1 truncate text-left group-hover/half:pr-5">{displayName}</span>
      <span
        aria-label="Fermer ce panneau"
        onClick={closePane}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded',
          'text-slate-300 opacity-0 transition-opacity group-hover/half:opacity-100 hover:bg-white/15'
        )}
      >
        <X className="size-3" />
      </span>
    </button>
  )
}
