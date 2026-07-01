import { useEffect, useRef, useState } from 'react'
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
 * Throttle via requestAnimationFrame + cache de la dernière valeur envoyée → aucune émission
 * redondante.
 */
export function useSidebarLayout(): void {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)

  // `collapsed` effectif transmis au Main, décalé à la fermeture.
  const [layoutCollapsed, setLayoutCollapsed] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) {
      setLayoutCollapsed(false) // ouverture : la vue web se rétracte tout de suite
      return
    }
    const t = setTimeout(() => setLayoutCollapsed(true), SIDEBAR_ANIM_MS)
    return () => clearTimeout(t)
  }, [collapsed])

  const rafId = useRef<number | null>(null)
  const lastSent = useRef<{ width: number; collapsed: boolean } | null>(null)

  useEffect(() => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null
      const prev = lastSent.current
      if (prev && prev.width === width && prev.collapsed === layoutCollapsed) return
      lastSent.current = { width, collapsed: layoutCollapsed }
      window.prism.setSidebar({ width, collapsed: layoutCollapsed })
    })
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    }
  }, [layoutCollapsed, width])
}
