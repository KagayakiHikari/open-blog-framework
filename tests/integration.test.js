import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { account,sample } from './helpers.js';

test('isolated HTTP acceptance and adversarial tests',async t=>{
  const root=mkdtempSync(join(tmpdir(),'open-blog-http-'));
  let app;const logs=[];
  try {
    const c={...config({BLOG_MODE:'test',BLOG_ORIGIN:'http://127.0.0.1:4300'},root)};
    app=await createApp(c,{logger:r=>logs.push(r)});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    c.origin=base;
    const headers={};
    const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options,headers:{...headers,...options.headers}});
    const admin=await account(app.db,'testadmin','admin'),editor=await account(app.db,'testeditor','editor');
    async function signIn(user){
      const page=await request('/login');const loginCookie=page.headers.getSetCookie()[0].split(';')[0];const html=await page.text();const nonce=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
      const response=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:loginCookie,'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:user.password,csrf:nonce})});
      assert.equal(response.status,200);const cookie=response.headers.getSetCookie()[0].split(';')[0];const info=await request('/api/session',{headers:{Cookie:cookie}});return {cookie,csrf:(await info.json()).csrf};
    }
    const a=await signIn(admin),b=await signIn(editor);
    await t.test('second application refuses the same data directory',async()=>{
      await assert.rejects(createApp(c),error=>error.code==='EEXIST');assert.equal((await request('/health')).status,200);
    });
    const mutation=(path,body,auth=a,method='POST',extra={})=>request(path,{method,headers:{Cookie:auth.cookie,Origin:c.origin,'Content-Type':'application/json','X-CSRF-Token':auth.csrf,...extra},body:JSON.stringify(body)});
    let post;
    await t.test('public pages, hardening headers, host and private files',async()=>{
      for(const path of ['/','/posts','/search','/tags','/feed.xml','/sitemap.xml','/robots.txt','/health','/assets/style.css','/assets/theme.css','/assets/ui.js','/theme/logo.svg'])assert.equal((await request(path)).status,200,path);
      assert.equal((await request('/login')).headers.get('Referrer-Policy'),'same-origin');
      assert.equal((await request('/')).headers.get('Referrer-Policy'),'no-referrer');
      assert.equal((await request('/theme/missing.svg')).status,404);
      const page=await request('/');assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(page.headers.get('Cache-Control'),'no-store');
      const http=await import('node:http');
      const badHost=await new Promise((resolve,reject)=>{const r=http.get(base,{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});
      assert.equal(badHost,421);
      for(const path of ['/.env','/.git/config','/var/blog.sqlite','/src/config.js','/media/%2e%2e%2f.env'])assert.notEqual((await request(path)).status,200,path);
    });
    await t.test('unauthenticated access and login CSRF rejected',async()=>{
      assert.equal((await request('/admin')).status,303);assert.equal((await request('/api/posts')).status,401);
      assert.equal((await mutation('/api/posts',sample(),{cookie:'',csrf:''})).status,401);
      assert.equal((await request('/login',{method:'POST',headers:{Origin:c.origin,'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password:admin.password,csrf:'x'})})).status,403);
    });
    await t.test('CSRF missing, wrong origin and same-site bypass rejected',async()=>{
      assert.equal((await mutation('/api/posts',sample(),a,'POST',{'X-CSRF-Token':''})).status,403);
      assert.equal((await mutation('/api/posts',sample(),a,'POST',{Origin:'https://attacker.invalid'})).status,403);
      assert.equal((await mutation('/api/posts',sample(),a,'POST',{Origin:'null'})).status,403);
      assert.equal((await mutation('/api/posts',sample(),a,'POST',{'Sec-Fetch-Site':'cross-site'})).status,403);
    });
    await t.test('create draft, hide draft, publish, search, tag, RSS and sitemap',async()=>{
      const created=await mutation('/api/posts',sample());assert.equal(created.status,201,await created.clone().text());post=await created.json();
      assert.equal((await request('/posts/'+post.slug)).status,404);assert.doesNotMatch(await(await request('/feed.xml')).text(),/<item>/);
      const published=await mutation('/api/posts/'+post.id,sample({status:'published',revision:1}),a,'PUT');assert.equal(published.status,200);post=await published.json();
      assert.match(await(await request('/posts/'+post.slug)).text(),/<strong>synthetic<\/strong>/);
      assert.match(await(await request('/?q=synthetic')).text(),/A synthetic article/);
      assert.doesNotMatch(await(await request('/?q=%27%20OR%201%3D1--')).text(),/class="card"/);
      assert.match(await(await request('/tags')).text(),/example/);
      assert.match(await(await request('/feed.xml')).text(),/<item>/);assert.match(await(await request('/sitemap.xml')).text(),/posts\/synthetic-article/);
    });
    await t.test('schedule is not publicly visible or in feeds and tag list',async()=>{
      assert.equal((await mutation('/api/posts',sample({slug:'future-only',tags:['future-secret'],status:'published',publishedAt:'2099-01-01T00:00:00Z'}))).status,201);
      for(const path of ['/','/feed.xml','/sitemap.xml','/tags'])assert.doesNotMatch(await(await request(path)).text(),/future-only|future-secret/);
      assert.equal((await request('/posts/future-only')).status,404);
    });
    await t.test('ownership restrictions and optimistic concurrency',async()=>{
      assert.equal((await mutation('/api/posts/'+post.id,sample({revision:post.revision}),b,'PUT')).status,403);
      assert.equal((await mutation('/api/posts/'+post.id,{},b,'DELETE')).status,403);
      assert.equal((await mutation('/api/posts/'+post.id,sample({revision:1}),a,'PUT')).status,409);
      assert.equal((await request('/admin/audit',{headers:{Cookie:b.cookie}})).status,403);
      assert.equal((await request('/admin/posts/'+post.id,{headers:{Cookie:b.cookie}})).status,403);
    });
    await t.test('stored XSS is escaped in title, attributes, XML and sanitized in content',async()=>{
      const response=await mutation('/api/posts',sample({slug:'xss-fixture',title:'<script>alert(1)</script>',summary:'<img src=x onerror=alert(2)>',content:'<script>alert(3)</script>\n\n[bad](javascript:alert%281%29)',status:'published'}));assert.equal(response.status,201);
      const html=await(await request('/posts/xss-fixture')).text();assert.doesNotMatch(html,/<script>|<img[^>]*\sonerror=|href="javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img src=x onerror=alert\(2\)&gt;/);
      assert.doesNotMatch(await(await request('/feed.xml')).text(),/<script>/);
    });
    await t.test('malformed bodies, traversal, duplicate slugs and input validation',async()=>{
      assert.equal((await mutation('/api/posts',sample())).status,409);
      assert.equal((await mutation('/api/posts',sample({slug:'../x'}))).status,400);
      assert.equal((await mutation('/api/posts',sample({content:'x'.repeat(262145)}))).status,400);
      assert.equal((await request('/api/posts',{method:'POST',headers:{Cookie:a.cookie,Origin:c.origin,'Content-Type':'application/json','X-CSRF-Token':a.csrf},body:'{bad'})).status,400);
      assert.equal((await request('/?page=-1')).status,400);
      assert.equal((await request('/api/media',{method:'POST',headers:{Cookie:a.cookie,Origin:c.origin,'Content-Type':'application/octet-stream','X-CSRF-Token':a.csrf},body:Buffer.alloc(5*1024*1024+1)})).status,413);
    });
    let media;
    await t.test('real image worker, byte signatures, permissions, serving and deletion',async()=>{
      const upload=bytes=>request('/api/media',{method:'POST',headers:{Cookie:a.cookie,Origin:c.origin,'Content-Type':'application/octet-stream','X-CSRF-Token':a.csrf},body:bytes});
      assert.equal((await upload(Buffer.from('<svg onload="alert(1)"></svg>'))).status,400);
      assert.equal((await upload(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0]))).status,400);
      const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#668877'}}).png().toBuffer();
      const response=await upload(bytes);assert.equal(response.status,201,await response.clone().text());media=await response.json();
      const image=await request(media.url);assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/webp');assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,'webp');
      assert.equal((await mutation('/api/media/'+media.id,{},b,'DELETE')).status,403);
      assert.equal((await mutation('/api/media/'+media.id,{},a,'DELETE')).status,200);assert.equal((await request(media.url)).status,404);
    });
    await t.test('admin forms, editing pages and audit pages render',async()=>{
      for(const path of ['/admin','/admin/posts/new','/admin/posts/'+post.id,'/admin/media','/admin/sessions','/admin/audit'])assert.equal((await request(path,{headers:{Cookie:a.cookie}})).status,200,path);
      const response=await request('/admin/posts',{method:'POST',headers:{Cookie:a.cookie,Origin:c.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...sample({slug:'form-post'}),tags:'forms',csrf:a.csrf})});assert.equal(response.status,303);
    });
    await t.test('session revocation prevents reuse and deletion works',async()=>{
      assert.equal((await mutation('/api/posts/'+post.id,{},a,'DELETE')).status,200);assert.equal((await request('/posts/'+post.slug)).status,404);
      assert.equal((await mutation('/admin/sessions/revoke',{},b)).status,303);assert.equal((await request('/api/session',{headers:{Cookie:b.cookie}})).status,401);
      assert.equal(logs.length,0,JSON.stringify(logs));
    });
    await t.test('login brute force limit persists without leaking username or password',async()=>{
      const page=await request('/login');const cookie=page.headers.getSetCookie()[0].split(';')[0],csrf=(await page.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];let last;
      for(let i=0;i<13;i++)last=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'nonexistent',password:'synthetic-wrong-pass',csrf})});
      assert.equal(last.status,429);assert.ok(Number(last.headers.get('Retry-After'))>0);
      assert.doesNotMatch(JSON.stringify(app.db.prepare('SELECT * FROM audit').all()),/synthetic-wrong-pass|nonexistent/);
    });
  } finally {if(app)await app.close();rmSync(root,{recursive:true,force:true});}
});
