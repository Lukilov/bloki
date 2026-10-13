import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Inside the desktop app, let the styles make room for the window controls.
const desktop = (window as { blokiDesktop?: { platform: string } }).blokiDesktop
if (desktop) document.documentElement.dataset.desktop = desktop.platform

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
