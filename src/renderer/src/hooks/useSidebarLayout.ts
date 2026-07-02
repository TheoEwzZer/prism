import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Émet l'INTENTION de layout de sidebar vers le Main (jamais de pixels de bounds bruts).
 * Le Main reste seul responsable du calcul et de l'application des bounds réels.
 *
 * Coordination avec l'animation : la vue web native est peinte AU-DESSUS du DOM. L'intention
 * (repli/dépli) est émise IMMÉDIATEMENT dans les deux sens ; c'est le Main qui anime les bounds
 * de la vue en parallèle de la transition CSS de <Sidebar> (même durée + easing), gardant l'inset
 * "carte" constant → aucun saut, aucune occlusion de la sidebar en cours d'animation.
 *
 * Purement impératif (émission IPC, aucun état React) → aucun rendu, et `lastSent` évite toute
 * émission redondante.
 */
export function useSidebarLayout(): void {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)
  const setSidebarWidth = useTabsStore((s) => s.setSidebarWidth)

  const lastSent = useRef<{ width: number; collapsed: boolean } | null>(null)

  // Largeur poussée par le Main pendant un drag de la poignée (geste possédé par l'overlay). On
  // met à jour le store ET `lastSent` : la vraie sidebar DOM suit, mais l'effet ci-dessous NE
  // ré-émet PAS l'intention (le Main a déjà appliqué les bounds natifs) → aucun ping-pong.
  useEffect(() => {
    return window.prism.onSidebarWidth((w) => {
      lastSent.current = { width: w, collapsed: useTabsStore.getState().sidebarCollapsed }
      setSidebarWidth(w)
    })
  }, [setSidebarWidth])

  useEffect(() => {
    const prev = lastSent.current
    if (prev && prev.width === width && prev.collapsed === collapsed) return
    lastSent.current = { width, collapsed }
    window.prism.setSidebar({ width, collapsed })
  }, [collapsed, width])
}
