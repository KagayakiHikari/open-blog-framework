import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDesign } from './design.js';
import { requireSupportedRuntime } from './runtime.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function config(env = process.env, root = ROOT) {
  requireSupportedRuntime();
  const mode = env.BLOG_MODE ?? 'development';
  if (!['development', 'production', 'test'].includes(mode)) throw new Error('Invalid BLOG_MODE');
  const port = Number(env.BLOG_PORT ?? 4300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid BLOG_PORT');
  const origin = new URL(env.BLOG_ORIGIN ?? `http://localhost:${port}`);
  if (origin.origin !== origin.href.replace(/\/$/, '') || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw new Error('BLOG_ORIGIN must be an origin');
  if (mode === 'production' && origin.protocol !== 'https:') throw new Error('Production requires HTTPS');
  if (mode !== 'production' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Non-production origin must be loopback');
  const host = env.BLOG_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Bind a loopback address and use a reverse proxy');
  const requestedTheme = env.BLOG_THEME ?? 'system';
  if (!['paper', 'night', 'light', 'dark', 'system'].includes(requestedTheme)) throw new Error('Unknown theme');
  const theme = ({paper:'light',night:'dark'})[requestedTheme] ?? requestedTheme;
  const directory = env.BLOG_DATA_DIR ?? 'var';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(directory)) throw new Error('Data directory must be a dedicated relative path');
  const dataDir = resolve(root, directory);
  if (['src', 'scripts', 'migrations', 'public', 'docs', 'tests', 'node_modules', 'dist'].includes(directory.split('/')[0])) throw new Error('Data directory conflicts with source');
  const title = env.BLOG_TITLE ?? '示例小站';
  const description = env.BLOG_DESCRIPTION ?? '记录生活，也分享灵感。';
  if (!title.trim() || title.length > 120 || description.length > 300) throw new Error('Invalid site metadata');
  const design = loadDesign(root, env.BLOG_DESIGN_FILE);
  return Object.freeze({ root, mode, host, port, origin: origin.origin, secure: mode === 'production', dataDir, theme, title, description, design });
}

// Refuse symlinks, junctions and pre-existing foreign data, even if ignored by Git.
export function prepareData(c) {
  const base = realpathSync(c.root);
  let current = base;
  for (const part of relative(c.root, c.dataDir).split(/[\\/]/)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Data path cannot contain links');
  }
  mkdirSync(c.dataDir, { recursive: true, mode: 0o700 });
  const rel = relative(base, realpathSync(c.dataDir));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Data path escapes project');
  for (const name of ['blog.sqlite', 'blog.sqlite-wal', 'blog.sqlite-shm', 'media', 'tmp', '.framework-data']) {
    if (existsSync(join(c.dataDir, name)) && lstatSync(join(c.dataDir, name)).isSymbolicLink()) throw new Error('Linked data entries refused');
  }
}
