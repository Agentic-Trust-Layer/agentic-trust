## A2A discovery bootstrap: domain → agent card (`agent.json`)

This document describes the **web-native** way A2A clients go from “some identifier” (usually a domain) to the **agent card** (`agent.json`) and then to the **A2A message endpoint** (e.g. `/api/a2a`).

The key idea: **`/.well-known/agent.json` is the canonical bootstrap**. DNS hints are optional accelerators.

## What you start with: a resolvable identifier

An A2A client begins with any identifier that can be resolved to an authoritative domain, commonly:

- A DNS domain (`agent.example.com`)
- A URL (`https://agent.example.com/...`)
- A registry reference (optional, ecosystem-specific)

Goal: determine the authoritative host (e.g. `agent.example.com`).

## Optional DNS TXT discovery (hints)

If DNS is available, a client *may* query TXT records for hints at:

- `_agent.agent.example.com`

Example TXT record:

```text
v=agent/1
c=https://agent.example.com/agent.json
u=https://agent.example.com/api/a2a
```

Common fields:

- **`v`**: discovery version
- **`c`**: explicit `agent.json` URL (agent card location)
- **`u`**: explicit A2A message endpoint URL

Rules:

- If `c=` exists, the client should fetch that URL for the agent card.
- DNS TXT records are **optional hints**, not mandatory.

## Well-known fallback (canonical rule)

If no explicit `agent.json` URL is provided (or DNS isn’t used), clients **must** try:

- `GET https://agent.example.com/.well-known/agent.json`

This mirrors established web patterns (OAuth, OpenID, WebFinger, DID documents over HTTPS): deterministic, cacheable, crawlable.

## Fetch and parse `agent.json` (the agent card)

The agent card describes:

- Agent identity (name, description, image, etc.)
- Supported protocols (A2A, MCP, etc.)
- Declared endpoints (where to send messages)
- Optional verification metadata (signatures, registry refs, etc.)

Simplified example:

```json
{
  "name": "Example Agent",
  "protocols": ["a2a"],
  "endpoints": {
    "a2a": "https://agent.example.com/api/a2a"
  }
}
```

Some implementations also publish an optional, UI-oriented companion document:

- `GET https://agent.example.com/.well-known/agent-card.json`

Treat this as optional: clients should not depend on it for connectivity.

## Validate (optional but recommended)

After retrieval, clients may validate based on their trust model:

- HTTPS/TLS trust
- Domain consistency (card must match the origin you contacted)
- Optional signatures
- Optional registry references

Validation strictness depends on the ecosystem.

## Minimal bootstrap (no registry, no chain)

The smallest valid A2A bootstrap is:

**Known domain**
→ `GET /.well-known/agent.json`
→ use declared `endpoints.a2a`

That enables:

- Web-native agents
- Search engine crawling / indexing
- Gradual adoption without mandatory registries

## Canonical client algorithm (summary)

1. Resolve authoritative domain from input
2. (Optional) check DNS TXT `_agent.<domain>` for hints
3. If an agent-card URL is specified → fetch it
4. Else → fetch `https://<domain>/.well-known/agent.json`
5. Parse the agent card
6. Connect to the declared A2A endpoint

## Validate the A2A endpoint (after you have the agent card)

Once you’ve fetched `agent.json`, you typically have an A2A endpoint URL such as:

- `endpoints.a2a = "https://agent.example.com/api/a2a"`

Recommended validation checks before sending traffic:

- **Protocol**: require `https://` (reject plain HTTP unless you explicitly allow it for local/dev).
- **Origin consistency**: the endpoint host should match the host you fetched the agent card from (or be an explicitly allowed alias).
- **Shape**: endpoint must be an absolute URL; reject relative or non-URL strings.
- **Protocol support**: confirm the card declares A2A (e.g. `protocols` includes `"a2a"` or equivalent).
- **Optional integrity**: if your ecosystem supports signatures, verify the card/signature chain before trusting endpoints.

If any check fails, don’t “guess” a new endpoint. Treat it as a configuration problem.

## Prepare and send a message to the endpoint (based on the agent card)

After selecting `endpoints.a2a`, send an HTTP `POST` with a JSON envelope.

Minimal message envelope (example):

```json
{
  "messageId": "msg_1730000000_ab12cd",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "message": "Hello from an A2A client",
  "skillId": "example.echo",
  "payload": {
    "text": "ping"
  }
}
```

Minimal HTTP request:

```text
POST /api/a2a HTTP/1.1
Host: agent.example.com
Content-Type: application/json

{ ...message envelope... }
```

Notes:

- **Which `skillId` to use** comes from what the agent card advertises as supported capabilities/skills (schema varies by ecosystem). If the card doesn’t advertise skills, you need out-of-band agreement on what the agent understands.
- **Authentication** (if required) is ecosystem-specific:
  - Some deployments accept unauthenticated messages.
  - Others require an API key, signed requests, or an auth handshake described by the agent card.
