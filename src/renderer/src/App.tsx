import { useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { WebViewArea } from './components/WebViewArea'
import { SidebarPeekTrigger } from './components/SidebarPeekTrigger'
import { useTabEvents } from './hooks/useTabEvents'
import { useSidebarLayout } from './hooks/useSidebarLayout'
import { useSession, usePersistUiState } from './hooks/useSession'
import { useTabsStore } from './store/tabsStore'

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
        window.prism.openHistory()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-sidebar">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <WebViewArea />
      </div>
      <SidebarPeekTrigger />
    </div>
  )
}

export default App
