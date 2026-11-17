import fs from 'node:fs';
// The Worker handles SPA fallback. Netlify's _redirects is invalid for Worker Assets;
// Netlify deployments use the identical rule in netlify.toml instead.
if (fs.existsSync('dist/client/_redirects')) fs.unlinkSync('dist/client/_redirects');
fs.mkdirSync('dist/server', { recursive: true });
fs.copyFileSync('server/worker.mjs', 'dist/server/index.js');
for (const filename of fs.readdirSync('server')) {
  if (filename.endsWith('.mjs') && !filename.endsWith('.test.mjs') && filename !== 'worker.mjs') {
    fs.copyFileSync(`server/${filename}`, `dist/server/${filename}`);
  }
}
if (fs.existsSync('.openai/hosting.json')) {
  fs.mkdirSync('dist/.openai', { recursive: true });
  fs.copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
}
console.log('Site client and D1 Worker packaged.');
