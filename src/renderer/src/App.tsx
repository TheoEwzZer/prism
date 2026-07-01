import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { WebViewArea } from './components/WebViewArea'
import { SidebarPeekTrigger } from './components/SidebarPeekTrigger'
import { useTabEvents } from './hooks/useTabEvents'
import { useSidebarLayout } from './hooks/useSidebarLayout'
import { useSession, usePersistUiState } from './hooks/useSession'

function App(): React.JSX.Element {
  const ready = useSession() // hydrate depuis la session persistée
  useTabEvents() // applique les patchs batchés du Main
  useSidebarLayout() // émet les intentions de layout vers le Main
  usePersistUiState(ready) // persiste l'état UI organisationnel

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
