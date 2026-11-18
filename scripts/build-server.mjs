import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve(process.cwd(), 'dist-server');
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.resolve(process.cwd(), 'server.ts')],
  outfile: path.join(outDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});
