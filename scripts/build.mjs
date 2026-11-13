// Gera os pacotes de distribuição:
//   dist/ultra-motion-x.esm.js   — ES module único
//   dist/ultra-motion-x.iife.js  — script clássico (global UltraMotionX), para embutir inline
//                                  em apps que carregam o HTML como string (ex.: WebView2 NavigateToString)
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const banner = { js: `/*! ULTRA MOTION X ${pkg.version} — motor de movimento sem dependências */` };
const common = { entryPoints: ['src/index.js'], bundle: true, target: ['chrome100'], banner, legalComments: 'none', minify: true };

await build({ ...common, format: 'esm', outfile: 'dist/ultra-motion-x.esm.js' });
await build({ ...common, format: 'iife', globalName: 'UltraMotionX', outfile: 'dist/ultra-motion-x.iife.js' });
console.log('dist/ gerado');
