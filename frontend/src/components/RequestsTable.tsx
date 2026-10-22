import { Bot, Check, Circle, EllipsisVertical, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { label, money, STATUS, TIER_HINT, type PaymentRequest, type Tone } from '@/lib/domain'

const TONE: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
}

// One grid for the header and every row, so columns line up without a <table> that can overflow.
// Below xl a row becomes 2x2 (request | amount, signatures | status) instead of squeezing.
const COLUMNS = 'sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_6rem_minmax(0,12.5rem)_minmax(0,14rem)]'

// The same conditions the desk has always used to show actions. The backend still decides.
export const canSign = (r: PaymentRequest, me: string, myRoles: string[]) =>
  r.status === 'pending' && r.requester !== me && !r.approvals.some((a) => a.username === me)
  && r.missingRoles.some((role) => myRoles.includes(role))
export const canAttest = (r: PaymentRequest, me: string, myRoles: string[], attestationRequired: boolean) =>
  attestationRequired && r.status === 'approved' && !r.attestation?.policy && !r.attestation?.signers.includes(me)
  && (!!r.attestation?.pendingRequest || myRoles.includes('chief-accountant'))

type Props = {
  requests: PaymentRequest[]
  me: string
  myRoles: string[]
  attestationRequired: boolean
  onApprove: (r: PaymentRequest) => void
  onReject: (r: PaymentRequest) => void
  onAttest: (r: PaymentRequest) => void
  onTamper: (r: PaymentRequest) => void
  empty: string
}

export function RequestsTable({ requests, me, myRoles, attestationRequired, onApprove, onReject, onAttest, onTamper, empty }: Props) {
  if (!requests.length) {
    return <p className="text-muted-foreground py-12 text-center text-sm">{empty}</p>
  }
  return (
    <div>
      <div className={cn('text-muted-foreground hidden gap-5 border-b px-5 py-2.5 text-xs font-medium xl:grid', COLUMNS)} aria-hidden>
        <span>Request</span><span className="text-right">Amount</span><span>Signatures</span><span>Status</span>
      </div>
      <ul className="divide-y">
        {requests.map((r) => {
          const [status, tone] = STATUS[r.status] ?? [r.status, 'warning']
          const sign = canSign(r, me, myRoles)
          const attest = canAttest(r, me, myRoles, attestationRequired)
          const missing = r.status === 'pending' ? r.missingRoles : []
          const total = r.approvals.length + missing.length
          const ownPending = r.status === 'pending' && r.requester === me
          return (
            <li key={r.id} className={cn('grid items-start gap-x-5 gap-y-4 px-5 py-4', COLUMNS)}>
              <div className="min-w-0">
                <p className="truncate font-medium">{r.vendorName ?? 'Unknown vendor'}</p>
                <p className="text-muted-foreground truncate font-mono text-xs">{r.account}</p>
                {r.purpose && <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.purpose}</p>}
                <p className="text-muted-foreground mt-2 flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="font-mono">{r.id}</span>
                  <span aria-hidden>·</span>
                  {r.source === 'penny'
                    ? <span className="inline-flex items-center gap-1"><Bot className="size-3.5" aria-hidden />Penny (AI)</span>
                    : <span className="truncate">{r.requester}</span>}
                </p>
              </div>

              <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                <span className="font-medium tabular-nums">{money(r.amount)}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="cursor-help font-mono">{r.tier}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>{TIER_HINT[r.tier]}</TooltipContent>
                </Tooltip>
              </div>

              <div className="min-w-0">
                {total > 0 ? (
                  <>
                    <p className="text-muted-foreground mb-1.5 text-xs">{r.approvals.length} of {total} signed</p>
                    <ul className="grid gap-1 text-sm">
                      {r.approvals.map((a) => (
                        <li key={a.username} className="flex min-w-0 items-center gap-2">
                          <Check className="text-success size-3.5 shrink-0" aria-hidden />
                          <span className="shrink-0">{label(a.role)}</span>
                          <span className="text-muted-foreground truncate text-xs">{a.username}</span>
                        </li>
                      ))}
                      {missing.map((role) => (
                        <li key={role} className="text-muted-foreground flex min-w-0 items-center gap-2">
                          <Circle className="size-3.5 shrink-0" strokeDasharray="3 3" aria-hidden />
                          <span className="truncate">{label(role)}</span><span className="sr-only">has not signed</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : <p className="text-muted-foreground text-xs">No signatures</p>}
              </div>

              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="outline" className={cn(TONE[tone])}>{status}</Badge>
                  {r.status === 'sent' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" className="-mt-1 -mr-2" aria-label="Demo actions"><EllipsisVertical /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-muted-foreground text-xs">Demo</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => onTamper(r)}>Simulate compromised server</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {r.reason && <p className="text-muted-foreground mt-1.5 text-xs break-words">{r.reason}</p>}
                {r.attestation && (
                  <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-xs">
                    <ShieldCheck className={cn('mt-px size-3.5 shrink-0', r.attestation.policy && 'text-success')} aria-hidden />
                    <span>Tide attestation {r.attestation.policy ? 'signed' : 'waiting for a co-signer'} · {r.attestation.signers.join(', ')}</span>
                  </p>
                )}
                {ownPending && <p className="text-muted-foreground mt-1.5 text-xs">You can't approve your own request.</p>}
                {(sign || attest) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sign && <><Button size="sm" onClick={() => onApprove(r)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => onReject(r)}>Reject</Button></>}
                    {attest && <Button size="sm" onClick={() => onAttest(r)}>{r.attestation?.pendingRequest ? 'Co-sign attestation' : 'Sign attestation'}</Button>}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
