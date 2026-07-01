import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Émet l'INTENTION de layout de sidebar vers le Main (jamais de pixels de bounds bruts).
 * Le Main reste seul responsable du calcul et de l'application des bounds réels.
 *
 * Throttle via requestAnimationFrame + cache de la dernière valeur envoyée → aucune
 * émission redondante (utile si la largeur devient redimensionnable au drag).
 */
export function useSidebarLayout(): void {
  const collapsed = useTabsStore((s) => s.sidebarCollapsed)
  const width = useTabsStore((s) => s.sidebarWidth)

  const rafId = useRef<number | null>(null)
  const lastSent = useRef<{ width: number; collapsed: boolean } | null>(null)

  useEffect(() => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null
      const prev = lastSent.current
      if (prev && prev.width === width && prev.collapsed === collapsed) return
      lastSent.current = { width, collapsed }
      window.prism.setSidebar({ width, collapsed })
    })
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current)
    }
  }, [collapsed, width])
}
