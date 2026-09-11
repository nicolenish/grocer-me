import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 loopback explicitly. The default resolves to [::1] on Node 17+,
    // which browsers that map localhost -> 127.0.0.1 cannot reach.
    host: '127.0.0.1',
    port: 5173,
  },
})
