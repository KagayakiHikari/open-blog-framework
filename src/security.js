import { randomBytes, createHash, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './errors.js';
import { audit, transaction } from './db.js';

const scrypt = promisify(scryptCallback);
export const random = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || Buffer.byteLength(password) < 16 || Buffer.byteLength(password) > 256) fail(400, 'Password must contain 16–256 bytes');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt-v1$${salt}$${derived.toString('hex')}`;
}
const dummy = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
let passwordChecks = 0;
export async function passwordValid(password, encoded = dummy) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const [version, salt, expected] = encoded.split('$');
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
  if (passwordChecks >= 2) fail(429, 'Authentication busy', 2);
  passwordChecks++;
  try {
    const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return equal(actual.toString('hex'), expected);
  } finally { passwordChecks--; }
}
export function cookies(req) {
  const result = Object.create(null);
  for (const item of (req.headers.cookie ?? '').split(';')) {
    const p = item.indexOf('=');
    if (p > 0) result[item.slice(0, p).trim()] = item.slice(p + 1).trim();
  }
  return result;
}
export function cookieName(c, login = false) { return `${c.secure ? '__Host-' : ''}blog_${login ? 'login' : 'session'}`; }
export function cookie(c, value, login = false, clear = false) {
  return `${cookieName(c, login)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : login ? 600 : 28800}${c.secure ? '; Secure' : ''}`;
}
export function session(db, req, c, now = Date.now()) {
  const token = cookies(req)[cookieName(c)];
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) return null;
  const row = db.prepare('SELECT s.*,u.username,u.role,u.auth_version AS current_auth_version FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash(token));
  if (!row || row.auth_version !== row.current_auth_version || row.expires_at <= now || row.seen_at <= now - 30 * 60 * 1000) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.token_hash);
    return null;
  }
  db.prepare('UPDATE sessions SET seen_at=? WHERE token_hash=?').run(now, row.token_hash);
  return row;
}
export function requireUser(user) { if (!user) fail(401, 'Authentication required'); return user; }
export function requireAdmin(user) { requireUser(user); if (user.role !== 'admin') fail(403, 'Administrator role required'); }
export function sameOrigin(req, c) {
  if (req.headers.origin !== c.origin || ['cross-site', 'none'].includes(req.headers['sec-fetch-site'])) fail(403, 'Request origin rejected');
}
export function csrf(req, user, body, c) {
  sameOrigin(req, c);
  if (!equal(req.headers['x-csrf-token'] ?? body.csrf, user.csrf)) fail(403, 'Invalid CSRF token');
}
export function rate(db, key, limit, duration, now = Date.now()) {
  return transaction(db, () => {
    db.prepare('DELETE FROM rate_buckets WHERE expires_at<=?').run(now);
    const row = db.prepare('SELECT * FROM rate_buckets WHERE key=?').get(key);
    if (row && row.hits >= limit) fail(429, 'Please retry later', Math.max(1, Math.ceil((row.expires_at - now) / 1000)));
    if (!row && db.prepare('SELECT COUNT(*) AS n FROM rate_buckets').get().n >= 10000) fail(503, 'Please retry later', 60);
    db.prepare('INSERT INTO rate_buckets VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1').run(key, 1, now + duration);
  });
}
export async function login(db, username, password, address, now = Date.now()) {
  // Socket peer only. Forwarded headers are never trusted. Behind a proxy this is a shared quota.
  rate(db, `login:${hash(address)}`, 12, 15 * 60 * 1000, now);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!await passwordValid(password, user?.password_hash)) { audit(db, 'login_failed'); fail(401, 'Invalid credentials'); }
  // Serialize the final credential check and issuance against CLI changes in other processes.
  return transaction(db, () => {
    const current = db.prepare('SELECT password_hash,auth_version FROM users WHERE id=?').get(user.id);
    if (!current || current.auth_version !== user.auth_version || current.password_hash !== user.password_hash) fail(401, 'Invalid credentials');
    const token = random(), issuedAt = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at<=? OR seen_at<=?').run(issuedAt, issuedAt - 1800000);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 7)').run(user.id, user.id);
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,created_at,seen_at,expires_at,auth_version) VALUES (?,?,?,?,?,?,?)').run(hash(token), user.id, random(), issuedAt, issuedAt, issuedAt + 8 * 3600000, current.auth_version);
    audit(db, 'login_success', user.id);
    return token;
  });
}

export function revokeSessions(db, userId, encodedPassword = null) {
  transaction(db, () => {
    const changed = db.prepare('UPDATE users SET auth_version=auth_version+1,password_hash=COALESCE(?,password_hash) WHERE id=?').run(encodedPassword, userId);
    if (!changed.changes) fail(404, 'Account not found');
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    audit(db, encodedPassword === null ? 'sessions_revoked' : 'password_changed', userId);
  });
}
