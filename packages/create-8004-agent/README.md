# @agentic-trust/create-8004-agent

Local wizard CLI to scaffold a **simple agent app** inside this monorepo (under `apps/`).

## Run (local)

```bash
pnpm -C packages/create-8004-agent dev
```

Run from anywhere (pick where the app is created):

```bash
node /path/to/agentic-trust/packages/create-8004-agent/dist/index.js --repo-root /path/to/agentic-trust
```

Or build + run:

```bash
pnpm -C packages/create-8004-agent build
node packages/create-8004-agent/dist/index.js
```

## What it generates

- A new `apps/<your-app>/` with:
  - `src/server.ts` (Express/Hono/Fastify A2A endpoint)
  - `/.well-known/agent.json`
  - `package.json`, `tsconfig.json`, `.env.example`

Note: upstream scaffolds often use `/.well-known/agent-card.json` (see `create-trustless-agent`), but this repo standardizes on `/.well-known/agent.json`.


