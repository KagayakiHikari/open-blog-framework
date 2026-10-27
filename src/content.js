import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { randomUUID } from 'node:crypto';
import { fail } from './errors.js';
import { audit, transaction } from './db.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
function localImage(src) { return /^\/media\/[a-f0-9-]{36}\.webp$/.test(src ?? ''); }
export function markdown(text) {
  return sanitizeHtml(marked.parse(text, { gfm: true, breaks: false, async: false }), {
    allowedTags: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'loading'], code: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href ?? '', title: attribs.title ?? '', rel: 'noopener noreferrer' } }),
      img: (tagName, attribs) => ({ tagName, attribs: { src: localImage(attribs.src) ? attribs.src : '', alt: attribs.alt ?? '', loading: 'lazy' } })
    },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src
  });
}
function text(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\0')) fail(400, `Invalid ${name}`);
  return value.trim();
}
export function postInput(body) {
  const title = text(body.title, 'title', 180, true);
  const slug = text(body.slug, 'slug', 140, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400, 'Invalid slug');
  const summary = text(body.summary ?? '', 'summary', 500);
  const content = text(body.content, 'content', 262144, true);
  if (Buffer.byteLength(content) > 262144) fail(400, 'Content too large');
  const status = body.status ?? 'draft';
  if (!['draft', 'published'].includes(status)) fail(400, 'Invalid publication status');
  if (body.tags !== undefined && !Array.isArray(body.tags) && typeof body.tags !== 'string') fail(400, 'Invalid tags');
  const rawTags = Array.isArray(body.tags) ? body.tags : typeof body.tags === 'string' ? body.tags.split(',').filter(t => t.trim()) : [];
  if (rawTags.length > 12) fail(400, 'Too many tags');
  const tags = [...new Set(rawTags.map(t => text(t, 'tag', 40, true)))];
  const publishedAt = body.publishedAt ? Date.parse(body.publishedAt) : Date.now();
  if (!Number.isFinite(publishedAt) || publishedAt < 0 || publishedAt > 8640000000000000) fail(400, 'Invalid publication date');
  return { title, slug, summary, content, status, publishedAt, tags };
}
export function tagsFor(db, id) { return db.prepare('SELECT t.name FROM tags t JOIN post_tags pt ON t.id=pt.tag_id WHERE pt.post_id=? ORDER BY t.name').all(id).map(t => t.name); }
export function publicPosts(db, { query = '', tag = '', page = 1 } = {}, now = Date.now()) {
  if (typeof query !== 'string' || query.length > 120 || typeof tag !== 'string' || tag.length > 40) fail(400, 'Invalid search');
  page = Number(page);
  if (!Number.isInteger(page) || page < 1 || page > 10000) fail(400, 'Invalid page');
  const condition = `status='published' AND published_at<=? AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') AND (?='' OR EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=posts.id AND t.name=?))`;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const args = [now, pattern, pattern, pattern, tag, tag];
  const total = db.prepare(`SELECT count(*) AS n FROM posts WHERE ${condition}`).get(...args).n;
  const posts = db.prepare(`SELECT id,title,slug,summary,published_at,updated_at FROM posts WHERE ${condition} ORDER BY published_at DESC,id LIMIT 10 OFFSET ?`).all(...args, (page - 1) * 10);
  return { posts, total, page, pages: Math.max(1, Math.ceil(total / 10)) };
}
export function mayEdit(user, post) { return user.role === 'admin' || post.author_id === user.user_id; }
export function publicArchives(db, { year = '', page = 1 } = {}, now = Date.now()) {
  if (typeof year !== 'string' || (year !== '' && (!/^[1-9][0-9]{3}$/.test(year) || Number(year) < 1970))) fail(400, 'Invalid archive year');
  page = Number(page);
  if (!Number.isInteger(page) || page < 1 || page > 10000) fail(400, 'Invalid page');
  // UTC year boundaries match the existing publication dates; never include drafts or scheduled posts.
  const visible = "status='published' AND published_at<=?";
  const years = db.prepare(`SELECT strftime('%Y',published_at/1000,'unixepoch') AS year,count(*) AS n FROM posts WHERE ${visible} GROUP BY year ORDER BY year DESC`).all(now).map(row => ({ year: Number(row.year), n: row.n }));
  const args = [now];
  let condition = visible;
  if (year) {
    condition += ' AND published_at>=? AND published_at<?';
    args.push(Date.UTC(Number(year),0,1), Date.UTC(Number(year)+1,0,1));
  }
  const total = db.prepare(`SELECT count(*) AS n FROM posts WHERE ${condition}`).get(...args).n;
  const posts = db.prepare(`SELECT title,slug,summary,published_at FROM posts WHERE ${condition} ORDER BY published_at DESC,id LIMIT 30 OFFSET ?`).all(...args,(page-1)*30);
  return { posts, years, year, total, allTotal: years.reduce((sum,row)=>sum+row.n,0), page, pages: Math.max(1,Math.ceil(total/30)) };
}
export function savePost(db, body, user, id) {
  const data = postInput(body), now = Date.now();
  return transaction(db, () => {
    const previous = id ? db.prepare('SELECT * FROM posts WHERE id=?').get(id) : null;
    if (id && !previous) fail(404, 'Post not found');
    if (previous && !mayEdit(user, previous)) fail(403, 'Post access denied');
    if (previous && Number(body.revision) !== previous.revision) fail(409, 'Post changed; reload before saving');
    if (db.prepare('SELECT id FROM posts WHERE slug=? AND id<>?').get(data.slug, id ?? '')) fail(409, 'Slug already exists');
    id ??= randomUUID();
    if (previous) db.prepare('UPDATE posts SET title=?,slug=?,summary=?,content=?,status=?,published_at=?,updated_at=?,revision=revision+1 WHERE id=?').run(data.title, data.slug, data.summary, data.content, data.status, data.publishedAt, now, id);
    else db.prepare('INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, user.user_id, data.title, data.slug, data.summary, data.content, data.status, data.publishedAt, now, now, 1);
    db.prepare('DELETE FROM post_tags WHERE post_id=?').run(id);
    for (const tag of data.tags) {
      db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)').run(tag);
      db.prepare('INSERT INTO post_tags VALUES (?,(SELECT id FROM tags WHERE name=?))').run(id, tag);
    }
    audit(db, previous ? 'post_updated' : 'post_created', user.user_id, id);
    return { id, ...data, revision: previous ? previous.revision + 1 : 1 };
  });
}
export function deletePost(db, user, id) {
  transaction(db, () => {
    const post = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
    if (!post) fail(404, 'Post not found');
    if (!mayEdit(user, post)) fail(403, 'Post access denied');
    db.prepare('DELETE FROM posts WHERE id=?').run(id);
    audit(db, 'post_deleted', user.user_id, id);
  });
}
