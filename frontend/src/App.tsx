import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTideCloak, useAuthCallback, Authenticated, Unauthenticated } from '@tidecloak/react'
import { coSignAttestation, startAttestation } from './attestation.ts'

// secureFetch needs an absolute URL (Tide pack AP-74).
const API_URL = 'http://localhost:4000'
const BANK_URL = 'http://localhost:4100'

const ROLE_LABELS: Record<string, string> = {
  'chief-accountant': 'Kế toán trưởng',
  cfo: 'CFO',
  'dept-head:ops': 'Trưởng bộ phận Vận hành',
  'ap-clerk': 'Kế toán lập đề nghị',
}
const STATUS: Record<string, [string, string]> = {
  pending: ['Chờ duyệt', 'wait'],
  approved: ['Đủ chữ ký', 'wait'],
  sent: ['Ngân hàng đã chấp nhận', 'ok'],
  bank_rejected: ['Ngân hàng từ chối', 'bad'],
  rejected: ['Bị chặn / từ chối', 'bad'],
}
const label = (role: string) => ROLE_LABELS[role] ?? role
const money = (n: number) => `$${n.toLocaleString('en-US')}`
const tierOf = (n: number) => (n <= 500 ? 'T0' : n <= 10_000 ? 'T1' : 'T2')

type Vendor = { id: string; name: string; account: string }
type Approval = { username: string; role: string; at: string }
type PaymentRequest = {
  id: string; vendorId: string; vendorName?: string; account: string; amount: number; purpose: string; tier: string
  requester: string; source: 'human' | 'penny'; status: string; approvals: Approval[]; missingRoles: string[]; reason?: string
  attestation?: { signers: string[]; pendingRequest?: string; policy?: string }
}

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
        <Desk />
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

function Desk() {
  const { logout, getValueFromToken, secureFetch } = useTideCloak()
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [attestationRequired, setAttestationRequired] = useState(false)

  // Client-side view of the token: display and button visibility only. The backend decides.
  const me: string = getValueFromToken('preferred_username')
  const myRoles: string[] = (getValueFromToken('realm_access')?.roles ?? []).filter((r: string) => r in ROLE_LABELS)

  const api = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const res = await secureFetch(`${API_URL}${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Backend trả về ${res.status}`)
    return data as T
  }, [secureFetch])

  const refresh = useCallback(() => api<PaymentRequest[]>('/requests').then(setRequests).catch(() => {}), [api])

  useEffect(() => {
    api<Vendor[]>('/vendors').then(setVendors).catch((e) => setMessage(e.message))
    api<{ attestationRequired: boolean }>('/config').then((c) => setAttestationRequired(c.attestationRequired)).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 3000) // see other approvers' signatures without reloading
    return () => clearInterval(timer)
  }, [api, refresh])

  async function act(path: string, body: unknown = {}, done?: string) {
    setMessage(null)
    try {
      await api(path, body)
      if (done) setMessage(done)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  // Hướng 2: approve the attestation in this user's Tide enclave, then hand the bytes to the backend.
  async function attest(r: PaymentRequest) {
    setMessage('Đang mở enclave Tide để ký chứng nhận…')
    try {
      const step = r.attestation?.pendingRequest
        ? await coSignAttestation(r.attestation.pendingRequest)
        : await startAttestation({ orderId: r.id, vendorId: r.vendorId, account: r.account, amount: r.amount })
      await act(`/requests/${r.id}/attestation`, step, 'policy' in step ? 'Mạng Tide đã ký chứng nhận — lệnh đã gửi ngân hàng.' : 'Đã ký. Cần thêm một admin đồng ký.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  async function tamper(r: PaymentRequest) {
    setMessage(null)
    try {
      const result = await api<{ accepted?: boolean; reason?: string }>(`/demo/tamper/${r.id}`, {})
      setMessage(result.accepted
        ? `Tuấn đổi tài khoản thành 9999-0000 — ngân hàng VẪN CHẤP NHẬN (Hướng 1 tin backend).`
        : `Tuấn đổi tài khoản thành 9999-0000 — ngân hàng TỪ CHỐI: ${result.reason}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="desk">
      <div className="bar">
        <span>Đăng nhập: <strong>{me}</strong> — {myRoles.length ? myRoles.map(label).join(', ') : 'không có role nghiệp vụ'}</span>
        <span><a href={BANK_URL} target="_blank" rel="noreferrer">Mở MockBank ↗</a>{' '}<button onClick={logout}>Đăng xuất</button></span>
      </div>
      {message && <p role="alert" className="alert">{message}</p>}
      {myRoles.includes('ap-clerk') && (
        <section className="panel">
          <h2>Penny (AI kế toán — giả lập)</h2>
          <p className="muted">Penny đọc hoá đơn trong thư mục và đề xuất chi. Đề xuất của Penny đi qua đúng luật như mọi người.</p>
          <div><button onClick={() => act('/penny/run', {}, 'Penny đã xử lý hoá đơn — xem danh sách bên dưới.')}>Cho Penny xử lý hoá đơn</button></div>
        </section>
      )}
      <NewRequest vendors={vendors} onSubmit={(body) => act('/requests', body, 'Đã tạo đề nghị chi.')} />
      <section className="panel">
        <h2>Đề nghị chi</h2>
        <div className="table">
          <table>
            <thead>
              <tr><th>Mã</th><th>Nhà cung cấp / tài khoản</th><th className="num">Số tiền</th><th>Hạng</th><th>Người tạo</th><th>Chữ ký</th><th>Trạng thái</th><th></th></tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const canSign = r.status === 'pending' && r.requester !== me && !r.approvals.some((a) => a.username === me)
                  && r.missingRoles.some((role) => myRoles.includes(role))
                const [text, tone] = STATUS[r.status] ?? [r.status, '']
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.vendorName ?? '—'}<br /><span className="muted">{r.account}</span>{r.purpose && <><br /><span className="muted">{r.purpose}</span></>}</td>
                    <td className="num">{money(r.amount)}</td>
                    <td>{r.tier}</td>
                    <td>{r.source === 'penny' ? '🤖 Penny' : r.requester}</td>
                    <td>
                      {r.approvals.map((a) => <div key={a.username} className="ok">✓ {a.username} ({label(a.role)})</div>)}
                      {r.status === 'pending' && r.missingRoles.map((role) => <div key={role} className="wait">… {label(role)}</div>)}
                    </td>
                    <td>
                      <span className={tone}>{text}</span>{r.reason && <div className="muted">{r.reason}</div>}
                      {r.attestation && <div className="muted">Chứng nhận Tide: {r.attestation.policy ? 'đã ký' : 'đang chờ đồng ký'} ({r.attestation.signers.join(', ')})</div>}
                    </td>
                    <td>
                      {canSign && <><button onClick={() => act(`/requests/${r.id}/approve`)}>Duyệt</button>{' '}
                        <button onClick={() => act(`/requests/${r.id}/reject`)}>Từ chối</button></>}
                      {r.status === 'pending' && r.requester === me && <span className="muted">Không tự duyệt được đề nghị của mình</span>}
                      {attestationRequired && r.status === 'approved' && !r.attestation?.policy && !r.attestation?.signers.includes(me)
                        && (r.attestation?.pendingRequest || myRoles.includes('chief-accountant'))
                        && <button onClick={() => attest(r)}>{r.attestation?.pendingRequest ? 'Đồng ký chứng nhận' : 'Ký chứng nhận (Tide)'}</button>}
                      {r.status === 'sent' && <button onClick={() => tamper(r)} title="Demo: kẻ chiếm server đổi tài khoản nhận">🕵 Tuấn đổi tài khoản</button>}
                    </td>
                  </tr>
                )
              })}
              {!requests.length && <tr><td colSpan={8}>Chưa có đề nghị nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function NewRequest({ vendors, onSubmit }: { vendors: Vendor[]; onSubmit: (body: object) => void }) {
  const [vendorId, setVendorId] = useState('')
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const value = Number(amount)

  function pickVendor(id: string) {
    setVendorId(id)
    setAccount(vendors.find((v) => v.id === id)?.account ?? '')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ vendorId, account, amount: value, purpose })
  }

  return (
    <section className="panel">
      <h2>Tạo đề nghị chi</h2>
      <form className="form" onSubmit={submit}>
        <label>Nhà cung cấp
          <select value={vendorId} onChange={(e) => pickVendor(e.target.value)} required>
            <option value="">— chọn —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label>Tài khoản nhận
          <input value={account} onChange={(e) => setAccount(e.target.value)} required />
        </label>
        <label>Số tiền (USD)
          <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label>Mục đích
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <button type="submit">Tạo{value > 0 ? ` (${tierOf(value)})` : ''}</button>
      </form>
    </section>
  )
}

export default App
