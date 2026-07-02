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

  // Ctrl+T lorsque le chrome React a le focus → palette de commande. (Quand c'est une page qui a
  // le focus, le raccourci est capté côté Main dans TabManager.before-input-event.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        window.prism.openCommandPalette({
          mode: 'newTab',
          activeId: useTabsStore.getState().activeTabId
        })
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
