import { useCallback, useEffect, useState } from 'react'
import { useTideCloak } from '@tidecloak/react'
import { toast } from 'sonner'
import { ArrowUpRight, Bot, LogOut } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { coSignAttestation, startAttestation } from '@/attestation'
import { API_URL, BANK_URL, label, ROLE_LABELS, type PaymentRequest, type Vendor } from '@/lib/domain'
import { NewRequestForm } from './NewRequestForm'
import { canAttest, canSign, RequestsTable } from './RequestsTable'

export function Desk() {
  const { logout, getValueFromToken, secureFetch } = useTideCloak()
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [attestationRequired, setAttestationRequired] = useState(false)

  // Client-side view of the token: display and button visibility only. The backend decides.
  const me: string = getValueFromToken('preferred_username')
  const myRoles: string[] = (getValueFromToken('realm_access')?.roles ?? []).filter((r: string) => r in ROLE_LABELS)

  const api = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const res = await secureFetch(`${API_URL}${path}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Backend returned ${res.status}`)
    return data as T
  }, [secureFetch])

  const refresh = useCallback(() => api<PaymentRequest[]>('/requests').then(setRequests).catch(() => {}), [api])

  useEffect(() => {
    api<Vendor[]>('/vendors').then(setVendors).catch((e) => toast.error(e.message))
    api<{ attestationRequired: boolean }>('/config').then((c) => setAttestationRequired(c.attestationRequired)).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 3000) // see other approvers' signatures without reloading
    return () => clearInterval(timer)
  }, [api, refresh])

  async function act(path: string, body: unknown = {}, done?: string) {
    try {
      await api(path, body)
      if (done) toast.success(done)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  // Demo helper: the test cases from plan B, raised through the normal API under the clerk's login.
  async function seedDemo() {
    const packaging = vendors.find((v) => v.id === 'mekong-packaging')
    if (!packaging) return toast.error("Vendors haven't loaded yet")
    await act('/penny/run')
    await act('/requests', { vendorId: packaging.id, account: packaging.account, amount: 5000, purpose: 'Export cartons (T1)' })
    await act('/requests', { vendorId: packaging.id, account: packaging.account, amount: 15000, purpose: 'Packing machine (T2)' }, "Created Penny's $320 request (the poisoned invoice was blocked), a $5,000 T1 and a $15,000 T2.")
  }

  // Mode 2: approve the attestation in this user's Tide enclave, then hand the bytes to the backend.
  async function attest(r: PaymentRequest) {
    const opening = toast.loading('Opening the Tide enclave to sign the attestation…')
    try {
      const step = r.attestation?.pendingRequest
        ? await coSignAttestation(r.attestation.pendingRequest)
        : await startAttestation({ orderId: r.id, vendorId: r.vendorId, account: r.account, amount: r.amount })
      toast.dismiss(opening)
      await act(`/requests/${r.id}/attestation`, step, 'policy' in step ? 'The Tide network signed the attestation. Order sent to the bank.' : 'Signed. One more admin must co-sign.')
    } catch (e) {
      toast.dismiss(opening)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function tamper(r: PaymentRequest) {
    try {
      const result = await api<{ accepted?: boolean; reason?: string }>(`/demo/tamper/${r.id}`, {})
      if (result.accepted) toast.warning('Compromised server redirected the payment to 9999-0000. The bank accepted it: mode 1 trusts the backend.')
      else toast.success(`Compromised server redirected the payment to 9999-0000. The bank refused it: ${result.reason}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const mine = requests.filter((r) => canSign(r, me, myRoles) || canAttest(r, me, myRoles, attestationRequired))
  const tableProps = {
    me, myRoles, attestationRequired,
    onApprove: (r: PaymentRequest) => act(`/requests/${r.id}/approve`),
    onReject: (r: PaymentRequest) => act(`/requests/${r.id}/reject`),
    onAttest: attest,
    onTamper: tamper,
  }

  return (
    <div className="min-h-svh">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="font-semibold tracking-tight">Countersign</span>
          <Badge variant="outline" className="text-muted-foreground hidden sm:inline-flex">
            {attestationRequired ? 'Mode 2 · bank accepts only Tide-signed payments' : 'Mode 1 · bank trusts the backend'}
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href={BANK_URL} target="_blank" rel="noreferrer">Bank ledger<ArrowUpRight data-icon="inline-end" /></a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 px-1.5" aria-label="Account menu">
                  <Avatar className="size-7"><AvatarFallback className="text-xs">{me?.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                  <span className="hidden text-sm md:inline">{me}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm">{me}</div>
                  <div className="text-muted-foreground text-xs font-normal">{myRoles.length ? myRoles.map(label).join(', ') : 'No business role'}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logout()}><LogOut />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="requests-title" className="min-w-0">
          <Tabs defaultValue="mine">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h1 id="requests-title" className="text-lg font-semibold tracking-tight">Payment requests</h1>
              <TabsList>
                <TabsTrigger value="mine">Needs my signature{mine.length ? ` (${mine.length})` : ''}</TabsTrigger>
                <TabsTrigger value="all">All ({requests.length})</TabsTrigger>
              </TabsList>
            </div>
            <Card className="py-0">
              <CardContent className="px-0">
                <TabsContent value="mine"><RequestsTable {...tableProps} requests={mine} empty="Nothing is waiting for your signature." /></TabsContent>
                <TabsContent value="all"><RequestsTable {...tableProps} requests={requests} empty="No payment requests yet." /></TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        </section>

        <aside className="grid content-start gap-6">
          <NewRequestForm vendors={vendors} onSubmit={(body) => act('/requests', body, 'Request created.')} />
          {myRoles.includes('ap-clerk') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="size-4" aria-hidden />AI clerk (simulated)</CardTitle>
                <CardDescription>Penny reads the invoice folder and proposes payments. Her proposals follow the same rules as everyone's.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button variant="outline" onClick={() => act('/penny/run', {}, 'Penny processed the invoices. See the requests list.')}>Process invoices</Button>
                <Button variant="ghost" onClick={seedDemo}>Load demo cases</Button>
              </CardContent>
            </Card>
          )}
        </aside>
      </main>
    </div>
  )
}
