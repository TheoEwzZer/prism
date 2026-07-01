import { useEffect, useRef, useState } from 'react'
import { useTabsStore } from '@/store/tabsStore'

/**
 * Hydrate le store depuis la session persistée (chargée par le Main) au démarrage, puis
 * réveille l'onglet précédemment actif (les autres restent hibernés → lazy).
 */
export function useSession(): boolean {
  const [ready, setReady] = useState(false)
  const hydrate = useTabsStore((s) => s.hydrate)
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    window.prism.getSession().then((session) => {
      hydrate(session)
      if (session.activeTabId && session.tabs.some((t) => t.id === session.activeTabId)) {
        window.prism.activateTab(session.activeTabId)
      }
      setReady(true)
    })
  }, [hydrate])

  return ready
}

/**
 * Persiste l'état UI organisationnel (ordre, dossiers, favoris, onglet actif, sidebar)
 * vers le Main dès qu'il change. Débattu léger via microtask pour grouper les changements
 * synchrones. Le Main écrit ensuite sur disque de façon debouncée.
 */
export function usePersistUiState(ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    let scheduled = false
    const flush = (): void => {
      scheduled = false
      window.prism.saveUiState(useTabsStore.getState().toPersist())
    }
    const unsub = useTabsStore.subscribe(() => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(flush)
    })
    return unsub
  }, [ready])
}
