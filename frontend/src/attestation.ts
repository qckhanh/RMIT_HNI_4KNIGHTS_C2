// Mode 2: a payment attestation signed by the Tide network. Adapted from the Tide pack helper
// templates/relationship-attestation/relationship.ts (RelationshipAttestation:1, built into the ORKs).
//
// The attestation is a Tide policy whose `assignmentId` is the SHA-256 of the exact order. It is
// authorised by the realm's admin policy, so the network signs only after enough realm admins have
// approved it in their own enclave (threshold = the IGA quorum). Each approval is added to the same
// sign request; the backend just carries the bytes between browsers.
import { IAMService } from '@tidecloak/js'
import { Models } from '@tideorg/js'
import { PolicySignRequest } from 'heimdall-tide'
import tcConfig from '../public/tidecloak.json'

type Order = { orderId: string; vendorId: string; account: string; amount: number }
export type AttestationStep = { pendingRequest: string } | { policy: string }

interface TideClient {
  createTideRequest(encoded: Uint8Array): Promise<Uint8Array>
  requestTideOperatorApproval(requests: { id: string; request: Uint8Array }[]): Promise<{ id: string; request: Uint8Array; status: string }[]>
  executeSignRequest(request: Uint8Array, waitForAll?: boolean): Promise<Uint8Array[]>
}

const tc = () => {
  const client = (IAMService as unknown as { _tc: TideClient | null })._tc
  if (!client) throw new Error('TideCloak is not initialised')
  return client
}
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(''))
const fromBase64 = (s: string) => Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0))

// Must match mockbank/server.mjs orderDigest().
async function orderDigest(o: Order): Promise<string> {
  const bytes = new TextEncoder().encode(`${o.orderId}|${o.vendorId}|${o.account}|${o.amount}`)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function adminPolicy(): Promise<Uint8Array> {
  return fromBase64(await (await fetch('/admin-policy.b64')).text())
}

function buildPolicy(assignmentId: string) {
  const version = (Models.Policy as unknown as { latestVersion: string }).latestVersion
  return new Models.Policy({
    version,
    contractId: 'RelationshipAttestation:1',
    modelId: ['PolicyEnabledEncryption:1', 'PolicyEnabledDecryption:1'],
    keyId: (tcConfig as { vendorId: string }).vendorId,
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    params: new Map<string, string>([
      ['subjectType', 'Role'],
      ['subjectId', 'countersign-bank'],
      ['assignmentId', assignmentId],
      ['roles', JSON.stringify(['_tide_decryptor'])],
    ]),
  } as ConstructorParameters<typeof Models.Policy>[0])
}

// Approve in this admin's enclave; sign with the network once the admin policy's threshold is met.
async function approveAndMaybeSign(initialised: Uint8Array, policy: InstanceType<typeof Models.Policy>): Promise<AttestationStep> {
  const id = Models.BaseTideRequest.decode(initialised).getUniqueId()
  const [approval] = await tc().requestTideOperatorApproval([{ id, request: initialised }])
  if (!approval || approval.status !== 'approved') throw new Error(`Not approved in the enclave (${approval?.status ?? 'no response'})`)

  const approved = Models.BaseTideRequest.decode(approval.request)
  const admin = await adminPolicy()
  const threshold = Number(Models.Policy.from(admin).params.entries.get('threshold') ?? 1)
  if (approved.getCurrentApprovalCount() < threshold) return { pendingRequest: toBase64(approved.encode()) }

  approved.addPolicy(admin)
  const [signature] = await tc().executeSignRequest(approved.encode(), true)
  if (!signature) throw new Error('The Tide network returned no signature')
  policy.signature = signature
  return { policy: toBase64(policy.toBytes()) }
}

export async function startAttestation(order: Order): Promise<AttestationStep> {
  const policy = buildPolicy(await orderDigest(order))
  const request = PolicySignRequest.New(policy)
  request.setCustomExpiry(3600)
  return approveAndMaybeSign(await tc().createTideRequest(request.encode()), policy)
}

export async function coSignAttestation(pendingRequest: string): Promise<AttestationStep> {
  const bytes = fromBase64(pendingRequest)
  const policy = Models.Policy.from(Models.BaseTideRequest.decode(bytes).draft.GetValue(0))
  return approveAndMaybeSign(bytes, policy)
}
