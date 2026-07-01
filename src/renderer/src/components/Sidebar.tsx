import { PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/store/tabsStore'
import { TitleBar } from './TitleBar'
import { NavBar } from './NavBar'
import { PinnedApps } from './PinnedApps'
import { Omnibox } from './Omnibox'
import { TabList } from './TabList'

/** Barre latérale gauche (style Arc). Largeur fixe, ou rail étroit quand repliée. */
export function Sidebar(): React.JSX.Element {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)
  const setCollapsed = useTabsStore((s) => s.setSidebarCollapsed)

  if (collapsed) {
    // Rail replié (48px) : bouton d'expansion + drag.
    return (
      <aside
        style={{ width: 48 }}
        className="app-drag flex h-full shrink-0 flex-col items-center gap-2 bg-sidebar pt-2"
      >
        <button
          aria-label="Déplier la barre latérale"
          onClick={() => setCollapsed(false)}
          className="app-no-drag flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <PanelLeft className="size-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      style={{ width }}
      className={cn('flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground')}
    >
      <TitleBar />
      <NavBar />
      <PinnedApps />
      <Omnibox />
      <TabList />
    </aside>
  )
}
