import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TideCloakContextProvider } from '@tidecloak/react'
import './index.css'
import App from './App.tsx'
import tcConfig from '../public/tidecloak.json'

// From the Tide pack template (react-vite-internal-dashboard): the provider takes the adapter JSON
// directly, and useDPoP goes inside the config object so tokens are sender-constrained.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TideCloakContextProvider config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}>
      <App />
    </TideCloakContextProvider>
  </StrictMode>,
)
