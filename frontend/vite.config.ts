import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

// The Tide enclave loads the DPoP relay at /tide_dpop/iss/<hex>/aud/<hex>/tide_dpop_auth.html.
// Without this rewrite Vite's SPA fallback serves index.html there and login never completes.
// The relay needs its own CSP plus Allow-CSP-From because it runs in an iframe first (Tide pack I-12, AP-70/71).
const dpopRelay: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url?.startsWith('/tide_dpop/')) {
    req.url = '/tide_dpop_auth.html'
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'")
    res.setHeader('Allow-CSP-From', '*')
  }
  next()
}

const tideDpopRelay: Plugin = {
  name: 'tide-dpop-relay',
  configureServer: (server) => { server.middlewares.use(dpopRelay) },
  configurePreviewServer: (server) => { server.middlewares.use(dpopRelay) },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tideDpopRelay, react()],
})
