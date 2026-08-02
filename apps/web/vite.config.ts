import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // one react instance for the host and every plugin chunk
    dedupe: ['react', 'react-dom'],
  },
})
