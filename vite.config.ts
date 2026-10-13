import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4321', '/files': 'http://127.0.0.1:4321', '/collab': { target: 'ws://127.0.0.1:4321', ws: true } } },
})
