#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import prompts from 'prompts';

type ServerKind = 'express' | 'hono' | 'fastify';
type ProjectKind = 'monorepo' | 'standalone';
type ChainChoice = {
  title: string;
  value: number;
  suffix: 'SEPOLIA' | 'BASE_SEPOLIA' | 'OPTIMISM_SEPOLIA';
};

const CHAIN_CHOICES: ChainChoice[] = [
  { title: 'Ethereum Sepolia (11155111)', value: 11155111, suffix: 'SEPOLIA' },
  { title: 'Base Sepolia (84532)', value: 84532, suffix: 'BASE_SEPOLIA' },
  { title: 'Optimism Sepolia (11155420)', value: 11155420, suffix: 'OPTIMISM_SEPOLIA' },
];

const DEFAULT_DISCOVERY_URL = 'https://8004-agent.io';
const DEFAULT_DISCOVERY_API_KEY =
  '9073051bb4bb81de87567794f24caf78f77d7985f79bc1cf6f79c33ce2cafdc3';
const DEFAULT_IDENTITY_REGISTRY_ADDRESS = '0x8004a6090Cd10A7288092483047B097295Fb8847';

function defaultPublicRpcUrl(chainId: number): string {
  // Public/free endpoints (best-effort). Users can override with their own provider.
  if (chainId === 11155111) return 'https://rpc.sepolia.org';
  if (chainId === 84532) return 'https://sepolia.base.org';
  if (chainId === 11155420) return 'https://sepolia.optimism.io';
  return 'https://rpc.sepolia.org';
}

type WizardAnswers = {
  appDirName: string;
  agentName: string;
  description: string;
  chainId: number;
  ensName: string;
  port: number;
  serverKind: ServerKind;
  projectKind: ProjectKind;
  outputBaseDir: string; // absolute
};

type RegistrationAnswers = {
  authMethod: 'privateKey' | 'wallet';
  chainId: number;
  agentUrl?: string;
  agentAccount?: string;
  agentCategory?: string;
  imageUrl?: string;
  supportedTrust: Array<'reputation' | 'crypto-economic' | 'tee-attestation'>;
  enableMcp: boolean;
  enableX402: boolean;
  privateKey?: string;
  discoveryUrl: string;
  discoveryApiKey?: string;
  rpcUrl?: string;
  identityRegistry?: string;
  pinataJwt?: string;
  registerNow: boolean;
  adminUrl?: string;
};

function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeAgentLabel(input: string): string {
  const trimmed = (input || '').trim().toLowerCase();
  // Allow user to paste full ENS like foo.8004-agent.eth; extract leftmost label.
  const withoutEth = trimmed.endsWith('.eth') ? trimmed.slice(0, -'.eth'.length) : trimmed;
  const parts = withoutEth.split('.').filter(Boolean);
  const label = (parts.length > 0 ? parts[0] : trimmed) || '';
  return toSlug(label);
}

function isValidDnsLabel(label: string): boolean {
  // RFC-ish: 1-63 chars, alnum + hyphen, cannot start/end with hyphen.
  if (!label) return false;
  if (label.length > 63) return false;
  if (!/^[a-z0-9-]+$/.test(label)) return false;
  if (label.startsWith('-') || label.endsWith('-')) return false;
  return true;
}

function buildAgentEnsName(label: string): string {
  return `${label}.8004-agent.eth`;
}

function chainSuffixForId(chainId: number): ChainChoice['suffix'] | null {
  return CHAIN_CHOICES.find((c) => c.value === chainId)?.suffix ?? null;
}

function base64url(buf: Buffer) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}

async function runCommand(params: {
  cwd: string;
  command: string;
  args: string[];
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${params.command} ${params.args.join(' ')} exited with code ${code ?? 'null'}`));
    });
  });
}

async function checkEnsAvailability(params: {
  chainId: number;
  ensName: string;
}): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timeoutMs = 6000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch('https://agents-atp.8004-agent.io/api/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        skillId: 'atp.ens.isNameAvailable',
        payload: {
          ensName: params.ensName,
          chainId: params.chainId,
        },
      }),
    }).finally(() => clearTimeout(timer));

    const json = await resp.json().catch(() => null);
    const available = (json as any)?.response?.available;
    return typeof available === 'boolean' ? available : null;
  } catch {
    return null;
  }
}

async function runWalletRegistrationViaAdmin(params: {
  adminUrl: string;
  draft: {
    agentName: string;
    description: string;
    chainId: number;
    agentUrl?: string;
    agentCategory?: string;
    imageUrl?: string;
    supportedTrust?: string[];
    enableMcp?: boolean;
    enableX402?: boolean;
  };
}): Promise<{
  agentId: string;
  txHash: string;
  agentAccount: string;
  ownerAddress: string;
  agentRegistry?: string;
  sessionPackage?: unknown;
}> {
  const agentLabel = normalizeAgentLabel(params.draft.agentName);
  const ensName = buildAgentEnsName(agentLabel);
  const ensAppBase =
    params.draft.chainId === 11155111
      ? 'https://sepolia.app.ens.domains'
      : params.draft.chainId === 84532
        ? 'https://sepolia.app.ens.domains'
        : params.draft.chainId === 11155420
          ? 'https://sepolia-optimism.app.ens.domains'
          : 'https://app.ens.domains';
  const ensUrl = `${ensAppBase}/${encodeURIComponent(ensName)}`;
  const agenticTrustUrl = `https://8004-agent.io/?q=${encodeURIComponent(ensName)}`;

  const state = base64url(randomBytes(16));
  const { verifier, challenge } = pkce();

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('No server address');
  const redirectUri = `http://127.0.0.1:${addr.port}/callback`;

  const done = new Promise<{ code: string }>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for browser callback')),
      5 * 60_000,
    );

    server.on('request', (req, res) => {
      try {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        if (!code || returnedState !== state) {
          throw new Error('Invalid callback');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Setup complete</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 32px; background: #0b1220; color: #e5e7eb; }
      .card { max-width: 680px; margin: 0 auto; padding: 24px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0; color: #cbd5e1; line-height: 1.5; }
      code { background: rgba(0,0,0,0.25); padding: 2px 6px; border-radius: 8px; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
      .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 12px; border-radius: 12px; text-decoration: none; font-weight: 600; border: 1px solid rgba(255,255,255,0.16); }
      .btn.primary { background: #16a34a; color: #061016; border-color: rgba(0,0,0,0.0); }
      .btn.secondary { background: rgba(255,255,255,0.06); color: #e5e7eb; }
      .hint { margin-top: 12px; font-size: 13px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Setup complete</h1>
      <p>Your agent registration flow finished. You can close this tab and return to your terminal.</p>
      <p style="margin-top:12px;">Agent ENS name: <code>${ensName}</code></p>

      <div class="actions">
        <a class="btn primary" href="${agenticTrustUrl}" target="_blank" rel="noreferrer">View on AgenticTrust</a>
        <a class="btn secondary" href="${ensUrl}" target="_blank" rel="noreferrer">View in ENS</a>
      </div>

      <p class="hint">If your agent doesn’t show up immediately, give the indexer a minute and refresh.</p>
    </div>
  </body>
</html>`);
        clearTimeout(timeout);
        resolve({ code });
      } catch {
        res.writeHead(400);
        res.end('Bad request');
      } finally {
        server.close();
      }
    });
  });

  const setupUrl = new URL('/cli-setup', params.adminUrl);
  setupUrl.searchParams.set('state', state);
  setupUrl.searchParams.set('code_challenge', challenge);
  setupUrl.searchParams.set('code_challenge_method', 'S256');
  setupUrl.searchParams.set('redirect_uri', redirectUri);
  setupUrl.searchParams.set('agentName', params.draft.agentName);
  setupUrl.searchParams.set('description', params.draft.description);
  setupUrl.searchParams.set('chainId', String(params.draft.chainId));
  if (params.draft.agentUrl) setupUrl.searchParams.set('agentUrl', params.draft.agentUrl);
  if (params.draft.agentCategory) setupUrl.searchParams.set('agentCategory', params.draft.agentCategory);
  if (params.draft.imageUrl) setupUrl.searchParams.set('imageUrl', params.draft.imageUrl);
  if (params.draft.supportedTrust?.length) {
    setupUrl.searchParams.set('supportedTrust', params.draft.supportedTrust.join(','));
  }
  if (params.draft.enableMcp) setupUrl.searchParams.set('enableMcp', 'true');
  if (params.draft.enableX402) setupUrl.searchParams.set('enableX402', 'true');

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('[ERC-8004] Opening admin UI to connect wallet and register…');
  // eslint-disable-next-line no-console
  console.log(`If it doesn't open, paste this into your browser:\n${setupUrl.toString()}\n`);
  await openInBrowser(setupUrl.toString());

  const { code } = await done;

  const exchangeUrl = new URL('/api/cli/exchange', params.adminUrl);
  const exchangeRes = await fetch(exchangeUrl.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!exchangeRes.ok) {
    const err: any = await exchangeRes.json().catch(() => ({} as any));
    throw new Error(err?.error || err?.message || `Exchange failed (${exchangeRes.status})`);
  }
  const data = (await exchangeRes.json()) as any;
  const result = data?.result ?? data;
  return {
    agentId: String(result?.agentId ?? ''),
    txHash: String(result?.txHash ?? ''),
    agentAccount: String(result?.agentAccount ?? ''),
    ownerAddress: String(result?.ownerAddress ?? ''),
    agentRegistry: typeof result?.agentRegistry === 'string' ? result.agentRegistry : undefined,
    sessionPackage: (result as any)?.sessionPackage,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeFileIfMissing(filePath: string, contents: string) {
  if (await pathExists(filePath)) return;
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents, 'utf8');
}

async function writeFileOverwrite(filePath: string, contents: string) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents, 'utf8');
}

async function findRepoRoot(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  for (;;) {
    const appsDir = path.join(current, 'apps');
    const workspaceFile = path.join(current, 'pnpm-workspace.yaml');
    if ((await pathExists(workspaceFile)) && (await pathExists(appsDir))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function readJsonFile(filePath: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function detectProjectKind(rootDir: string): Promise<ProjectKind> {
  const pnpmWorkspace = path.join(rootDir, 'pnpm-workspace.yaml');
  if (await pathExists(pnpmWorkspace)) return 'monorepo';
  const pkg = await readJsonFile(path.join(rootDir, 'package.json'));
  if (pkg && (pkg.workspaces || (pkg.pnpm && pkg.pnpm.packages))) return 'monorepo';
  return 'standalone';
}

function recommendOutputBaseDir(params: {
  projectKind: ProjectKind;
  rootDir: string;
}): string {
  if (params.projectKind === 'monorepo') {
    return path.join(params.rootDir, 'apps');
  }
  return params.rootDir;
}

function readArgValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (!next || next.startsWith('-')) return undefined;
  return next;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
create-8004-agent

Usage:
  create-8004-agent [--repo-root <path>]

Options:
  --repo-root <path>   Base directory to inspect (repo root). Used for monorepo *or* standalone.
  -h, --help           Show this help

Env:
  CREATE_AGENTIC_TRUST_REPO_ROOT  Same as --repo-root
  CREATE_AGENTIC_TRUST_ADMIN_URL  Admin app base URL for wallet registration (default: https://agentictrust.io in prod, http://localhost:3002 otherwise)
`);
}

function templatePackageJson(opts: {
  appName: string;
  projectKind: ProjectKind;
  serverKind: ServerKind;
}): string {
  const deps: Record<string, string> = {
    dotenv: '^16.4.5',
  };
  const devDeps: Record<string, string> = {
    '@types/node': '^20.0.0',
    tsx: '^4.7.0',
    typescript: '^5.3.0',
  };

  if (opts.projectKind === 'monorepo') {
    deps['@agentic-trust/core'] = 'workspace:*';
  }

  if (opts.serverKind === 'express') {
    deps.express = '^4.18.2';
    deps.cors = '^2.8.5';
    devDeps['@types/express'] = '^4.17.21';
    devDeps['@types/cors'] = '^2.8.17';
  } else if (opts.serverKind === 'hono') {
    deps.hono = '^4.0.0';
    deps['@hono/node-server'] = '^1.13.0';
  } else if (opts.serverKind === 'fastify') {
    deps.fastify = '^4.0.0';
  }

  return JSON.stringify(
    {
      name: `@agentic-trust/${opts.appName}`,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'tsx watch src/server.ts',
        build: 'tsc',
        start: 'node dist/server.js',
        'type-check': 'tsc --noEmit',
      },
      dependencies: deps,
      devDependencies: devDeps,
    },
    null,
    2,
  );
}

function templateTsConfig(opts: { projectKind: ProjectKind }): string {
  return JSON.stringify(
    {
      extends: opts.projectKind === 'monorepo' ? '../../tsconfig.json' : undefined,
      compilerOptions: {
        outDir: './dist',
        rootDir: './src',
        composite: true,
        // Standalone needs explicit module settings if there's no shared root tsconfig.
        ...(opts.projectKind === 'standalone'
          ? {
              target: 'ES2022',
              lib: ['ES2022'],
              module: 'ESNext',
              moduleResolution: 'bundler',
              resolveJsonModule: true,
              esModuleInterop: true,
              skipLibCheck: true,
            }
          : {}),
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  );
}

function templateEnvExample(): string {
  return `# Optional: override the server port
PORT=3005
`;
}

function templateEnvExampleProviderHints(): string {
  return `# Required for AgenticTrustClient (provider-style)
AGENTIC_TRUST_DISCOVERY_URL=${DEFAULT_DISCOVERY_URL}
AGENTIC_TRUST_DISCOVERY_API_KEY=${DEFAULT_DISCOVERY_API_KEY}
AGENTIC_TRUST_ADMIN_PRIVATE_KEY=

# Chain-specific config (fill the one you use)
AGENTIC_TRUST_RPC_URL_SEPOLIA=
AGENTIC_TRUST_BUNDLER_URL_SEPOLIA=
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=${DEFAULT_IDENTITY_REGISTRY_ADDRESS}
AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA=
AGENTIC_TRUST_ENS_REGISTRY_SEPOLIA=

AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA=
AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA=
AGENTIC_TRUST_IDENTITY_REGISTRY_BASE_SEPOLIA=${DEFAULT_IDENTITY_REGISTRY_ADDRESS}
AGENTIC_TRUST_REPUTATION_REGISTRY_BASE_SEPOLIA=
AGENTIC_TRUST_ENS_REGISTRY_BASE_SEPOLIA=

AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA=
AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA=
AGENTIC_TRUST_IDENTITY_REGISTRY_OPTIMISM_SEPOLIA=${DEFAULT_IDENTITY_REGISTRY_ADDRESS}
AGENTIC_TRUST_REPUTATION_REGISTRY_OPTIMISM_SEPOLIA=
AGENTIC_TRUST_ENS_REGISTRY_OPTIMISM_SEPOLIA=

# Optional (IPFS uploads)
PINATA_JWT=
`;
}

function templateGitignore(): string {
  return `node_modules
dist
.env
.env.*
*.secret
secret.sessionpackage.json
`;
}

function templateAgentJson(opts: { agentName: string; description: string; port: number }): string {
  return JSON.stringify(
    {
      name: opts.agentName,
      description: opts.description,
      endpoints: [
        { name: 'A2A', endpoint: `http://localhost:${opts.port}/api/a2a`, version: '0.1.0' },
      ],
      skills: [
        {
          id: 'demo.echo',
          name: 'Echo',
          description: 'Echoes input back. Useful for wiring and testing.',
        },
      ],
    },
    null,
    2,
  );
}

function templateExpressServerTs(opts: { port: number }): string {
  return `import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/.well-known/agent.json', (_req, res) => {
  // Served from disk so you can edit it without touching code.
  res.sendFile(fileURLToPath(new URL('../.well-known/agent.json', import.meta.url)));
});

app.post('/api/a2a', async (req, res) => {
  const body = (req.body ?? {}) as any;
  const skillId = typeof body.skillId === 'string' ? body.skillId : '';

  if (!skillId) {
    return res.status(400).json({ success: false, error: 'skillId is required' });
  }

  if (skillId === 'demo.echo') {
    return res.json({
      success: true,
      skillId,
      output: {
        echoed: body.payload ?? null,
        metadata: body.metadata ?? null,
      },
    });
  }

  return res.status(404).json({
    success: false,
    error: 'Skill not implemented',
    skillId,
  });
});

const port = Number(process.env.PORT || ${opts.port});
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(\`[agent] listening on http://localhost:\${port}\`);
});
`;
}

function templateHonoServerTs(opts: { port: number }): string {
  return `import dotenv from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

dotenv.config();

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

app.get('/.well-known/agent.json', async (c) => {
  // Served from disk so you can edit it without touching code.
  const url = new URL('../.well-known/agent.json', import.meta.url);
  const file = await fetch(url).then((r) => r.text());
  return c.text(file, 200, { 'content-type': 'application/json' });
});

app.post('/api/a2a', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const skillId = typeof body.skillId === 'string' ? body.skillId : '';
  if (!skillId) {
    return c.json({ success: false, error: 'skillId is required' }, 400);
  }
  if (skillId === 'demo.echo') {
    return c.json({
      success: true,
      skillId,
      output: { echoed: body.payload ?? null, metadata: body.metadata ?? null },
    });
  }
  return c.json({ success: false, error: 'Skill not implemented', skillId }, 404);
});

const port = Number(process.env.PORT || ${opts.port});
serve({ fetch: app.fetch, port }, () => {
  // eslint-disable-next-line no-console
  console.log(\`[agent] listening on http://localhost:\${port}\`);
});
`;
}

function templateFastifyServerTs(opts: { port: number }): string {
  return `import dotenv from 'dotenv';
import Fastify from 'fastify';

dotenv.config();

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true }));

app.get('/.well-known/agent.json', async (_req, reply) => {
  const url = new URL('../.well-known/agent.json', import.meta.url);
  const text = await fetch(url).then((r) => r.text());
  reply.header('content-type', 'application/json');
  return text;
});

app.post('/api/a2a', async (req, reply) => {
  const body = (req.body ?? {}) as any;
  const skillId = typeof body.skillId === 'string' ? body.skillId : '';
  if (!skillId) {
    reply.code(400);
    return { success: false, error: 'skillId is required' };
  }
  if (skillId === 'demo.echo') {
    return {
      success: true,
      skillId,
      output: { echoed: body.payload ?? null, metadata: body.metadata ?? null },
    };
  }
  reply.code(404);
  return { success: false, error: 'Skill not implemented', skillId };
});

const port = Number(process.env.PORT || ${opts.port});
app.listen({ port, host: '0.0.0.0' }).then(() => {
  // eslint-disable-next-line no-console
  console.log(\`[agent] listening on http://localhost:\${port}\`);
});
`;
}

function templateServerTs(opts: { port: number; serverKind: ServerKind }): string {
  if (opts.serverKind === 'hono') return templateHonoServerTs({ port: opts.port });
  if (opts.serverKind === 'fastify') return templateFastifyServerTs({ port: opts.port });
  return templateExpressServerTs({ port: opts.port });
}

function templateRegistrationJson(opts: {
  agentName: string;
  description: string;
  imageUrl?: string;
  agentUrl?: string;
  agentCategory?: string;
  supportedTrust: string[];
  enableMcp: boolean;
  enableX402: boolean;
  chainId: number;
}): string {
  const baseUrl = (opts.agentUrl || '').trim().replace(/\/$/, '');
  const endpoints: Array<{ name: string; endpoint: string; version?: string }> = [];
  if (baseUrl) {
    endpoints.push({ name: 'A2A', endpoint: `${baseUrl}/api/a2a`, version: '0.3.0' });
    if (opts.enableMcp) {
      endpoints.push({ name: 'MCP', endpoint: `${baseUrl}/api/mcp`, version: '2025-06-18' });
    }
  }

  return JSON.stringify(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: opts.agentName,
      description: opts.description,
      image: opts.imageUrl || undefined,
      agentCategory: opts.agentCategory || undefined,
      supportedTrust: opts.supportedTrust.length ? opts.supportedTrust : undefined,
      x402support: opts.enableX402 ? true : undefined,
      endpoints: endpoints.length ? endpoints : undefined,
      registrations: [
        {
          agentId: null,
          agentRegistry: `eip155:${opts.chainId}:<IDENTITY_REGISTRY_ADDRESS>`,
        },
      ],
    },
    null,
    2,
  );
}

function templateRegisterTs(opts: { chainId: number; agentName: string }): string {
  return `import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { AgenticTrustClient, getCounterfactualSmartAccountAddressByAgentName } from '@agentic-trust/core/server';

async function main() {
  const chainId = Number(process.env.AGENTIC_TRUST_CHAIN_ID || ${opts.chainId});
  const agentName = String(process.env.AGENT_NAME || '${opts.agentName}').trim();

  const privateKey = String(process.env.AGENTIC_TRUST_ADMIN_PRIVATE_KEY || '').trim();
  if (!privateKey) {
    throw new Error('AGENTIC_TRUST_ADMIN_PRIVATE_KEY is required');
  }

  const rpcUrl =
    (chainId === 11155111
      ? process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA
      : chainId === 84532
        ? process.env.AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA
        : chainId === 11155420
          ? process.env.AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA
          : undefined) ||
    process.env.AGENTIC_TRUST_RPC_URL ||
    '';
  if (!rpcUrl) {
    throw new Error('RPC URL is required (set AGENTIC_TRUST_RPC_URL_<CHAIN> or AGENTIC_TRUST_RPC_URL)');
  }

  const client = new AgenticTrustClient({ privateKey, chainId, rpcUrl });
  await client.ready;

  const agentAccount =
    (process.env.AGENT_ACCOUNT || '').trim() ||
    (await getCounterfactualSmartAccountAddressByAgentName(agentName, chainId));

  const agentUrl = (process.env.AGENT_URL || '').trim() || undefined;
  const agentCategory = (process.env.AGENT_CATEGORY || '').trim() || undefined;
  const description = (process.env.AGENT_DESCRIPTION || '').trim() || undefined;
  const image = (process.env.AGENT_IMAGE || '').trim() || undefined;

  const supportedTrustRaw = (process.env.SUPPORTED_TRUST || '').trim();
  const supportedTrust = supportedTrustRaw
    ? supportedTrustRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const enableMcp = String(process.env.ENABLE_MCP || 'false').toLowerCase() === 'true';
  const enableX402 = String(process.env.ENABLE_X402 || 'false').toLowerCase() === 'true';

  const endpoints: Array<{ name: string; endpoint: string; version?: string }> = [];
  if (agentUrl) {
    const base = agentUrl.replace(/\\/$/, '');
    endpoints.push({ name: 'A2A', endpoint: \`\${base}/api/a2a\`, version: '0.3.0' });
    if (enableMcp) endpoints.push({ name: 'MCP', endpoint: \`\${base}/api/mcp\`, version: '2025-06-18' });
  }

  const res = await client.agents.createAgentWithEOAOwnerUsingPrivateKey({
    chainId,
    agentName,
    agentAccount: agentAccount as \`0x\${string}\`,
    agentCategory,
    description,
    image,
    agentUrl,
    supportedTrust,
    endpoints: endpoints.length ? endpoints : undefined,
    x402support: enableX402 || undefined,
  } as any);

  // eslint-disable-next-line no-console
  console.log('Registered agent:', res);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
`;
}

function templateEnvLocal(opts: {
  port: number;
  agentName: string;
  description: string;
  chainId: number;
  agentUrl?: string;
  agentAccount?: string;
  agentCategory?: string;
  imageUrl?: string;
  supportedTrust: string[];
  enableMcp: boolean;
  enableX402: boolean;
  privateKey?: string;
  discoveryUrl: string;
  discoveryApiKey?: string;
  pinataJwt?: string;
  rpcUrl?: string;
  identityRegistry?: string;
}): string {
  const chainSuffix = CHAIN_CHOICES.find((c) => c.value === opts.chainId)?.suffix ?? 'SEPOLIA';
  const lines: string[] = [];
  lines.push(`PORT=${opts.port}`);
  lines.push('');
  lines.push(`AGENT_NAME=${opts.agentName}`);
  lines.push(`AGENT_DESCRIPTION=${opts.description}`);
  if (opts.imageUrl) lines.push(`AGENT_IMAGE=${opts.imageUrl}`);
  if (opts.agentUrl) lines.push(`AGENT_URL=${opts.agentUrl.replace(/\/$/, '')}`);
  if (opts.agentAccount) lines.push(`AGENT_ACCOUNT=${opts.agentAccount}`);
  if (opts.agentCategory) lines.push(`AGENT_CATEGORY=${opts.agentCategory}`);
  lines.push(`AGENTIC_TRUST_CHAIN_ID=${opts.chainId}`);
  lines.push(`SUPPORTED_TRUST=${opts.supportedTrust.join(',')}`);
  lines.push(`ENABLE_MCP=${opts.enableMcp ? 'true' : 'false'}`);
  lines.push(`ENABLE_X402=${opts.enableX402 ? 'true' : 'false'}`);
  lines.push('');
  lines.push(`AGENTIC_TRUST_DISCOVERY_URL=${opts.discoveryUrl || DEFAULT_DISCOVERY_URL}`);
  lines.push(`AGENTIC_TRUST_DISCOVERY_API_KEY=${opts.discoveryApiKey || DEFAULT_DISCOVERY_API_KEY}`);
  if (opts.pinataJwt) lines.push(`PINATA_JWT=${opts.pinataJwt}`);
  lines.push('');
  lines.push(`AGENTIC_TRUST_ADMIN_PRIVATE_KEY=${opts.privateKey || ''}`);
  lines.push(`AGENTIC_TRUST_APP_ROLES=admin|provider`);
  lines.push('');
  lines.push(`# Required chain configuration for registration / provider capabilities (${chainSuffix})`);
  lines.push(`AGENTIC_TRUST_RPC_URL_${chainSuffix}=${opts.rpcUrl || ''}`);
  lines.push(`AGENTIC_TRUST_BUNDLER_URL_${chainSuffix}=`);
  lines.push(
    `AGENTIC_TRUST_IDENTITY_REGISTRY_${chainSuffix}=${
      (opts.identityRegistry || '').trim() || DEFAULT_IDENTITY_REGISTRY_ADDRESS
    }`,
  );
  lines.push(`AGENTIC_TRUST_REPUTATION_REGISTRY_${chainSuffix}=`);
  lines.push(`AGENTIC_TRUST_ENS_REGISTRY_${chainSuffix}=`);
  lines.push('');
  return lines.join('\n') + '\n';
}

function templateEnvLocalWallet(opts: {
  port: number;
  agentName: string;
  description: string;
  chainId: number;
  agentUrl?: string;
  agentAccount?: string;
  agentCategory?: string;
  imageUrl?: string;
  supportedTrust: string[];
  enableMcp: boolean;
  enableX402: boolean;
  discoveryUrl: string;
  discoveryApiKey?: string;
  pinataJwt?: string;
}): string {
  const chainSuffix = CHAIN_CHOICES.find((c) => c.value === opts.chainId)?.suffix ?? 'SEPOLIA';
  const lines: string[] = [];
  lines.push(`PORT=${opts.port}`);
  lines.push('');
  lines.push(`AGENT_NAME=${opts.agentName}`);
  lines.push(`AGENT_DESCRIPTION=${opts.description}`);
  if (opts.imageUrl) lines.push(`AGENT_IMAGE=${opts.imageUrl}`);
  if (opts.agentUrl) lines.push(`AGENT_URL=${opts.agentUrl.replace(/\/$/, '')}`);
  if (opts.agentAccount) lines.push(`AGENT_ACCOUNT=${opts.agentAccount}`);
  if (opts.agentCategory) lines.push(`AGENT_CATEGORY=${opts.agentCategory}`);
  lines.push(`AGENTIC_TRUST_CHAIN_ID=${opts.chainId}`);
  lines.push(`SUPPORTED_TRUST=${opts.supportedTrust.join(',')}`);
  lines.push(`ENABLE_MCP=${opts.enableMcp ? 'true' : 'false'}`);
  lines.push(`ENABLE_X402=${opts.enableX402 ? 'true' : 'false'}`);
  lines.push('');
  lines.push(`AGENTIC_TRUST_DISCOVERY_URL=${opts.discoveryUrl || DEFAULT_DISCOVERY_URL}`);
  lines.push(`AGENTIC_TRUST_DISCOVERY_API_KEY=${opts.discoveryApiKey || DEFAULT_DISCOVERY_API_KEY}`);
  if (opts.pinataJwt) lines.push(`PINATA_JWT=${opts.pinataJwt}`);
  lines.push('');
  lines.push('AGENTIC_TRUST_APP_ROLES=provider');
  lines.push('AGENTIC_TRUST_IS_PROVIDER_APP=true');
  lines.push('AGENTIC_TRUST_SESSION_PACKAGE_PATH=./secret.sessionpackage.json');
  lines.push('');
  lines.push(`# Chain configuration for provider capabilities (${chainSuffix})`);
  lines.push(`AGENTIC_TRUST_RPC_URL_${chainSuffix}=`);
  lines.push(`AGENTIC_TRUST_BUNDLER_URL_${chainSuffix}=`);
  lines.push(`AGENTIC_TRUST_IDENTITY_REGISTRY_${chainSuffix}=${DEFAULT_IDENTITY_REGISTRY_ADDRESS}`);
  lines.push(`AGENTIC_TRUST_REPUTATION_REGISTRY_${chainSuffix}=`);
  lines.push(`AGENTIC_TRUST_ENS_REGISTRY_${chainSuffix}=`);
  lines.push('');
  return lines.join('\n') + '\n';
}

function templateAppReadme(opts: {
  agentName: string;
  appDirName: string;
  outputBaseDir: string;
  serverKind: ServerKind;
}): string {
  const rel = path.basename(opts.outputBaseDir);
  return `# ${opts.agentName}

Generated by \`create-8004-agent\`.

## Run

\`\`\`bash
pnpm -C ${rel}/${opts.appDirName} dev
\`\`\`

## Endpoints

- \`GET /health\`
- \`GET /.well-known/agent.json\`
- \`POST /api/a2a\` (skill: \`demo.echo\`)
 
## Server

- ${opts.serverKind}
`;
}

const ensAvailabilityCache = new Map<string, boolean | null>();

async function isExistingProjectConfiguredForRegistration(outDir: string): Promise<boolean> {
  const envPath = path.join(outDir, '.env.local');
  const registrationPath = path.join(outDir, 'registration.json');
  if (!(await pathExists(envPath))) return false;
  if (!(await pathExists(registrationPath))) return false;

  try {
    const envRaw = await fs.readFile(envPath, 'utf8');
    const hasPrivKey = /AGENTIC_TRUST_ADMIN_PRIVATE_KEY=0x[a-fA-F0-9]{64}/.test(envRaw);
    const hasRpc = /AGENTIC_TRUST_RPC_URL_(SEPOLIA|BASE_SEPOLIA|OPTIMISM_SEPOLIA)=/.test(envRaw);
    const hasIdentity = /AGENTIC_TRUST_IDENTITY_REGISTRY_(SEPOLIA|BASE_SEPOLIA|OPTIMISM_SEPOLIA)=0x[a-fA-F0-9]{40}/.test(
      envRaw,
    );
    return hasPrivKey && hasRpc && hasIdentity;
  } catch {
    return false;
  }
}

async function runWizard(params: { rootDir: string; projectKind: ProjectKind }): Promise<WizardAnswers> {
  const defaultBaseDir = recommendOutputBaseDir({ projectKind: params.projectKind, rootDir: params.rootDir });

  const answers = await prompts(
    [
      {
        type: 'select',
        name: 'projectKind',
        message: 'Project type',
        initial: params.projectKind === 'monorepo' ? 0 : 1,
        choices: [
          { title: 'Monorepo app (recommended)', value: 'monorepo' },
          { title: 'Standalone npm project', value: 'standalone' },
        ],
      },
      {
        type: 'select',
        name: 'serverKind',
        message: 'Node server framework',
        initial: 0,
        choices: [
          { title: 'Express', value: 'express' },
          { title: 'Hono', value: 'hono' },
          { title: 'Fastify', value: 'fastify' },
        ],
      },
      {
        type: 'select',
        name: 'chainId',
        message: 'Chain (used for ENS availability check)',
        choices: CHAIN_CHOICES.map((c) => ({ title: c.title, value: c.value })),
        initial: 0,
      },
      {
        type: 'text',
        name: 'agentNameLabel',
        message: (prev: any, values: any) => {
          const chainId = typeof values?.chainId === 'number' ? values.chainId : 11155111;
          const suffix = chainSuffixForId(chainId) ?? 'SEPOLIA';
          return `Agent name (DNS label). This becomes ${'<name>'}.8004-agent.eth on ${suffix}`;
        },
        initial: '',
        validate: async (value: string, values: any) => {
          const label = normalizeAgentLabel(String(value || ''));
          if (!isValidDnsLabel(label)) {
            return 'Use lowercase letters/numbers/hyphen only, 1-63 chars, no leading/trailing hyphen.';
          }
          if (label !== String(value || '').trim().toLowerCase()) {
            return `Try: ${label}`;
          }

          const chainId = typeof values?.chainId === 'number' ? values.chainId : 11155111;
          const ensName = buildAgentEnsName(label);

          const cacheKey = `${chainId}:${ensName}`;
          const available =
            ensAvailabilityCache.has(cacheKey)
              ? (ensAvailabilityCache.get(cacheKey) as boolean | null)
              : await checkEnsAvailability({ chainId, ensName });
          ensAvailabilityCache.set(cacheKey, available);

          if (available === true) {
            // eslint-disable-next-line no-console
            console.log(`[ENS] Name is available: ${ensName}`);
          } else if (available === null) {
            // eslint-disable-next-line no-console
            console.warn(`[ENS] Could not verify availability (timeout). Continuing: ${ensName}`);
          }

          if (available === false) {
            return `ENS name is already taken: ${ensName}`;
          }
          if (available === null) {
            // Can't reliably check (missing ENS registry for L2, network, etc.)—allow but warn later.
            return true;
          }
          return true;
        },
      },
      {
        type: 'text',
        name: 'agentName',
        message: 'Display name (human readable)',
        initial: (prev: any, values: any) => {
          const label = normalizeAgentLabel(String(values?.agentNameLabel || 'my-agent'));
          return label ? label.replace(/-/g, ' ') : 'My Agent';
        },
      },
      {
        type: 'text',
        name: 'description',
        message: 'Description',
        initial: 'A simple Agentic Trust agent.',
      },
      {
        type: 'text',
        name: 'outputBaseDir',
        message: (prev: any, values: any) => {
          const kind = (values?.projectKind ?? params.projectKind) as ProjectKind;
          return kind === 'monorepo'
            ? 'Base output directory (recommended: <repo>/apps)'
            : 'Base output directory';
        },
        initial: defaultBaseDir,
        validate: async (value: string) => {
          const resolved = path.resolve(value);
          if (!(await pathExists(resolved))) return `Directory not found: ${resolved}`;
          return true;
        },
      },
      {
        type: 'number',
        name: 'port',
        message: 'Local dev port',
        initial: 3005,
        min: 1,
        max: 65535,
      },
    ],
    {
      onCancel: () => {
        throw new Error('Cancelled');
      },
    },
  );

  const chainId = typeof answers.chainId === 'number' ? answers.chainId : 11155111;
  const label = normalizeAgentLabel(String(answers.agentNameLabel || 'my-agent'));
  const ensName = buildAgentEnsName(label);
  const appDirName = label; // enforce: path == agent label

  const agentName = String(answers.agentName ?? label).trim();
  const description = String(answers.description ?? '').trim();
  const port = typeof answers.port === 'number' && Number.isFinite(answers.port) ? answers.port : 3005;
  const projectKind = (answers.projectKind ?? params.projectKind) as ProjectKind;
  const serverKind = (answers.serverKind ?? 'express') as ServerKind;
  const outputBaseDir = path.resolve(String(answers.outputBaseDir ?? defaultBaseDir));

  // Best-effort warning if ENS check couldn't run.
  const availability = await checkEnsAvailability({ chainId, ensName });
  if (availability === null) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ENS] Could not verify availability for ${ensName} on chain ${chainId}. Continuing anyway.`,
    );
  }

  return { appDirName, agentName, description, chainId, ensName, port, projectKind, serverKind, outputBaseDir };
}

async function runRegistrationWizard(params: {
  defaultAgentName: string;
  defaultDescription: string;
}): Promise<RegistrationAnswers | null> {
  const defaultDiscoveryUrl = process.env.AGENTIC_TRUST_DISCOVERY_URL || DEFAULT_DISCOVERY_URL;
  const defaultDiscoveryApiKey =
    process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || DEFAULT_DISCOVERY_API_KEY;
  const fallbackAdminUrl =
    String(process.env.NODE_ENV || '').toLowerCase() === 'production'
      ? 'https://agentictrust.io'
      : 'http://localhost:3002';
  const defaultAdminUrl =
    String(process.env.CREATE_AGENTIC_TRUST_ADMIN_URL || '').trim() || fallbackAdminUrl;
  const defaultEnableX402 =
    String(process.env.CREATE_AGENTIC_TRUST_ENABLE_X402 || '').trim().toLowerCase() === 'true';

  const answers = await prompts(
    [
      {
        type: 'confirm',
        name: 'continue',
        message: 'Continue with ERC-8004 registration setup now?',
        initial: false,
      },
      {
        type: (prev: any) => (prev ? 'select' : null),
        name: 'chainId',
        message: 'Chain',
        choices: CHAIN_CHOICES.map((c) => ({ title: c.title, value: c.value })),
        initial: 0,
      },
      {
        type: (prev: any, values: any) => (values?.continue ? 'text' : null),
        name: 'agentUrl',
        message: 'Agent base URL (used to form A2A/MCP endpoints)',
        initial: 'http://localhost:3005',
      },
      {
        type: (prev: any, values: any) => (values?.continue ? 'confirm' : null),
        name: 'enableMcp',
        message: 'Enable MCP endpoint in registration?',
        initial: false,
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'enableX402',
        message: 'Enable x402 payment support flag in registration?',
        initial: defaultEnableX402,
      },
      {
        type: (prev: any, values: any) => (values?.continue ? 'text' : null),
        name: 'imageUrl',
        message: 'Image URL (optional)',
        initial: '',
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'privateKey',
        message: 'Admin private key (AGENTIC_TRUST_ADMIN_PRIVATE_KEY)',
        validate: (value: string) => {
          const v = String(value || '').trim();
          if (!v) return 'Required';
          if (!v.startsWith('0x') || v.length < 66) return 'Expected a 0x-prefixed hex private key';
          return true;
        },
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'agentAccount',
        message: 'Agent account address (optional; leave blank to use counterfactual AA by agent name)',
        initial: '',
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'discoveryUrl',
        message: 'Discovery URL (AGENTIC_TRUST_DISCOVERY_URL)',
        initial: defaultDiscoveryUrl,
        validate: (value: string) => (String(value || '').trim() ? true : 'Required'),
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'discoveryApiKey',
        message: 'Discovery API key (AGENTIC_TRUST_DISCOVERY_API_KEY) (optional)',
        initial: defaultDiscoveryApiKey,
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'rpcUrl',
        message: 'Chain RPC URL (AGENTIC_TRUST_RPC_URL_<CHAIN>)',
        initial: (prev: any, values: any) => {
          const chainId = typeof values?.chainId === 'number' ? values.chainId : 11155111;
          return defaultPublicRpcUrl(chainId);
        },
        validate: (value: string) => (String(value || '').trim() ? true : 'Required to register on-chain'),
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'identityRegistry',
        message: 'Identity Registry address (AGENTIC_TRUST_IDENTITY_REGISTRY_<CHAIN>)',
        initial: DEFAULT_IDENTITY_REGISTRY_ADDRESS,
        validate: (value: string) => {
          const v = String(value || '').trim();
          if (!v) return 'Required to register on-chain';
          if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return 'Expected 0x + 40 hex chars';
          return true;
        },
      },
      {
        type: (prev: any, values: any) =>
          null,
        name: 'pinataJwt',
        message: 'Pinata JWT (PINATA_JWT) (optional, for IPFS uploads)',
      },
      {
        type: (prev: any, values: any) => (values?.continue ? 'confirm' : null),
        name: 'registerNow',
        message: 'Open admin UI to register now?',
        initial: true,
      },
    ],
    {
      onCancel: () => {
        throw new Error('Cancelled');
      },
    },
  );

  if (!answers.continue) {
    return null;
  }

  const chainId = typeof answers.chainId === 'number' ? answers.chainId : 11155111;
  const supportedTrust: Array<'reputation' | 'crypto-economic' | 'tee-attestation'> = [];
  // Wallet flow is the default (no prompt).
  const authMethod: RegistrationAnswers['authMethod'] = 'wallet';
  return {
    authMethod,
    chainId,
    agentUrl: String(answers.agentUrl || '').trim() || undefined,
    agentAccount: undefined,
    agentCategory: undefined,
    imageUrl: String(answers.imageUrl || '').trim() || undefined,
    supportedTrust,
    enableMcp: Boolean(answers.enableMcp),
    enableX402: defaultEnableX402,
    privateKey: undefined,
    discoveryUrl: defaultDiscoveryUrl,
    discoveryApiKey: defaultDiscoveryApiKey,
    rpcUrl: String(answers.rpcUrl || '').trim() || undefined,
    identityRegistry: String(answers.identityRegistry || '').trim() || undefined,
    pinataJwt: undefined,
    registerNow: Boolean(answers.registerNow),
    adminUrl: authMethod === 'wallet' ? defaultAdminUrl : undefined,
  };
}

async function performOnChainRegistration(params: {
  outDir: string;
  reg: RegistrationAnswers;
  agentName: string;
  description: string;
}): Promise<{ agentId: string; txHash: string; agentAccount: string }> {
  const { outDir, reg } = params;
  if (reg.authMethod !== 'privateKey') {
    throw new Error('performOnChainRegistration requires authMethod=privateKey');
  }
  if (!reg.privateKey) {
    throw new Error('AGENTIC_TRUST_ADMIN_PRIVATE_KEY is required');
  }
  if (!reg.rpcUrl) {
    throw new Error('RPC URL is required (set AGENTIC_TRUST_RPC_URL_<CHAIN> or AGENTIC_TRUST_RPC_URL)');
  }
  if (!reg.identityRegistry) {
    throw new Error('Identity Registry address is required');
  }
  const chainSuffix = CHAIN_CHOICES.find((c) => c.value === reg.chainId)?.suffix ?? 'SEPOLIA';

  // Temporarily set env vars so @agentic-trust/core/server picks them up.
  const previousEnv: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    previousEnv[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  try {
    setEnv('AGENTIC_TRUST_DISCOVERY_URL', reg.discoveryUrl || DEFAULT_DISCOVERY_URL);
    setEnv('AGENTIC_TRUST_DISCOVERY_API_KEY', reg.discoveryApiKey || DEFAULT_DISCOVERY_API_KEY);
    setEnv('AGENTIC_TRUST_ADMIN_PRIVATE_KEY', reg.privateKey);
    setEnv('AGENTIC_TRUST_APP_ROLES', 'admin|provider');
    if (reg.pinataJwt) {
      setEnv('PINATA_JWT', reg.pinataJwt);
    }

    setEnv(`AGENTIC_TRUST_RPC_URL_${chainSuffix}`, reg.rpcUrl);
    setEnv(`AGENTIC_TRUST_IDENTITY_REGISTRY_${chainSuffix}`, reg.identityRegistry);

    // Use a non-literal dynamic import so TypeScript doesn't try to follow monorepo path mappings
    // (which would pull workspace source files into this package's TS program).
    const moduleName: string = '@agentic-trust/core/server';
    const core = await import(moduleName);
    const AgenticTrustClient = (core as any).AgenticTrustClient as any;
    const getCounterfactualSmartAccountAddressByAgentName = (core as any)
      .getCounterfactualSmartAccountAddressByAgentName as (agentName: string, chainId: number) => Promise<string>;

    const agentAccount =
      (reg.agentAccount || '').trim() ||
      (await getCounterfactualSmartAccountAddressByAgentName(params.agentName, reg.chainId));

    const endpoints: Array<{ name: string; endpoint: string; version?: string }> = [];
    if (reg.agentUrl) {
      const base = reg.agentUrl.replace(/\/$/, '');
      endpoints.push({ name: 'A2A', endpoint: `${base}/api/a2a`, version: '0.3.0' });
      if (reg.enableMcp) {
        endpoints.push({ name: 'MCP', endpoint: `${base}/api/mcp`, version: '2025-06-18' });
      }
    }

    const identityRegistryHex = reg.identityRegistry.startsWith('0x')
      ? reg.identityRegistry
      : `0x${reg.identityRegistry}`;

    const client = new AgenticTrustClient({
      privateKey: reg.privateKey,
      chainId: reg.chainId,
      rpcUrl: reg.rpcUrl,
      discoveryUrl: reg.discoveryUrl,
      discoveryApiKey: reg.discoveryApiKey,
      identityRegistry: identityRegistryHex,
    });
    await client.ready;

    const result = await client.agents.createAgentWithEOAOwnerUsingPrivateKey({
      chainId: reg.chainId,
      agentName: params.agentName,
      agentAccount: agentAccount as `0x${string}`,
      agentCategory: reg.agentCategory,
      description: params.description,
      image: reg.imageUrl,
      agentUrl: reg.agentUrl,
      supportedTrust: reg.supportedTrust.length ? reg.supportedTrust : undefined,
      endpoints: endpoints.length ? endpoints : undefined,
    });

    const agentId = result?.agentId?.toString?.() ?? String(result?.agentId ?? '');
    const txHash = String(result?.txHash ?? '');

    // Persist a local result file for convenience.
    await writeFileOverwrite(
      path.join(outDir, 'registration-result.json'),
      JSON.stringify({ chainId: reg.chainId, agentId, txHash, agentAccount }, null, 2) + '\n',
    );

    // Best-effort: update registration.json with real agentId and agentRegistry.
    const registrationPath = path.join(outDir, 'registration.json');
    const existing = await readJsonFile(registrationPath);
    if (existing && typeof existing === 'object') {
      existing.registrations = Array.isArray(existing.registrations) ? existing.registrations : [];
      if (existing.registrations.length === 0) {
        existing.registrations.push({
          agentId: null,
          agentRegistry: `eip155:${reg.chainId}:${identityRegistryHex}`,
        });
      }
      existing.registrations[0] = {
        ...(existing.registrations[0] || {}),
        agentId: agentId ? Number(agentId) : existing.registrations[0]?.agentId ?? null,
        agentRegistry: `eip155:${reg.chainId}:${identityRegistryHex}`,
      };
      await writeFileOverwrite(registrationPath, JSON.stringify(existing, null, 2) + '\n');
    }

    return { agentId, txHash, agentAccount };
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const repoRootFlag = readArgValue(argv, '--repo-root');
  const repoRootEnv = process.env.CREATE_AGENTIC_TRUST_REPO_ROOT;
  const rootCandidate = repoRootFlag ?? repoRootEnv ?? cwd;

  const root = repoRootFlag || repoRootEnv
    ? path.resolve(rootCandidate)
    : await findRepoRoot(rootCandidate);

  if (!root) {
    throw new Error(
      `Expected to run somewhere inside the monorepo (could not find pnpm-workspace.yaml + apps/ from ${cwd}).`,
    );
  }

  const detectedKind = await detectProjectKind(root);
  const answers = await runWizard({ rootDir: root, projectKind: detectedKind });
  const outDir = path.join(answers.outputBaseDir, answers.appDirName);

  if (await pathExists(outDir)) {
    const alreadyConfigured = await isExistingProjectConfiguredForRegistration(outDir);
    if (alreadyConfigured) {
      // eslint-disable-next-line no-console
      console.log(`[Wizard] Existing project detected and configured. Jumping to registration: ${outDir}`);
    }

    const choice = await prompts(
      {
        type: 'select',
        name: 'action',
        message: `Directory already exists: ${outDir}. What do you want to do?`,
        choices: [
          ...(alreadyConfigured
            ? [{ title: 'Continue to ERC-8004 registration (configured)', value: 'continue' }]
            : [{ title: 'Continue with ERC-8004 registration setup (no overwrite)', value: 'continue' }]),
          { title: 'Overwrite (delete and recreate project)', value: 'overwrite' },
          { title: 'Stop', value: 'stop' },
        ],
        initial: 0,
      },
      {
        onCancel: () => {
          throw new Error('Cancelled');
        },
      },
    );

    if (choice.action === 'stop') {
      return;
    }

    if (choice.action === 'overwrite') {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  }

  const outDirExistsNow = await pathExists(outDir);
  if (!outDirExistsNow) {
    await ensureDir(outDir);

    await writeFileIfMissing(
      path.join(outDir, 'package.json'),
      templatePackageJson({
        appName: answers.appDirName,
        projectKind: answers.projectKind,
        serverKind: answers.serverKind,
      }),
    );
    await writeFileIfMissing(
      path.join(outDir, 'tsconfig.json'),
      templateTsConfig({ projectKind: answers.projectKind }),
    );
    await writeFileIfMissing(path.join(outDir, '.env.example'), templateEnvExample());
    await writeFileIfMissing(path.join(outDir, '.env.provider.example'), templateEnvExampleProviderHints());
    await writeFileIfMissing(path.join(outDir, '.gitignore'), templateGitignore());
    await writeFileIfMissing(
      path.join(outDir, 'README.md'),
      templateAppReadme({
        agentName: answers.agentName,
        appDirName: answers.appDirName,
        outputBaseDir: answers.outputBaseDir,
        serverKind: answers.serverKind,
      }),
    );
    await writeFileIfMissing(
      path.join(outDir, '.well-known', 'agent.json'),
      templateAgentJson({ agentName: answers.agentName, description: answers.description, port: answers.port }),
    );
    await writeFileIfMissing(
      path.join(outDir, 'src', 'server.ts'),
      templateServerTs({ port: answers.port, serverKind: answers.serverKind }),
    );
  }

  const reg = await runRegistrationWizard({
    defaultAgentName: answers.agentName,
    defaultDescription: answers.description,
  });

  if (reg) {
    const isPrivateKeyRegistration = reg.authMethod === 'privateKey';
    const isWalletRegistration = reg.authMethod === 'wallet';

    // Only generate a local register script for private-key flows.
    if (isPrivateKeyRegistration && answers.projectKind === 'monorepo') {
      const packageJsonPath = path.join(outDir, 'package.json');
      const pkg = (await readJsonFile(packageJsonPath)) ?? {};
      pkg.scripts = pkg.scripts ?? {};
      if (!pkg.scripts.register) {
        pkg.scripts.register = 'tsx src/register.ts';
        await writeFileOverwrite(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
      }
    }

    await writeFileIfMissing(
      path.join(outDir, 'registration.json'),
      templateRegistrationJson({
        agentName: answers.agentName,
        description: answers.description,
        imageUrl: reg.imageUrl,
        agentUrl: reg.agentUrl,
        agentCategory: reg.agentCategory,
        supportedTrust: reg.supportedTrust,
        enableMcp: reg.enableMcp,
        enableX402: reg.enableX402,
        chainId: reg.chainId,
      }),
    );

    if (isPrivateKeyRegistration && answers.projectKind === 'monorepo') {
      await writeFileIfMissing(
        path.join(outDir, 'src', 'register.ts'),
        templateRegisterTs({ chainId: reg.chainId, agentName: answers.agentName }),
      );
    }

    // Wallet flow: write env without private key; we will overwrite after registration
    // to include AGENT_ACCOUNT if we get it back from the admin UI.
    await writeFileOverwrite(
      path.join(outDir, '.env.local'),
      isWalletRegistration
        ? templateEnvLocalWallet({
            port: answers.port,
            agentName: answers.agentName,
            description: answers.description,
            chainId: reg.chainId,
            agentUrl: reg.agentUrl,
            agentAccount: reg.agentAccount,
            agentCategory: reg.agentCategory,
            imageUrl: reg.imageUrl,
            supportedTrust: reg.supportedTrust,
            enableMcp: reg.enableMcp,
            enableX402: reg.enableX402,
            discoveryUrl: reg.discoveryUrl,
            discoveryApiKey: reg.discoveryApiKey,
            pinataJwt: reg.pinataJwt,
          })
        : templateEnvLocal({
            port: answers.port,
            agentName: answers.agentName,
            description: answers.description,
            chainId: reg.chainId,
            agentUrl: reg.agentUrl,
            agentAccount: reg.agentAccount,
            agentCategory: reg.agentCategory,
            imageUrl: reg.imageUrl,
            supportedTrust: reg.supportedTrust,
            enableMcp: reg.enableMcp,
            enableX402: reg.enableX402,
            privateKey: reg.privateKey,
            discoveryUrl: reg.discoveryUrl,
            discoveryApiKey: reg.discoveryApiKey,
            pinataJwt: reg.pinataJwt,
            rpcUrl: reg.rpcUrl,
            identityRegistry: reg.identityRegistry,
          }),
    );

    if (reg.registerNow) {
      if (isWalletRegistration) {
        if (!reg.adminUrl) {
          throw new Error('Admin URL is required for wallet registration');
        }
        const walletResult = await runWalletRegistrationViaAdmin({
          adminUrl: reg.adminUrl,
          draft: {
            agentName: answers.agentName,
            description: answers.description,
            chainId: reg.chainId,
            agentUrl: reg.agentUrl,
            agentCategory: reg.agentCategory,
            imageUrl: reg.imageUrl,
            supportedTrust: reg.supportedTrust,
            enableMcp: reg.enableMcp,
            enableX402: reg.enableX402,
          },
        });

        // Persist session package for provider app usage.
        if (!walletResult.sessionPackage) {
          throw new Error(
            'Wallet registration completed but sessionPackage was not returned from the admin flow.',
          );
        }
        const sessionPackagePath = path.join(outDir, 'secret.sessionpackage.json');
        await writeFileOverwrite(
          sessionPackagePath,
          JSON.stringify(walletResult.sessionPackage, null, 2) + '\n',
        );
        // eslint-disable-next-line no-console
        console.log(`[ERC-8004] Wrote session package: ${sessionPackagePath}`);

        await writeFileOverwrite(
          path.join(outDir, 'registration-result.json'),
          JSON.stringify(
            {
              chainId: reg.chainId,
              agentId: walletResult.agentId,
              txHash: walletResult.txHash,
              agentAccount: walletResult.agentAccount,
              ownerAddress: walletResult.ownerAddress,
              agentRegistry: walletResult.agentRegistry,
            },
            null,
            2,
          ) + '\n',
        );

        // Update registration.json with agentId + agentRegistry (if provided)
        const registrationPath = path.join(outDir, 'registration.json');
        const existing = await readJsonFile(registrationPath);
        if (existing && typeof existing === 'object') {
          (existing as any).registrations = Array.isArray((existing as any).registrations)
            ? (existing as any).registrations
            : [];
          if ((existing as any).registrations.length === 0) {
            (existing as any).registrations.push({
              agentId: null,
              agentRegistry: walletResult.agentRegistry ?? `eip155:${reg.chainId}:<IDENTITY_REGISTRY_ADDRESS>`,
            });
          }
          (existing as any).registrations[0] = {
            ...((existing as any).registrations[0] || {}),
            agentId: walletResult.agentId ? Number(walletResult.agentId) : (existing as any).registrations[0]?.agentId ?? null,
            agentRegistry:
              walletResult.agentRegistry ??
              (existing as any).registrations[0]?.agentRegistry ??
              `eip155:${reg.chainId}:<IDENTITY_REGISTRY_ADDRESS>`,
          };
          await writeFileOverwrite(registrationPath, JSON.stringify(existing, null, 2) + '\n');
        }

        // Re-write env with AGENT_ACCOUNT filled in from actual registered value.
        await writeFileOverwrite(
          path.join(outDir, '.env.local'),
          templateEnvLocalWallet({
            port: answers.port,
            agentName: answers.agentName,
            description: answers.description,
            chainId: reg.chainId,
            agentUrl: reg.agentUrl,
            agentAccount: walletResult.agentAccount,
            agentCategory: reg.agentCategory,
            imageUrl: reg.imageUrl,
            supportedTrust: reg.supportedTrust,
            enableMcp: reg.enableMcp,
            enableX402: reg.enableX402,
            discoveryUrl: reg.discoveryUrl,
            discoveryApiKey: reg.discoveryApiKey,
            pinataJwt: reg.pinataJwt,
          }),
        );

        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log(`[ERC-8004] Registered agentId=${walletResult.agentId} txHash=${walletResult.txHash}`);
      } else {
        const result = await performOnChainRegistration({
          outDir,
          reg,
          agentName: answers.agentName,
          description: answers.description,
        });
        // eslint-disable-next-line no-console
        console.log('');
        // eslint-disable-next-line no-console
        console.log(`[ERC-8004] Registered agentId=${result.agentId} txHash=${result.txHash}`);
      }
    }

    if (isPrivateKeyRegistration && answers.projectKind !== 'monorepo') {
      // eslint-disable-next-line no-console
      console.log(
        '[ERC-8004] Note: this project was generated as standalone, so `src/register.ts` was not created. ' +
          'Registration can be done during the wizard (recommended) or by generating as a monorepo app.',
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Created ${outDir}`);

  // Automatically install + run.
  // - monorepo: install at repo root, run dev at app dir
  // - standalone: install+dev at app dir
  const installCwd = answers.projectKind === 'monorepo' ? root : outDir;
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`[Setup] Installing dependencies in ${installCwd} …`);
  await runCommand({ cwd: installCwd, command: 'pnpm', args: ['install'] });

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`[Setup] Starting dev server in ${outDir} …`);
  await runCommand({ cwd: outDir, command: 'pnpm', args: ['dev'] });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});


