import './assets/main.css'

import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SiteControlOverlay } from './overlay/SiteControlOverlay'
import { SidebarPeekOverlay } from './overlay/SidebarPeekOverlay'

const root = createRoot(document.getElementById('root')!)

// Le même bundle sert la fenêtre principale et les fenêtres-overlay natives (route `?overlay`).
const overlay = new URLSearchParams(window.location.search).get('overlay')

if (overlay) {
  // Fenêtre transparente : fond transparent pour ne laisser voir que le panneau.
  document.body.style.background = 'transparent'
  root.render(<StrictMode>{renderOverlay(overlay)}</StrictMode>)
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

function renderOverlay(name: string): ReactNode {
  switch (name) {
    case 'siteControl':
      return <SiteControlOverlay />
    case 'sidebarPeek':
      return <SidebarPeekOverlay />
    default:
      return null
  }
}
