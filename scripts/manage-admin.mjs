import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_SCHEMA } from '../server/admin.mjs';

const usage = 'Usage: node scripts/manage-admin.mjs grant|revoke --email ADDRESS [--db PATH]';
let db;
try {
  const [action, ...args] = process.argv.slice(2);
  if (!['grant', 'revoke'].includes(action)) throw new Error(usage);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--email', '--db'].includes(key) || Object.hasOwn(options, key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
    options[key] = args[index + 1];
  }
  const email = String(options['--email'] || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('An explicit valid account email is required.');
  const filename = path.resolve(options['--db'] || process.env.FIZLAB_DB_PATH || 'data.local/fizlab.sqlite');
  if (!existsSync(filename)) throw new Error('The existing local account database was not found.');
  db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const user = db.prepare('SELECT id FROM auth_users WHERE email=?').get(email);
  if (!user) throw new Error('The account does not exist. Register it through the app first.');
  db.exec(ADMIN_SCHEMA);
  if (action === 'grant') db.prepare('INSERT INTO app_admins(user_id,created_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING').run(user.id, Math.floor(Date.now() / 1000));
  else db.prepare('DELETE FROM app_admins WHERE user_id=?').run(user.id);
  db.exec('COMMIT');
  console.log(JSON.stringify({ success: true, action, userId: user.id, role: action === 'grant' ? 'superadmin' : 'member' }));
} catch (error) {
  try { db?.exec('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(error.code ? 'Unable to update the local administrator role. Check the database and retry.' : error.message);
  process.exitCode = 1;
} finally { db?.close(); }
