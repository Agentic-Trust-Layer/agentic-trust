# ERC-8092 association + delegation flow (reference: `apps/assoc-delegation`)

This repo has a known-good end-to-end reference implementation in:

- `apps/assoc-delegation/src/index.ts`

The ATP agent mirrors that flow.

## What “works” (high level)

- **Digest**: signatures are over the **raw EIP-712 digest bytes** from `@agentic-trust/8092-sdk` `eip712Hash(record)` (no `personal_sign` prefix).
- **Initial on-chain state**: create the association with **initiator signature only** (`approverSignature = 0x`).
- **Later**: add the approver signature with `updateAssociationSignatures(associationId, 0x, approverSignature)`.

## Why initial store is initiator-only

In practice, validating the approver signature is the part most likely to fail (smart account / delegation / ERC-1271 / delegated validation). Storing initiator-only:

- avoids validating an approver signature during `storeAssociation`, and
- ensures the association exists on-chain so it can be updated.

## ATP agent behavior

In `apps/atp-agent/src/worker.ts` (`oasf:trust.feedback.authorization`):

1. Derive `associationId` from the record (`associationIdFromRecord`).
2. Try `getAssociation(associationId)`.
3. If not found:
   - submit `storeAssociation` with `approverSignature: '0x'` (initiator-only).
4. If found and `approverSignature` is empty:
   - sign the digest with the session key EOA (raw bytes),
   - submit `updateAssociationSignatures(associationId, '0x', approverSignature)` via delegation.


