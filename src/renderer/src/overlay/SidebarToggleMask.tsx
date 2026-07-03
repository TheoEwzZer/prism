import { SidebarTabs } from '@/components/SidebarTabs'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { cn } from '@/lib/utils'
import type { SidebarToggleMaskState } from '@shared/types'

/**
 * Masque animé du repli/dépli de la sidebar, rendu DANS la couche d'overlay (au-dessus de la vue
 * web native). La vraie vue web + la vraie <Sidebar> DOM sont calées instantanément à leur état
 * final par le Main ; ce masque — copie fidèle de la sidebar — porte TOUTE l'animation en faisant
 * varier sa LARGEUR en CSS (GPU) : 0 → plein au dépli, plein → 0 au repli. C'est le seul moyen
 * d'obtenir un mouvement fluide (repositionner la vue native frame par frame saccade).
 *
 * Purement visuel : `pointer-events-none`. Structure (aside clippé + div interne à largeur fixe)
 * identique à <Sidebar> pour un rendu 1:1.
 */
export function SidebarToggleMask({
  state
}: {
  state: SidebarToggleMaskState
}): React.JSX.Element | null {
  if (!state.visible) return null
  return (
    <aside
      style={{ width: state.expanded ? state.width : 0 }}
      className={cn(
        'pointer-events-none absolute top-8 bottom-0 left-0 overflow-hidden bg-sidebar',
        'transition-[width] duration-200 ease-out'
      )}
    >
      <div
        style={{ width: state.width }}
        className="flex h-full min-w-0 flex-col pt-1 text-sidebar-foreground"
      >
        <ErrorBoundary>
          <SidebarTabs />
        </ErrorBoundary>
      </div>
    </aside>
  )
}
