import cors from 'cors';
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

app.post('/a2a', async (req, res) => {
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

app.post('/mcp', async (_req, res) => {
  return res.status(501).json({
    ok: false,
    error: 'MCP endpoint stub. Implement MCP protocol handling here.',
  });
});

const port = Number(process.env.PORT || 3005);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[agent] listening on http://localhost:${port}`);
});
