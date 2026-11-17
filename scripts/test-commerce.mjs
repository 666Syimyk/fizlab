// Isolated browser UX checks. All mail/payment/API interactions are mocked by the
// child tests; this is not a substitute for testing purchases through Google Play.
import { spawn } from 'node:child_process';
import { createServer as createPortReservation } from 'node:net';

const port = await new Promise((resolve, reject) => {
  const reservation = createPortReservation();
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', () => {
    const address = reservation.address();
    reservation.close(error => error ? reject(error) : resolve(address.port));
  });
});
const expectedBase = `http://127.0.0.1:${port}`;

const serverCode = `
  import { createServer } from 'vite';
  const server = await createServer({ server: { host: '127.0.0.1', port: Number(process.env.COMMERCE_UI_PORT), strictPort: true, open: false }, clearScreen: false });
  await server.listen();
  const address = server.httpServer.address();
  console.log('COMMERCE_UI http://127.0.0.1:' + address.port);
`;
// Explicit synthetic public key and same-origin API override any local .env settings.
const env = { ...process.env, COMMERCE_UI_PORT: String(port), VITE_REVENUECAT_GOOGLE_API_KEY: 'goog_isolatedtest', VITE_API_URL: `${expectedBase}/api`, NO_COLOR: '1' };
const server = spawn(process.execPath, ['--input-type=module', '--eval', serverCode], { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
let runningTest;

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
}

try {
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Isolated commerce UI server did not start')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Commerce UI server exited: ${code}`)); });
    server.stdout.on('data', chunk => {
      output += String(chunk);
      const match = output.match(/COMMERCE_UI (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  console.log('Running isolated commerce and account browser checks with mocked services.');
  for (const script of ['scripts/test-ui-subscription.mjs', 'scripts/test-ui-subscription-native.mjs', 'scripts/test-ui-email.mjs']) {
    const code = await new Promise((resolve, reject) => {
      runningTest = spawn(process.execPath, [script], {
        env: { ...env, SUBSCRIPTION_UI_URL: base, EMAIL_UI_URL: base, SMOKE_URL: base },
        stdio: 'inherit', windowsHide: true,
      });
      runningTest.once('error', reject);
      runningTest.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`${script} exited with ${code}`);
  }
} finally {
  await stopOwned(runningTest);
  await stopOwned(server);
}
