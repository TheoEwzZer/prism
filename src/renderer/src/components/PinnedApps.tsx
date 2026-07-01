import { useTabsStore } from '@/store/tabsStore'
import { Globe } from 'lucide-react'

/** Rangée horizontale d'applications épinglées (favoris) — carrés arrondis. */
export function PinnedApps(): React.JSX.Element | null {
  const pinnedApps = useTabsStore((s) => s.pinnedApps)
  if (pinnedApps.length === 0) return null

  return (
    <div className="flex flex-row gap-1.5 px-3 pb-2">
      {pinnedApps.map((app) => (
        <button
          key={app.id}
          title={app.name}
          onClick={() => window.prism.createTab({ url: app.url })}
          className="flex aspect-square flex-1 items-center justify-center rounded-lg bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {app.favicon ? (
            <img src={app.favicon} alt="" className="size-4" />
          ) : (
            <Globe className="size-4" />
          )}
        </button>
      ))}
    </div>
  )
}
