import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['src/features/terminal/web/index.js'],
  bundle: true, minify: true, write: false, outdir: 'build', target: ['safari16.4', 'chrome110'] });
const script = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>${css}\nhtml,body,#terminal{margin:0;width:100%;height:100%;overflow:hidden;background:#142033}#terminal{box-sizing:border-box}.xterm{box-sizing:border-box;height:100%;padding:8px;touch-action:none}</style></head><body><div id="terminal"></div><script>${script}</script></body></html>`;
await writeFile(`${root}/src/features/terminal/terminalHtml.ts`, `// 由 npm run build:terminal 產生，請勿手動修改。\nexport const terminalHtml = ${JSON.stringify(html)};\n`);
