import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepareData, ROOT } from './config.js';

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function openDatabase(c) {
  prepareData(c);
  const marker = join(c.dataDir, '.framework-data');
  if (!existsSync(marker) && readdirSync(c.dataDir).length) throw new Error('Refusing unmarked existing data directory');
  if (!existsSync(marker)) writeFileSync(marker, 'open-blog-framework:data-v1\n', { flag: 'wx', mode: 0o600 });
  if (readFileSync(marker, 'utf8') !== 'open-blog-framework:data-v1\n') throw new Error('Foreign data directory');
  mkdirSync(join(c.dataDir, 'media'), { recursive: true, mode: 0o700 });
  mkdirSync(join(c.dataDir, 'tmp'), { recursive: true, mode: 0o700 });
  const file = join(c.dataDir, 'blog.sqlite');
  const db = new DatabaseSync(file, { allowExtension: false, enableForeignKeyConstraints: true });
  chmodSync(file, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const migrations = readdirSync(join(ROOT, 'migrations')).filter(f => /^\d+-[\w-]+\.sql$/.test(f)).sort();
  for (const name of migrations) {
    if (db.prepare('SELECT 1 FROM migrations WHERE name=?').get(name)) continue;
    transaction(db, () => { db.exec(readFileSync(join(ROOT, 'migrations', name), 'utf8')); db.prepare('INSERT INTO migrations VALUES (?,?)').run(name, Date.now()); });
  }
  return db;
}
export function audit(db, event, actorId = null, targetId = null) {
  db.prepare('INSERT INTO audit(time,event,actor_id,target_id) VALUES (?,?,?,?)').run(Date.now(), event, actorId, targetId);
  db.prepare('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 5000)').run();
}
