import fs from 'node:fs/promises';

const target = new URL('../dist/index.js', import.meta.url);
const raw = await fs.readFile(target, 'utf8');

if (!raw.startsWith('#!/usr/bin/env node')) {
  await fs.writeFile(target, `#!/usr/bin/env node\n\n${raw.replace(/^(\s*\n)*/,'')}`, 'utf8');
}

try {
  await fs.chmod(target, 0o755);
} catch {
  // ignore (e.g. on restrictive FS)
}


