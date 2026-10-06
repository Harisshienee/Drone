import { defineConfig } from 'vite'

export default defineConfig({
  // host: true exposes the dev server on the LAN so a phone can reach it before deploying
  server: { host: true },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        controller: 'controller/index.html',
      },
    },
  },
})
