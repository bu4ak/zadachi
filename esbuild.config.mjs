import esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const license = (await readFile(new URL('./LICENSE', import.meta.url), 'utf8')).trim();

const watch = process.argv.includes('--watch');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2018',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: false,
  minify: !watch,
  banner: { js: `/* Zadachi v${version}\n\n${license}\n*/` },
});
if (watch) await context.watch();
else { await context.rebuild(); await context.dispose(); }
