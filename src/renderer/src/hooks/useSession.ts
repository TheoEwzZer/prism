import { useEffect, useRef, useState } from 'react'
import { useTabsStore, isApplyingRemoteUi } from '@/store/tabsStore'

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
 * vers le Main dès qu'il change *réellement*. Le store se re-render aussi sur les patchs de
 * titre/favicon : on compare donc une signature JSON de `toPersist()` pour ne rien envoyer
 * quand seul du « browser state » a bougé. Débattu léger via microtask.
 *
 * Anti-écho : quand le changement provient de l'application d'un état reçu d'une autre fenêtre
 * (`isApplyingRemoteUi`), on met à jour la signature de référence SANS renvoyer au Main —
 * sinon les deux fenêtres se relanceraient mutuellement en boucle.
 */
export function usePersistUiState(ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    let scheduled = false
    let lastSig = JSON.stringify(useTabsStore.getState().toPersist())
    const flush = (): void => {
      scheduled = false
      window.prism.saveUiState(useTabsStore.getState().toPersist())
    }
    const unsub = useTabsStore.subscribe(() => {
      const sig = JSON.stringify(useTabsStore.getState().toPersist())
      if (sig === lastSig) return
      lastSig = sig
      if (isApplyingRemoteUi()) return // état venu d'une autre fenêtre : ne pas renvoyer
      if (scheduled) return
      scheduled = true
      queueMicrotask(flush)
    })
    return unsub
  }, [ready])
}
