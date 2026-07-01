import { useEffect, useRef, useState } from 'react'
import { useTabsStore } from '@/store/tabsStore'
import { useTabEvents } from '@/hooks/useTabEvents'
import { PinnedApps } from '@/components/PinnedApps'
import { TabList } from '@/components/TabList'
import { cn } from '@/lib/utils'

/**
 * Panneau de "peek" de la sidebar, rendu dans une fenêtre-overlay native transparente qui
 * flotte AU-DESSUS de la page (façon Arc) — la sidebar apparaît sans pousser la vue web.
 *
 * Réutilise le store + les composants de la sidebar : hydraté une fois depuis la session, il
 * reste en direct via le flux batché `tab:updated` relayé par le Main. Il n'émet aucune
 * intention de layout (le Main reste seul maître des bounds) et ne persiste rien.
 */
export function SidebarPeekOverlay(): React.JSX.Element {
  const hydrate = useTabsStore((s) => s.hydrate)
  const [open, setOpen] = useState(false)
  const openedAt = useRef(0)

  useTabEvents() // patchs relayés par le Main → sidebar toujours à jour

  // Hydratation initiale (snapshot de session), SANS réveiller d'onglet : le peek est passif.
  useEffect(() => {
    window.prism.getSession().then(hydrate)
  }, [hydrate])

  // Ouverture/fermeture pilotées par le Main : il montre la fenêtre puis bascule `open` pour
  // déclencher l'animation (translateX). À la fermeture, il masque la fenêtre après l'anim.
  useEffect(() => {
    return window.prism.onSidebarPeekState((state) => {
      if (state.open) openedAt.current = Date.now()
      setOpen(state.open)
    })
  }, [])

  // Referme dès que la souris quitte le panneau. Petite garde après l'ouverture pour éviter un
  // faux départ si la fenêtre apparaît juste sous le curseur. On demande toujours la fermeture
  // (le Main est idempotent) plutôt que de dépendre de `open`, qui pourrait être désynchronisé.
  const handleLeave = (): void => {
    if (Date.now() - openedAt.current < 150) return
    window.prism.closeSidebarPeek()
  }

  return (
    <aside
      onMouseLeave={handleLeave}
      className={cn(
        'flex h-screen w-screen flex-col border-r border-white/10 bg-sidebar pt-2',
        'text-sidebar-foreground transition-transform duration-200 ease-out will-change-transform',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <PinnedApps />
      <TabList />
    </aside>
  )
}
