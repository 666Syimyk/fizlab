import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const serverKeys = [
  'REVENUECAT_SECRET_API_KEY', 'REVENUECAT_ENTITLEMENT_ID', 'REVENUECAT_ALLOW_SANDBOX',
  'RESEND_API_KEY', 'AUTH_EMAIL_FROM', 'AUTH_EMAIL_ENABLED', 'AUTH_EMAIL_CODE_SECRET',
];
const configurationError = () => new Error('Unable to load private server configuration. Check .env.server.local or FIZLAB_SERVER_ENV_FILE.');

function validateSyntax(source) {
  // parseEnv silently skips malformed input. Reject incomplete assignments/quotes
  // first so a typo cannot silently enable only part of a server configuration.
  if (source.includes('\0')) throw configurationError();
  const assignment = /(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*/y;
  let index = 0;
  while (index < source.length) {
    while (/[ \t\n]/.test(source[index] || '') && index < source.length) index++;
    if (index === source.length) break;
    if (source[index] === '#') {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    assignment.lastIndex = index;
    if (!assignment.exec(source)) throw configurationError();
    index = assignment.lastIndex;
    if (source[index] === '"' || source[index] === "'") {
      const end = source.indexOf(source[index], index + 1);
      if (end < 0) throw configurationError();
      index = end + 1;
      while (source[index] === ' ' || source[index] === '\t') index++;
      if (index < source.length && source[index] !== '\n' && source[index] !== '#') throw configurationError();
    }
    const newline = source.indexOf('\n', index);
    index = newline < 0 ? source.length : newline + 1;
  }
}

export function loadServerEnv({ processEnv = process.env, cwd = process.cwd() } = {}) {
  const configuredFile = Object.hasOwn(processEnv, 'FIZLAB_SERVER_ENV_FILE') ? processEnv.FIZLAB_SERVER_ENV_FILE : '.env.server.local';
  let fileEnv = {};
  if (configuredFile !== '') {
    let source;
    try {
      // A dedicated private file is never loaded into process.env or the Vite client.
      const bytes = readFileSync(path.resolve(cwd, configuredFile));
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    } catch (error) {
      if (error.code !== 'ENOENT') throw configurationError();
    }
    if (source !== undefined) {
      try { validateSyntax(source); fileEnv = parseEnv(source); }
      catch { throw configurationError(); }
    }
  }
  return Object.fromEntries(serverKeys.flatMap(key => {
    if (Object.hasOwn(processEnv, key)) return [[key, processEnv[key]]];
    return Object.hasOwn(fileEnv, key) ? [[key, fileEnv[key]]] : [];
  }));
}
