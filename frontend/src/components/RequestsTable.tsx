import { Bot, Check, Circle, EllipsisVertical, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { label, money, STATUS, TIER_HINT, type PaymentRequest, type Tone } from '@/lib/domain'

const TONE: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
}

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Request</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Signatures</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-0"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((r) => {
          const [status, tone] = STATUS[r.status] ?? [r.status, 'warning']
          const sign = canSign(r, me, myRoles)
          const attest = canAttest(r, me, myRoles, attestationRequired)
          return (
            <TableRow key={r.id} className="align-top">
              <TableCell className="max-w-72 whitespace-normal">
                <div className="font-medium">{r.vendorName ?? 'Unknown vendor'}</div>
                <div className="text-muted-foreground font-mono text-xs">{r.account}</div>
                {r.purpose && <div className="text-muted-foreground mt-1 text-xs">{r.purpose}</div>}
                <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-mono">{r.id}</span>
                  <span aria-hidden>·</span>
                  {r.source === 'penny'
                    ? <span className="inline-flex items-center gap-1"><Bot className="size-3.5" aria-hidden />Penny (AI)</span>
                    : <span>{r.requester}</span>}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="font-medium tabular-nums">{money(r.amount)}</div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="mt-1 cursor-help font-mono">{r.tier}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>{TIER_HINT[r.tier]}</TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="whitespace-normal">
                <ul className="grid gap-1 text-xs">
                  {r.approvals.map((a) => (
                    <li key={a.username} className="text-success flex items-center gap-1.5">
                      <Check className="size-3.5 shrink-0" aria-hidden /><span>{a.username}</span>
                      <span className="text-muted-foreground">{label(a.role)}</span>
                    </li>
                  ))}
                  {r.status === 'pending' && r.missingRoles.map((role) => (
                    <li key={role} className="text-muted-foreground flex items-center gap-1.5">
                      <Circle className="size-3.5 shrink-0" strokeDasharray="3 3" aria-hidden />
                      <span>{label(role)}</span><span className="sr-only">has not signed</span>
                    </li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal">
                <Badge variant="outline" className={cn(TONE[tone])}>{status}</Badge>
                {r.reason && <p className="text-muted-foreground mt-1.5 text-xs">{r.reason}</p>}
                {r.attestation && (
                  <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-xs">
                    <ShieldCheck className={cn('size-3.5 shrink-0', r.attestation.policy && 'text-success')} aria-hidden />
                    <span>Tide attestation {r.attestation.policy ? 'signed' : 'waiting for a co-signer'} ({r.attestation.signers.join(', ')})</span>
                  </p>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  {sign && <><Button size="sm" onClick={() => onApprove(r)}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => onReject(r)}>Reject</Button></>}
                  {r.status === 'pending' && r.requester === me && (
                    <span className="text-muted-foreground w-36 text-right text-xs">You can't approve your own request</span>
                  )}
                  {attest && <Button size="sm" onClick={() => onAttest(r)}>{r.attestation?.pendingRequest ? 'Co-sign attestation' : 'Sign attestation'}</Button>}
                  {r.status === 'sent' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label="Demo actions"><EllipsisVertical /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-muted-foreground text-xs">Demo</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => onTamper(r)}>Simulate compromised server</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
