import { useEffect, useState } from 'react'
import { useTabsStore } from '@/store/tabsStore'
import { SidebarTabs } from './SidebarTabs'
import { ErrorBoundary } from './ErrorBoundary'


/**
 * Barre latérale gauche (style Arc). La navigation (paramètres, toggle, back/forward/reload,
 * URL) vit dans la <TopBar> pleine largeur. La sidebar ne contient que les favoris et la
 * liste d'onglets.
 *
 * Animation du toggle : elle NE vit PAS ici. Le repli/dépli fluide est joué par un masque CSS
 * dans la couche d'overlay (au-dessus de la vue web native), piloté par le Main. Cette vraie
 * sidebar est donc INSTANTANÉE : elle bascule sèchement 0 ↔ width, mais on RETARDE ce basculement
 * (`visualCollapsed`) jusqu'à la fin de l'animation du masque, qui la recouvre entièrement pendant
 * ce temps → le basculement instantané est invisible. (Un simple resize de la poignée, `collapsed`
 * inchangé, suit la largeur en direct.)
 */
const TOGGLE_MASK_MS = 250

export function Sidebar(): React.JSX.Element {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)

  // `visualCollapsed` retarde `collapsed` : la vraie sidebar ne bascule qu'à la fin de l'animation
  // du masque overlay (qui la recouvre), pour un basculement instantané mais invisible.
  const [visualCollapsed, setVisualCollapsed] = useState(collapsed)
  useEffect(() => {
    const t = setTimeout(() => setVisualCollapsed(collapsed), TOGGLE_MASK_MS)
    return () => clearTimeout(t)
  }, [collapsed])

  return (
    <aside
      style={{ width: visualCollapsed ? 0 : width }}
      className="h-full shrink-0 overflow-hidden bg-sidebar"
    >
      <div style={{ width }} className="flex h-full min-w-0 flex-col pt-1 text-sidebar-foreground">
        <ErrorBoundary>
          <SidebarTabs />
        </ErrorBoundary>
      </div>
    </aside>
  )
}
