import { useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { WebViewArea } from './components/WebViewArea'
import { SidebarPeekTrigger } from './components/SidebarPeekTrigger'
import { SplitPaneBars } from './components/SplitPaneBars'
import { useTabEvents } from './hooks/useTabEvents'
import { useSidebarLayout } from './hooks/useSidebarLayout'
import { useSession, usePersistUiState } from './hooks/useSession'
import { useTabsStore } from './store/tabsStore'
import { HISTORY_URL } from '@shared/types'

/**
 * Ouvre l'onglet interne `prism://history/` s'il n'existe pas déjà, sinon l'active (pas de doublon).
 * La logique vit côté Renderer car l'onglet actif est du UI state. Créer un onglet passe par le Main
 * (invoke `createTab`) qui rediffuse `tab:created` → le store l'ajoute ET le rend actif.
 */
function openOrFocusHistory(): void {
  const state = useTabsStore.getState()
  const existing = Object.keys(state.tabs).find((id) => state.tabs[id]?.url === HISTORY_URL)
  if (existing) {
    state.setActive(existing)
    window.prism.activateTab(existing)
  } else {
    window.prism.createTab({ url: HISTORY_URL })
  }
}

function App(): React.JSX.Element {
  const ready = useSession() // hydrate depuis la session persistée
  useTabEvents() // applique les patchs batchés du Main
  useSidebarLayout() // émet les intentions de layout vers le Main
  usePersistUiState(ready) // persiste l'état UI organisationnel

  // Raccourcis lorsque le chrome React a le focus. (Quand c'est une page qui a le focus, ils sont
  // captés côté Main dans TabManager.before-input-event.) Ctrl+T → palette ; Ctrl+H → historique.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 't') {
        e.preventDefault()
        window.prism.openCommandPalette({
          mode: 'newTab',
          activeId: useTabsStore.getState().activeTabId
        })
      } else if (key === 'h') {
        e.preventDefault()
        openOrFocusHistory()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ctrl+H frappé alors qu'une PAGE avait le focus : le Main nous relaie l'intention ici.
  useEffect(() => window.prism.onOpenHistory(openOrFocusHistory), [])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-sidebar">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <WebViewArea />
      </div>
      {/* Barres d'outils par panneau (vue divisée), positionnées en absolu au-dessus des vues. */}
      <SplitPaneBars />
      <SidebarPeekTrigger />
    </div>
  )
}

export default App
