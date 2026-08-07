import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { qualyPlugins } from '../../scripts/lib/vite-qualy-plugins.ts'

export default defineConfig({
  plugins: [qualyPlugins(), react(), tailwindcss()],
  resolve: {
    // one react instance for the host and every plugin chunk
    dedupe: ['react', 'react-dom'],
  },
})
