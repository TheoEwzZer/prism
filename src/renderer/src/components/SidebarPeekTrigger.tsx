import { useTabsStore } from '@/store/tabsStore'

/**
 * Zone chaude au bord gauche : quand la sidebar est repliée, y amener la souris ouvre le
 * "peek" (fenêtre-overlay native qui flotte au-dessus de la page). La fermeture est gérée par
 * l'overlay lui-même (souris sortie du panneau).
 *
 * Le ruban vit dans le mince liseré (VIEW_INSET) laissé libre à gauche de la vue web native —
 * seule bande du chrome DOM non recouverte par la `WebContentsView` quand la barre est repliée.
 */
export function SidebarPeekTrigger(): React.JSX.Element | null {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  if (!collapsed) return null

  return (
    <div
      aria-hidden
      onMouseEnter={() => window.prism.openSidebarPeek()}
      className="absolute bottom-0 left-0 top-11 z-50 w-2"
    />
  )
}
