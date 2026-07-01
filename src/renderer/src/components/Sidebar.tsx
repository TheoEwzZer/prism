import { useTabsStore } from '@/store/tabsStore'
import { PinnedApps } from './PinnedApps'
import { TabList } from './TabList'

/**
 * Barre latérale gauche (style Arc). La navigation (paramètres, toggle, back/forward/reload,
 * URL) vit dans la <TopBar> pleine largeur. La sidebar ne contient que les favoris et la
 * liste d'onglets. Repliée, elle disparaît complètement (la vue web occupe toute la largeur).
 */
export function Sidebar(): React.JSX.Element | null {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)

  if (collapsed) return null

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col bg-sidebar pt-2 text-sidebar-foreground"
    >
      <PinnedApps />
      <TabList />
    </aside>
  )
}
