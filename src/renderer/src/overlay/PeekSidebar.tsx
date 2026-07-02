import { SidebarTabs } from '@/components/SidebarTabs'
import { cn } from '@/lib/utils'

/**
 * Panneau de "peek" de la sidebar, rendu DANS la couche d'overlay unique. Il flotte au-dessus
 * de la page (façon Arc) et glisse depuis le bord gauche — la vue web n'est jamais poussée.
 *
 * `data-overlay-hit="peek"` : marque la zone interactive pour le hit-test de la couche (qui
 * capte la souris au survol et rend la main en dehors).
 */
export function PeekSidebar({ open, width }: { open: boolean; width: number }): React.JSX.Element {
  return (
    <aside
      data-overlay-hit="peek"
      style={{ width }}
      className={cn(
        'pointer-events-auto absolute top-8 bottom-0 left-0 flex flex-col',
        'border-r border-white/10 bg-sidebar pt-1 text-sidebar-foreground',
        'shadow-2xl shadow-black/40 transition-transform duration-200 ease-out will-change-transform',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <SidebarTabs />
    </aside>
  )
}
