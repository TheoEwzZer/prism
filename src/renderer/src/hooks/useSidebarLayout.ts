import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/store/tabsStore'

/** Doit rester synchronisé avec la `duration-200` de l'animation de <Sidebar>. */
const SIDEBAR_ANIM_MS = 200

/**
 * Émet l'INTENTION de layout de sidebar vers le Main (jamais de pixels de bounds bruts).
 * Le Main reste seul responsable du calcul et de l'application des bounds réels.
 *
 * Coordination avec l'animation : la vue web native est peinte AU-DESSUS du DOM. À l'ouverture
 * on repousse la vue immédiatement (la sidebar glisse dans l'espace libéré, sans occlusion) ;
 * au repli on retarde le `collapsed` réel jusqu'à la fin de l'animation, sinon la vue web
 * s'étendrait par-dessus la sidebar encore visible en train de se refermer.
 *
 * Purement impératif (émission IPC, aucun état React) → aucun rendu, et `lastSent` évite toute
 * émission redondante.
 */
export function useSidebarLayout(): void {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)

  const lastSent = useRef<{ width: number; collapsed: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const emit = (c: boolean): void => {
      const prev = lastSent.current
      if (prev && prev.width === width && prev.collapsed === c) return
      lastSent.current = { width, collapsed: c }
      window.prism.setSidebar({ width, collapsed: c })
    }

    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }

    if (!collapsed) {
      emit(false) // ouverture : la vue web se rétracte tout de suite
    } else {
      // repli : on garde la vue étendue pendant l'animation, puis on replie réellement.
      timer.current = setTimeout(() => emit(true), SIDEBAR_ANIM_MS)
    }

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [collapsed, width])
}
