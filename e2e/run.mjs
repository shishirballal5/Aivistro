// Runs every browser journey and prints a summary. Usage: node e2e/run.mjs [name ...]   (env: BASE, E2E_ADMIN_* , see e2e/README.md)
import { spawnSync } from 'node:child_process'; import { mkdirSync, readdirSync } from 'node:fs';
mkdirSync(process.env.SHOTS || 'e2e/screenshots', { recursive: true });
const all = readdirSync(new URL('.', import.meta.url)).filter((f) => /^[a-z-]+\.mjs$/.test(f) && !['lib.mjs', 'run.mjs'].includes(f)).map((f) => f.replace('.mjs', '')).sort();
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all; let failed = 0;
for (const name of wanted) { const r = spawnSync(process.execPath, [new URL(`${name}.mjs`, import.meta.url).pathname], { stdio: 'inherit', env: process.env }); if (r.status !== 0) failed++; console.log(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${name}\n`); }
console.log(failed ? `${failed} of ${wanted.length} journeys failed` : `all ${wanted.length} journeys passed`); process.exit(failed ? 1 : 0);
