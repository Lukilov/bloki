import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Inside the desktop app, let the styles make room for the window controls.
const desktop = (window as { blokiDesktop?: { platform: string; chrome?: unknown } }).blokiDesktop
if (desktop) document.documentElement.dataset.desktop = desktop.platform
// Newer desktop builds draw the workspace switcher in the tab bar, so the sidebar drops its own.
if (desktop?.chrome) document.documentElement.dataset.tabChrome = ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
