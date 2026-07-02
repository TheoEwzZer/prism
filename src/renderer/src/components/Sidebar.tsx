import { useTabsStore } from '@/store/tabsStore'
import { cn } from '@/lib/utils'
import { SidebarTabs } from './SidebarTabs'

/**
 * Barre latérale gauche (style Arc). La navigation (paramètres, toggle, back/forward/reload,
 * URL) vit dans la <TopBar> pleine largeur. La sidebar ne contient que les favoris et la
 * liste d'onglets.
 *
 * Ouverture/repli animés : l'aside anime sa largeur (0 ↔ width) ; le contenu est à largeur
 * FIXE et simplement clippé (`overflow-hidden`) → aucun reflow pendant l'animation. Le repli
 * réel de la vue web native est décalé à la fin de l'animation côté `useSidebarLayout` pour
 * qu'elle n'occulte pas la sidebar en train de se refermer.
 */
export function Sidebar(): React.JSX.Element {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)

  return (
    <aside
      style={{ width: collapsed ? 0 : width }}
      className={cn(
        'h-full shrink-0 overflow-hidden bg-sidebar',
        'transition-[width] duration-200 ease-out'
      )}
    >
      <div style={{ width }} className="flex h-full min-w-0 flex-col pt-1 text-sidebar-foreground">
        <SidebarTabs />
      </div>
    </aside>
  )
}
