import './assets/main.css'

import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { OverlayLayer } from './overlay/OverlayLayer'

const root = createRoot(document.getElementById('root')!)

// Le même bundle sert la fenêtre principale et la couche d'overlay native (route `?overlay`).
const overlay = new URLSearchParams(window.location.search).get('overlay')

if (overlay) {
  // Fenêtre transparente : fond transparent pour ne laisser voir que les panneaux.
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
    case 'layer':
      return <OverlayLayer />
    default:
      return null
  }
}
