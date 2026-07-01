import { Sidebar } from './components/Sidebar'
import { WebViewArea } from './components/WebViewArea'
import { useTabEvents } from './hooks/useTabEvents'
import { useSidebarLayout } from './hooks/useSidebarLayout'
import { useSession, usePersistUiState } from './hooks/useSession'

function App(): React.JSX.Element {
  const ready = useSession() // hydrate depuis la session persistée
  useTabEvents() // applique les patchs batchés du Main
  useSidebarLayout() // émet les intentions de layout vers le Main
  usePersistUiState(ready) // persiste l'état UI organisationnel

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <WebViewArea />
    </div>
  )
}

export default App
