const value = process.env.VITE_API_URL;
let valid = false;
try {
  const url = new URL(value);
  valid = url.protocol === 'https:' && /^\/api\/?$/.test(url.pathname)
    && !url.username && !url.password && !url.search && !url.hash
    && !/^(localhost|127\.|\[?::1\]?)/i.test(url.hostname)
    && !/(^|\.)(example|invalid|test|trycloudflare\.com)$/i.test(url.hostname)
    && !['example.com', 'example.org', 'example.net'].includes(url.hostname);
} catch { /* A missing or malformed URL is a configuration error. */ }
if (!valid) {
  console.error('Set VITE_API_URL to a permanent HTTPS backend ending in /api (no credentials, query, fragment, placeholders or temporary tunnels).');
  process.exit(1);
}
