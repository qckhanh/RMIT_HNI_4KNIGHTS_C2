import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TideCloakContextProvider } from '@tidecloak/react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import App from './App.tsx'
import tcConfig from '../public/tidecloak.json'

// Follow the system light/dark setting (shadcn themes key off the `dark` class).
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', dark.matches)
applyTheme()
dark.addEventListener('change', applyTheme)

// From the Tide pack template (react-vite-internal-dashboard): the provider takes the adapter JSON
// directly, and useDPoP goes inside the config object so tokens are sender-constrained.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TideCloakContextProvider config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}>
      <TooltipProvider>
        <App />
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </TideCloakContextProvider>
  </StrictMode>,
)
