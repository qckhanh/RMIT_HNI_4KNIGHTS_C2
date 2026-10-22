import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TIER_HINT, tierOf, type Vendor } from '@/lib/domain'

export function NewRequestForm({ vendors, onSubmit }: { vendors: Vendor[]; onSubmit: (body: object) => void }) {
  const [vendorId, setVendorId] = useState('')
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const value = Number(amount)
  const tier = value > 0 ? tierOf(value) : null

  function pickVendor(id: string) {
    setVendorId(id)
    setAccount(vendors.find((v) => v.id === id)?.account ?? '')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ vendorId, account, amount: value, purpose })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New request</CardTitle>
        <CardDescription>Money only goes to a vendor's verified account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Select name="vendor" value={vendorId} onValueChange={pickVendor} required>
              <SelectTrigger id="vendor" className="w-full"><SelectValue placeholder="Choose a vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account">Account</Label>
            <Input id="account" className="font-mono" value={account} onChange={(e) => setAccount(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <Input id="amount" type="number" min="1" step="1" inputMode="numeric" className="tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            <p className="text-muted-foreground text-xs" aria-live="polite">{tier ? `${tier} · ${TIER_HINT[tier]}` : 'The tier is set by the amount.'}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="purpose">Purpose</Label>
            <Input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is this payment for?" />
          </div>
          <Button type="submit">Create request{tier ? ` (${tier})` : ''}</Button>
        </form>
      </CardContent>
    </Card>
  )
}
