import { useState } from 'react'
import { useTideCloak, useAuthCallback, Authenticated, Unauthenticated } from '@tidecloak/react'

// secureFetch needs an absolute URL (Tide pack AP-74).
const API_URL = 'http://localhost:4000'

function App() {
  const { isInitializing } = useTideCloak()

  // Handles the OIDC redirect (?code=...) back from TideCloak.
  const { isCallback, isProcessing, error } = useAuthCallback({
    onSuccess: (returnUrl) => window.location.assign(returnUrl || '/'),
    onError: () => window.location.assign('/'),
    onMissingVerifierRedirectTo: '/',
  })

  if (isCallback) {
    if (error) return <p>Authentication failed: {error.message}</p>
    return <p>{isProcessing ? 'Completing login...' : 'Redirecting...'}</p>
  }
  // Must be checked before the guards: Unauthenticated also renders while initializing.
  if (isInitializing) return <p>Initializing TideCloak...</p>

  return (
    <main>
      <h1>Countersign</h1>
      <Authenticated>
        <Session />
      </Authenticated>
      <Unauthenticated>
        <LoginButton />
      </Unauthenticated>
    </main>
  )
}

function LoginButton() {
  const { login } = useTideCloak()
  return <button onClick={login}>Đăng nhập bằng Tide</button>
}

type Me = { username: string; name?: string; roles: string[] }

function Session() {
  const { logout, getValueFromToken, secureFetch } = useTideCloak()
  const [me, setMe] = useState<Me | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  // Client-side view of the token: display only, never an authorization decision.
  const username: string = getValueFromToken('preferred_username')
  const roles: string[] = (getValueFromToken('realm_access')?.roles ?? []).filter(
    (r: string) => !r.startsWith('default-roles') && !r.startsWith('_tide') && r !== 'offline_access' && r !== 'uma_authorization',
  )

  async function checkBackend() {
    setApiError(null)
    try {
      const res = await secureFetch(`${API_URL}/me`)
      if (res.ok) setMe(await res.json())
      else setApiError(`Backend trả về ${res.status}`)
    } catch (e) {
      setApiError(`Không gọi được backend: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section>
      <p>Đăng nhập: <strong>{username}</strong></p>
      <p>Role (từ token phía trình duyệt): {roles.length ? roles.join(', ') : '(không có)'}</p>
      <button onClick={checkBackend}>Gọi backend /me</button>{' '}
      <button onClick={logout}>Đăng xuất</button>
      {me && <p>Backend xác nhận: <strong>{me.username}</strong>{me.name ? ` (${me.name})` : ''} — role: {me.roles.join(', ') || '(không có)'}</p>}
      {apiError && <p role="alert">{apiError}</p>}
    </section>
  )
}

export default App
