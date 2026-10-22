import { useTideCloak, useAuthCallback, Authenticated, Unauthenticated } from '@tidecloak/react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Desk } from '@/components/Desk'

function App() {
  const { isInitializing } = useTideCloak()

  // Handles the OIDC redirect (?code=...) back from TideCloak.
  const { isCallback, isProcessing, error } = useAuthCallback({
    onSuccess: (returnUrl) => window.location.assign(returnUrl || '/'),
    onError: () => window.location.assign('/'),
    onMissingVerifierRedirectTo: '/',
  })

  if (isCallback) {
    if (error) return <Status>Authentication failed: {error.message}</Status>
    return <Status spinner>{isProcessing ? 'Completing sign-in…' : 'Redirecting…'}</Status>
  }
  // Must be checked before the guards: Unauthenticated also renders while initializing.
  if (isInitializing) return <Status spinner>Connecting to Tide…</Status>

  return (
    <>
      <Authenticated>
        <Desk />
      </Authenticated>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
    </>
  )
}

function Status({ children, spinner }: { children: React.ReactNode; spinner?: boolean }) {
  return (
    <div className="text-muted-foreground flex min-h-svh items-center justify-center gap-2 px-4 text-sm" role="status">
      {spinner && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </div>
  )
}

function SignIn() {
  const { login } = useTideCloak()
  return (
    <main className="relative flex min-h-svh flex-col overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,var(--color-muted),transparent)]" />
      <header className="relative mx-auto flex h-14 w-full max-w-7xl items-center px-4 sm:px-6">
        <span className="font-semibold tracking-tight">Countersign</span>
      </header>
      <section className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 pb-24 text-center">
        <h1 className="text-[clamp(2.25rem,5vw,4rem)] leading-[1.05] font-semibold tracking-tight text-balance">
          Payments no one can move alone.
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-base text-balance sm:text-lg">
          Every approval is signed with a real Tide identity, and the bank checks the network's signature instead of trusting our server.
        </p>
        <Button size="lg" className="mt-8" onClick={login}>Sign in with Tide</Button>
      </section>
    </main>
  )
}

export default App
