# Decisions

Answers to open technical questions, with their source. "Raziel" = Tide MCP server `@tideorg/mcp` 1.9.33, queried 2026-10-22.

## 0. BLOCKER — custom Forseti contracts are not self-service

- Raziel (`custom-contracts` canon, `policy-governed-signing` scenario): writing and compile-checking a contract is fine, but **uploading it to a realm/network is experimental, test-network only, and done by the Tide team** (info@tide.org or Discord https://discord.gg/XBMd9ny2q5). The upload step is deliberately withheld; do not reconstruct it.
- Signing needs a custom contract: the built-in `RelationshipAttestation:1` only allows encrypt/decrypt.
- Built-in contracts that exist: `GenericResourceAccessThresholdRole:1`, `GenericRealmAccessThresholdRole:1` (approvers hold a role, count ≥ threshold — approvers only, no data checks), `SimpleTagBasedDecryption:1`, `RelationshipAttestation:1`.
- Status: **open — ask the Tide team on Discord to deploy our contract.**

## 1. Is an approver's doken bound to the exact request being signed?

Why it matters: if not, a compromised backend could reuse a stored approver doken on a different payment while the doken is still valid.

- Answer (partial): `ValidateApprovers` runs **only** for `ApprovalType.EXPLICIT` policies, and an EXPLICIT request goes through an **enclave approval card** (`tc.createTideRequest` → `tc.requestTideOperatorApproval` → `tc.executeSignRequest`), i.e. each approval is given on a specific request. Raziel does not say whether the approver dokens in `ctx.Dokens` are themselves bound to the request.
- Caveat: EXPLICIT with a custom model (`BasicCustomRequest("Custom<X>", "Custom<1>")` → `BasicCustom<Custom<X>>:BasicCustom<Custom<1>>`) is marked **predicted, not yet network-verified** (GAP-072). IMPLICIT (no card) is network-verified.
- Source: Raziel `custom-contracts` canon, sections "Deploying a Contract" and the EXPLICIT/IMPLICIT rule.
- Status: **open — confirm with the Tide team.**

## 2. How does a Forseti contract read the draft (amount, account) in `ValidateData`?

- Answer: `ValidateData(DataContext ctx)` gets `ctx.Data`, `ctx.DynamicData`, `ctx.RequestId`. `ctx.Data` is a nested TideMemory byte structure (`ReadOnlyMemory<byte>`), walked with `GetValue(i)` / `TryGetValue`; it can be null. Request data is **not** visible in `ValidateExecutor` (capture it in `ValidateData`, compare later). Blocked namespaces include `System.IO`, `System.Net`, `System.Reflection`, `System.Threading`; gas limit 50,000.
- Display: for the approval card to render, draft slot 0 must be JSON with `humanReadableName` and `additionalInfo`.
- Source: Raziel `custom-contracts` canon, "Three Validation Methods", "Sandbox Restrictions".

## 3. Which TideCloak image?

- Answer: **`tideorg/tidecloak-dev:latest` only.** It talks to the production Tide network (14-of-20 ORKs). Do not use `tideorg/tidecloak-stg-dev`, do not set `SYSTEM_HOME_ORK` / `USER_HOME_ORK` / `THRESHOLD_*` / `PAYER_PUBLIC`, do not append `start-dev`. Root `http://localhost:8080` answers 302 to `/realms/master/tide-console/`; the stock admin console is at `/kc`. Do not name our realm `myrealm` (the image imports its own).
- Source: Raziel playbook `start-tidecloak-dev`.
