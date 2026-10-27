import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { openSync, closeSync, unlinkSync, writeSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, audit } from './db.js';
import { fail, HttpError } from './errors.js';
import { cookie, cookies, cookieName, random, equal, session, requireUser, requireAdmin, sameOrigin, csrf, rate, login, revokeSessions, hash } from './security.js';
import { createBodyReader } from './request-body.js';
import { escape as e, publicPosts, publicArchives, savePost, deletePost, tagsFor, mayEdit } from './content.js';
import { layout, home, listing, archivesView, tagsView, article, loginView, dashboard, editor, mediaView, sessionsView, auditView, csrfHidden } from './views.js';
import { themeAsset, themeCss } from './design.js';
import { mediaService } from './media.js';
import { ROOT } from './config.js';

const ASSETS = new Map([['/assets/style.css',['style.css','text/css; charset=utf-8']],['/assets/admin.js',['admin.js','text/javascript; charset=utf-8']],['/assets/ui.js',['ui.js','text/javascript; charset=utf-8']]]);
const idPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
async function formOrJson(req, max, readBody, options) {
  const type=(req.headers['content-type']??'').split(';')[0];
  if (!['application/json','application/x-www-form-urlencoded'].includes(type)) fail(415, 'Use JSON or form encoding');
  const buffer=await readBody(req,max,options);
  let body;
  try { body=type==='application/json'?JSON.parse(buffer.toString('utf8')):Object.fromEntries(new URLSearchParams(buffer.toString('utf8'))); }
  catch { fail(400,'Invalid request body'); }
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length>30 || Object.keys(body).some(k=>['__proto__','constructor','prototype'].includes(k))) fail(400,'Invalid request body');
  return body;
}
function securityHeaders(res,c,id) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Request-ID',id);
  if(c.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
function send(res, status, value, type='text/html; charset=utf-8') { res.writeHead(status,{'Content-Type':type});res.end(value); }
function json(res,status,value) { send(res,status,JSON.stringify(value),'application/json; charset=utf-8'); }
function redirect(res,path) { res.writeHead(303,{Location:path});res.end(); }
function pageNumber(url, name='page') { const n=Number(url.searchParams.get(name)??1);if(!Number.isInteger(n)||n<1||n>10000)fail(400,'Invalid page');return n; }

// Code extensions are explicitly installed by the operator, never via HTTP.
export async function createApp(c, { extensions = [], logger = record => console.error(JSON.stringify(record)) } = {}) {
  const readBody=createBodyReader();
  const db=openDatabase(c), media=mediaService(c,db);
  const lockFile=join(c.dataDir,'.server.lock');let lock;
  try{lock=openSync(lockFile,'wx',0o600);writeSync(lock,String(process.pid));await media.cleanup();}
  catch(error){if(lock!==undefined){closeSync(lock);unlinkSync(lockFile);}db.close();throw error;}
  const hooks=extensions.map(extension=>{
    if(!extension || typeof extension.name!=='string' || !/^[a-z][a-z0-9-]{0,39}$/.test(extension.name) || typeof extension.afterPostSaved!=='function')throw new Error('Invalid trusted extension');
    return extension;
  });
  // A single application process owns the media concurrency slot.
  const server=http.createServer({ maxHeaderSize:16384, requestTimeout:30000, headersTimeout:10000, keepAliveTimeout:5000 }, async(req,res)=>{
    const requestId=randomUUID();securityHeaders(res,c,requestId);
    try {
      if (!['GET','HEAD','POST','PUT','DELETE'].includes(req.method)) fail(405,'Method not allowed');
      if(!req.url || req.url.length>4096 || !req.url.startsWith('/') || req.url.startsWith('//'))fail(400,'Invalid URL');
      if(req.headers.host!==new URL(c.origin).host)fail(421,'Host rejected');
      const url=new URL(req.url,c.origin), path=url.pathname;
      if(/%(?:00|2f|5c)|\\/i.test(path))fail(400,'Invalid path');
      const api=path.startsWith('/api/');
      const safe=req.method==='GET'||req.method==='HEAD';
      // Native form navigations under no-referrer can carry Origin:null.
      // Keep exact-Origin + CSRF enforcement; only same-origin form pages retain a referrer.
      // same-origin still sends no referrer to any external destination.
      if(safe&&(path==='/login'||path==='/admin'||path.startsWith('/admin/')))res.setHeader('Referrer-Policy','same-origin');
      if(safe && path==='/assets/theme.css')return send(res,200,themeCss(c.design),'text/css; charset=utf-8');
      if(safe && (themeAsset(path)||themeAsset(path,true))){
        const extension=path.split('.').pop(),file=join(ROOT,'public',path.slice(1));
        try{if(lstatSync(join(ROOT,'public','theme')).isSymbolicLink())fail(404,'Asset not found');const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail(404,'Asset not found');}
        catch{fail(404,'Asset not found');}
        const types={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp',woff2:'font/woff2'};
        return send(res,200,await readFile(file),types[extension]);
      }
      if(safe && ASSETS.has(path)) {
        const [file,type]=ASSETS.get(path);res.setHeader('Cache-Control',c.mode==='production'?'public, max-age=3600':'no-store');return send(res,200,await readFile(join(ROOT,'public',file)),type);
      }
      if(safe && path==='/health')return json(res,200,{status:'ok'});
      // Limit all dynamic requests; proxy clients share the peer quota intentionally.
      rate(db,`traffic:${req.socket.remoteAddress}`,600,60000);
      let user=session(db,req,c);
      if(safe && path==='/login') {
        const nonce=random();res.setHeader('Set-Cookie',cookie(c,nonce,true));return send(res,200,loginView(c,nonce));
      }
      if(req.method==='POST' && path==='/login') {
        sameOrigin(req,c);
        const nonce=cookies(req)[cookieName(c,true)];
        if(!/^[a-f0-9]{64}$/.test(nonce??''))fail(403,'Invalid CSRF token');
        // Cheap pre-body admission: the cookie is not authentication; the body token is still mandatory.
        rate(db,`login-body:${hash(req.socket.remoteAddress)}`,24,15*60000);
        const body=await formOrJson(req,4096,readBody,{anonymous:true,key:nonce});
        if(!equal(body.csrf,nonce))fail(403,'Invalid CSRF token');
        if(typeof body.username!=='string'||!/^[a-zA-Z0-9_-]{3,40}$/.test(body.username)||typeof body.password!=='string')fail(400,'Invalid credentials');
        const token=await login(db,body.username,body.password,req.socket.remoteAddress);
        if(user)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
        res.setHeader('Set-Cookie',[cookie(c,token),cookie(c,'',true,true)]);
        if(req.headers['content-type']?.startsWith('application/json'))return json(res,200,{ok:true});
        return redirect(res,'/admin');
      }
      if(req.method==='POST'&&path==='/logout') {
        requireUser(user);sameOrigin(req,c);const body=await formOrJson(req,4096,readBody);
        user=session(db,req,c);requireUser(user);csrf(req,user,body,c);
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);audit(db,'logout',user.user_id);
        res.setHeader('Set-Cookie',cookie(c,'',false,true));return redirect(res,'/login');
      }
      if(safe&&path.startsWith('/media/'))return send(res,200,await media.get(path.slice(7)),'image/webp');
      if(safe&&path==='/') {
        const query=url.searchParams.get('q')??'',tag=url.searchParams.get('tag')??'';
        return send(res,200,home(c,publicPosts(db,{query,tag,page:pageNumber(url)}),query,tag,user,db));
      }
      if(safe&&path==='/archives')return send(res,200,archivesView(c,publicArchives(db,{year:url.searchParams.get('year')??'',page:pageNumber(url)}),user));
      if(safe&&['/posts','/search'].includes(path)){
        const query=url.searchParams.get('q')??'',tag=url.searchParams.get('tag')??'';
        return send(res,200,listing(c,publicPosts(db,{query,tag,page:pageNumber(url)}),query,tag,user,db,path));
      }
      if(safe&&/^\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) {
        const post=db.prepare("SELECT * FROM posts WHERE slug=? AND status='published' AND published_at<=?").get(path.slice(7),Date.now());
        if(!post)fail(404,'Article not found');return send(res,200,article(c,post,tagsFor(db,post.id),user));
      }
      if(safe&&path==='/tags') {
        const tags=db.prepare("SELECT t.name,count(*) AS n FROM tags t JOIN post_tags pt ON t.id=pt.tag_id JOIN posts p ON p.id=pt.post_id WHERE p.status='published' AND p.published_at<=? GROUP BY t.id ORDER BY t.name").all(Date.now());
        return send(res,200,tagsView(c,tags,user));
      }
      if(safe&&['/feed.xml','/sitemap.xml','/robots.txt'].includes(path)) {
        if(path==='/robots.txt')return send(res,200,`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /login\nSitemap: ${c.origin}/sitemap.xml\n`,'text/plain; charset=utf-8');
        const rows=db.prepare("SELECT title,slug,summary,published_at,updated_at FROM posts WHERE status='published' AND published_at<=? ORDER BY published_at DESC LIMIT 1000").all(Date.now());
        const output=path==='/sitemap.xml'?`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${e(c.origin)}/</loc></url>${rows.map(p=>`<url><loc>${e(c.origin)}/posts/${e(p.slug)}</loc><lastmod>${new Date(p.updated_at).toISOString()}</lastmod></url>`).join('')}</urlset>`:`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${e(c.title)}</title><link>${e(c.origin)}</link><description>${e(c.description)}</description>${rows.slice(0,50).map(p=>`<item><title>${e(p.title)}</title><link>${e(c.origin)}/posts/${e(p.slug)}</link><guid>${e(c.origin)}/posts/${e(p.slug)}</guid><description>${e(p.summary)}</description><pubDate>${new Date(p.published_at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
        return send(res,200,output,'application/xml; charset=utf-8');
      }
      if(path.startsWith('/admin')||api) {
        if(!user&&!api&&safe)return redirect(res,'/login');
        requireUser(user);
        if(safe&&path==='/api/session')return json(res,200,{username:user.username,role:user.role,csrf:user.csrf});
        if(safe&&path==='/admin')return send(res,200,dashboard(c,db,user));
        if(safe&&path==='/admin/posts/new')return send(res,200,editor(c,db,user));
        const edit=path.match(new RegExp(`^/admin/posts/(${idPattern})$`));
        if(safe&&edit) {
          const post=db.prepare('SELECT * FROM posts WHERE id=?').get(edit[1]);if(!post)fail(404,'Post not found');
          if(!mayEdit(user,post))fail(403,'Post access denied');return send(res,200,editor(c,db,user,post));
        }
        if(safe&&path==='/api/posts') {
          const page=pageNumber(url);
          const rows=user.role==='admin'?db.prepare('SELECT * FROM posts ORDER BY updated_at DESC LIMIT 50 OFFSET ?').all((page-1)*50):db.prepare('SELECT * FROM posts WHERE author_id=? ORDER BY updated_at DESC LIMIT 50 OFFSET ?').all(user.user_id,(page-1)*50);
          return json(res,200,{posts:rows.map(p=>({...p,tags:tagsFor(db,p.id)})),page});
        }
        if(safe&&path==='/admin/media')return send(res,200,mediaView(c,db,user));
        if(safe&&path==='/admin/audit') {
          requireAdmin(user);const rows=db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all();
          return send(res,200,auditView(c,rows,user));
        }
        if(safe&&path==='/admin/sessions') {
          const count=db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires_at>? AND seen_at>?').get(user.user_id,Date.now(),Date.now()-1800000).n;
          return send(res,200,sessionsView(c,count,user));
        }
        if(!safe) {
          sameOrigin(req,c);
          rate(db,`write:${user.user_id}`,60,60000);
          if(req.method==='POST'&&path==='/api/media') {
            csrf(req,user,{},c);
            if((req.headers['content-type']??'').split(';')[0]!=='application/octet-stream')fail(415,'Send raw image bytes');
            const bytes=await readBody(req,5*1024*1024);
            user=session(db,req,c);requireUser(user);csrf(req,user,{},c);
            return json(res,201,await media.upload(bytes,user));
          }
          const body=await formOrJson(req,2*1024*1024,readBody);
          user=session(db,req,c);requireUser(user);csrf(req,user,body,c);
          if(req.method==='POST'&&path==='/admin/sessions/revoke') {
            revokeSessions(db,user.user_id);
            res.setHeader('Set-Cookie',cookie(c,'',false,true));return redirect(res,'/login');
          }
          const save=path.match(new RegExp(`^/(api|admin)/posts(?:/(${idPattern}))?$`));
          if(save&&((req.method==='POST'&&!save[2])||req.method==='PUT'&&save[1]==='api'&&save[2]||req.method==='POST'&&save[1]==='admin')) {
            const post=savePost(db,body,user,save[2]);
            for(const hook of hooks)try{await hook.afterPostSaved(Object.freeze({...post,tags:Object.freeze([...post.tags])}));}catch{logger({event:'extension_failed',extension:hook.name,requestId});}
            if(save[1]==='api')return json(res,save[2]?200:201,post);return redirect(res,`/admin/posts/${post.id}`);
          }
          const remove=path.match(new RegExp(`^/(api|admin)/posts/(${idPattern})(/delete)?$`));
          if(remove&&(req.method==='DELETE'&&remove[1]==='api'||req.method==='POST'&&remove[1]==='admin'&&remove[3])) {
            if(remove[1]==='admin'&&body.confirm!=='yes')fail(400,'Deletion confirmation required');deletePost(db,user,remove[2]);
            if(remove[1]==='api')return json(res,200,{ok:true});return redirect(res,'/admin');
          }
          const removeMedia=path.match(new RegExp(`^/(api|admin)/media/(${idPattern})(/delete)?$`));
          if(removeMedia&&(req.method==='DELETE'&&removeMedia[1]==='api'||req.method==='POST'&&removeMedia[1]==='admin'&&removeMedia[3])) {
            if(removeMedia[1]==='admin'&&body.confirm!=='yes')fail(400,'Deletion confirmation required');await media.delete(removeMedia[2],user);
            if(removeMedia[1]==='api')return json(res,200,{ok:true});return redirect(res,'/admin/media');
          }
        }
      }
      fail(404,'Page not found');
    } catch(error) {
      if(res.headersSent){res.destroy();return;}
      // Do not drain an unbounded rejected body or retain its keep-alive connection.
      if(!req.complete){
        res.setHeader('Connection','close');
        // Give an in-flight upload a bounded chance to finish before closing the response.
        // Count discarded bytes without retaining them; slow or enormous bodies remain bounded.
        await new Promise(resolve=>{
          let size=0,done=false;
          const finish=()=>{
            if(done)return;done=true;clearTimeout(timer);
            req.off('data',data);req.off('end',finish);req.off('aborted',finish);req.off('error',finish);req.off('close',finish);
            req.pause();if(!req.complete)req.once('error',()=>{});resolve();
          };
          const data=chunk=>{size+=chunk.length;if(size>8*1024*1024)finish();};
          const timer=setTimeout(finish,250);timer.unref();
          req.on('data',data);req.once('end',finish);req.once('aborted',finish);req.once('error',finish);req.once('close',finish);
          if(req.destroyed)finish();else req.resume();
        });
      }
      const status=error instanceof HttpError?error.status:500;
      if(status===500)logger({event:'request_failed',requestId});
      if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));
      const message=status===500?'Service temporarily unavailable':error.message;
      if(req.url?.startsWith('/api/')||req.headers['content-type']?.startsWith('application/json'))json(res,status,{error:message,requestId});
      else send(res,status,layout(c,`Error ${status}`,`<section class="narrow"><h1>${status}</h1><p>${e(message)}</p><a href="/">Return to journal</a></section>`,{robots:'noindex,nofollow'}));
    }
  });
  server.maxConnections=100;
  let closed=false;
  return { server, db, media, async close(){ if(closed)return;closed=true;if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();closeSync(lock);unlinkSync(lockFile); } };
}
