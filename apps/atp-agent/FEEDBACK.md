# ATP Agent — Feedback / Review Modes

This document defines the **review / feedback modes** that `atp-agent` is designed to support conceptually.

**Important:** This file is **concepts only** (no implementation commitments). It is meant to guide UX, A2A payloads, and DB schema evolution.

---

## The 4 baseline modes (start here)

These are the core modes we need to support and speak about consistently across UI, A2A skills, and storage.

### 1) Anonymous

**Definition**
- The reviewer’s identity is not disclosed to the subject and is not publicly linkable.

**Properties**
- **Identity disclosure**: none (or hidden/pseudonymized)
- **Consent**: not required
- **Accountability**: low
- **Abuse risk**: high (sybil/spam) unless rate-limited/weighted

**Typical usage**
- Early signal / whistleblowing
- “Pulse check” feedback where identity would cause retaliation

**Implementation notes (conceptual)**
- Can exist as: off-chain message + optional public aggregate.
- If on-chain submission is required, “anonymous” usually means **private-but-provable** (see below) or a proxy that removes linkage.

---

### 2) Unilateral

**Definition**
- Feedback is submitted by the reviewer without requiring subject approval and is considered publishable immediately.

**Properties**
- **Identity disclosure**: disclosed or pseudonymous
- **Consent**: not required
- **Publication**: immediate
- **Dispute**: handled after the fact (see “Disputed”)

**Typical usage**
- Open reputation graphs
- Public reviews in marketplaces

**Implementation notes (conceptual)**
- Works well with weighting / validator mediation to mitigate abuse.

---

### 3) Consented - two options a) immediate consent b) request & review consent at later time

**Definition**
- Feedback is only considered valid/publishable after the subject approves it (or grants authorization).

**Properties**
- **Identity disclosure**: may be disclosed to the subject
- **Consent**: required  ()
- **Publication**: gated by approval

**Typical UX**
- Reviewer clicks “Request permission to review”
- Subject approves
- Reviewer submits feedback under that approval

**How this maps to `atp-agent` (current conceptual mapping)**
- **Request record**: `agent_feedback_requests`
- **Approval**: `atp.feedback.requestapproved` marks request approved (DB + message)
- **Authorization issuance**: `osaf:trust.feedback.authorization` (from the subject agent’s A2A endpoint) returns `feedbackAuth`
- **Submission**: the reviewer submits feedback using the issued `feedbackAuth`

---

### 4) Solicited

**Definition**
- The subject explicitly requests feedback (invites reviewers) and feedback is submitted in response to that request.

**Properties**
- **Identity disclosure**: varies
- **Consent**: implicit (subject initiated)
- **Publication**: often immediate, or subject can still gate if desired

**Typical UX**
- Subject sends “Please review me” to a set of reviewers
- Reviewers submit in response to the solicitation

**Implementation notes (conceptual)**
- Solicited feedback often has **stronger legitimacy** and can be weighted higher.

---

## Additional important modes (recommended taxonomy)

These are common in mature systems and can be layered on top of the baseline four.

### 5) Delegated
- A reviewer delegates feedback rights to another agent (or org delegate) to submit on their behalf.
- Often time/scope bounded.

### 6) Conditional
- Feedback becomes publishable only if conditions are met (time, payment settlement, interaction duration, validation success, etc.).

### 7) Time-delayed
- Feedback is submitted now but revealed later to reduce retaliation and strategic manipulation.

### 8) Revocable
- Feedback can be amended/withdrawn within a window or under policy (e.g., compliance regimes).

### 9) Disputed
- The subject can challenge a feedback entry; dispute status attaches to the record without erasing history.

### 10) Mediated
- A third-party (validator / arbitrator) verifies, weights, or adjudicates feedback.

### 11) Reciprocal
- Two-sided feedback; can require both parties to submit before publication.

### 12) Weighted
- Feedback weight depends on reviewer reputation, relationship strength, validator score, stake, etc.

### 13) Private-but-provable
- Feedback content is private, but cryptographic proof or aggregate score is public (ZK-friendly).

---

## Canonical mode identifiers (recommended)

If/when a canonical enum is needed, use:

- `anonymous`
- `unilateral`
- `consented`
- `solicited`
- `delegated`
- `conditional`
- `time_delayed`
- `revocable`
- `disputed`
- `mediated`
- `reciprocal`
- `weighted`
- `private_provable`

---

## Why this matters (design lens)

These modes collectively define a **feedback rights + disclosure protocol**, not just “reviews”.

They govern:
- **Who may speak**
- **When feedback becomes valid**
- **Whether identity is disclosed**
- **Whether publication is immediate or gated**
- **Whether disputes/mediation change visibility or weight**

---

## Mapping to `atp-agent` concepts (high-level)

`atp-agent` treats feedback as a collaboration flow that typically touches:

- **Inbox / messaging** (`messages` table): notification + workflow coordination
- **Feedback request state** (`agent_feedback_requests` table): approval gating and linkage to agents
- **Auth issuance** (`osaf:trust.feedback.authorization`): subject agent issues `feedbackAuth` to the reviewer

This enables a clean separation:

- **Requesting feedback** (workflow / state / messaging)
- **Issuing authorization** (subject-side cryptographic operation)
- **Submitting feedback** (reviewer-side action using the authorization)


