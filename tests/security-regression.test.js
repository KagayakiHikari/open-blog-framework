import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { ROOT, config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { supportedRuntime } from '../src/runtime.js';
import { login, session, hash, revokeSessions } from '../src/security.js';
import { account, sample, removeTestRoot } from './helpers.js';

test('runtime floors exclude vulnerable versions and unsupported majors', () => {
  for (const version of ['22.23.4','24.20.0','24.22.0','25.9.0','26.7.0','26.12.0','27.0.0']) assert.equal(supportedRuntime(version), false, version);
  for (const version of ['24.22.1','24.23.0','26.12.1','26.13.0']) assert.equal(supportedRuntime(version), true, version);
});

test('upgrade from initial schema preserves content and invalidates legacy sessions',async()=>{
  const root=mkdtempSync(join(tmpdir(),'blog-upgrade-')),data=join(root,'var');mkdirSync(data);
  writeFileSync(join(data,'.framework-data'),'open-blog-framework:data-v1\n');
  const legacy=new DatabaseSync(join(data,'blog.sqlite'));
  legacy.exec(readFileSync(join(ROOT,'migrations/001-initial.sql'),'utf8'));
  legacy.exec('CREATE TABLE migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)');
  legacy.prepare('INSERT INTO migrations VALUES (?,?)').run('001-initial.sql',Date.now());
  const user=await account(legacy,'upgradeoperator','admin');
  legacy.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)').run(hash('a'.repeat(64)),user.user_id,'b'.repeat(64),Date.now(),Date.now(),Date.now()+3600000);
  legacy.prepare('INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-id',user.user_id,'Synthetic preserved title','preserved','Synthetic','# Synthetic','draft',Date.now(),Date.now(),Date.now(),1);
  legacy.close();let db;
  try{
    const c=config({BLOG_MODE:'test'},root);db=openDatabase(c);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM posts').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM migrations').get().n,2);
    assert.ok(await login(db,user.username,user.password,'127.0.0.1'));
  }finally{db?.close();removeTestRoot(root,'blog-upgrade-');}
});

test('real login verification serialized with password changes and CLI revocation', async t => {
  const root = mkdtempSync(join(tmpdir(),'blog-auth-race-'));
  // CLI derives its root from its executable source. Copy only independent framework code.
  for (const dir of ['src','scripts','migrations']) cpSync(join(ROOT,dir),join(root,dir),{recursive:true});
  const c = config({BLOG_MODE:'test'},root), db = openDatabase(c);
  const oldPassword='Synthetic-old-credential-572!', newPassword='Synthetic-new-credential-815!';
  const user=await account(db,'raceoperator','admin',oldPassword);
  const cli=(command,input)=>spawnSync(process.execPath,[join(root,'scripts/admin.js'),command,user.username],{cwd:root,input,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP},encoding:'utf8',windowsHide:true,timeout:15000});
  const req=token=>({headers:{cookie:`blog_session=${token}`}});
  try {
    await t.test('A/E: password change from another process invalidates real in-flight verification',async()=>{
      const pending=login(db,user.username,oldPassword,'127.0.0.2');
      // Register rejection before running the blocking child process; no fake verifier or hook.
      const rejected=assert.rejects(pending,error=>error.status===401);
      assert.equal(cli('password',newPassword).status,0);
      await rejected;
      assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
      assert.equal(db.prepare('SELECT auth_version FROM users WHERE id=?').get(user.user_id).auth_version,2);
    });
    await t.test('B/E: CLI revoke advances generation while a real new-password login is pending',async()=>{
      const pending=login(db,user.username,newPassword,'127.0.0.3');
      const rejected=assert.rejects(pending,error=>error.status===401);
      assert.equal(cli('revoke').status,0);await rejected;
      assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
    });
    await t.test('C/D: new password succeeds, old password fails, normal revoke and expiry remain enforced',async()=>{
      await assert.rejects(login(db,user.username,oldPassword,'127.0.0.4'),error=>error.status===401);
      const token=await login(db,user.username,newPassword,'127.0.0.5');
      assert.ok(session(db,req(token),c));
      const oldRow=db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash(token));
      assert.equal(oldRow.auth_version,3);
      revokeSessions(db,user.user_id);assert.equal(session(db,req(token),c),null);
      // A stale row restored without matching the new generation must still be rejected.
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run(...['token_hash','user_id','csrf','created_at','seen_at','expires_at','auth_version'].map(k=>oldRow[k]));
      assert.equal(session(db,req(token),c),null);
      const fresh=await login(db,user.username,newPassword,'127.0.0.6');
      assert.equal(session(db,req(fresh),c,Date.now()+8*3600000+1),null);
    });
    await t.test('concurrent normal logins retain the session cap',async()=>{
      for(let i=0;i<5;i++)await Promise.all([login(db,user.username,newPassword,'127.0.0.7'),login(db,user.username,newPassword,'127.0.0.8')]);
      assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,8);
    });
  } finally {db.close();removeTestRoot(root,'blog-auth-race-');}
});

test('slow anonymous bodies cannot consume authenticated capacity; cancellation and deadlines release readers',async t=>{
  const root=mkdtempSync(join(tmpdir(),'blog-reader-')),c={...config({BLOG_MODE:'test'},root)};
  const app=await createApp(c,{logger:()=>{}}), connections=[];
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));c.origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(p,options={})=>fetch(c.origin+p,{redirect:'manual',...options});
  async function nonce(){const r=await request('/login');return {cookie:r.headers.getSetCookie()[0].split(';')[0],csrf:(await r.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1]};}
  const user=await account(app.db,'readeroperator','admin');
  async function signIn(){const n=await nonce(),r=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:n.cookie,'Content-Type':'application/json'},body:JSON.stringify({...n,username:user.username,password:user.password})});assert.equal(r.status,200);const cookie=r.headers.getSetCookie()[0].split(';')[0],info=await request('/api/session',{headers:{Cookie:cookie}});return {cookie,csrf:(await info.json()).csrf};}
  function slow(n){let response;const result=new Promise(resolve=>{response=resolve;});const req=http.request(c.origin+'/login',{method:'POST',headers:{Origin:c.origin,'Content-Type':'application/json','Transfer-Encoding':'chunked',...(n?{Cookie:n.cookie}:{})}},res=>{res.resume();response(res.statusCode);});req.on('error',()=>response('cancelled'));req.write('{');connections.push(req);return {req,result};}
  try {
    const auth=await signIn();
    await t.test('original four unsigned anonymous requests rejected before body reading; valid login still succeeds',async()=>{
      const slowRequests=Array.from({length:4},()=>slow());
      assert.deepEqual(await Promise.all(slowRequests.map(r=>r.result)),[403,403,403,403]);
      await signIn();
    });
    await t.test('valid anonymous readers are separate from writes, duplicates rejected and other login succeeds',async()=>{
      const n=await nonce(),s=slow(n);await new Promise(r=>setTimeout(r,40));
      const duplicate=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:n.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(duplicate.status,429);
      await signIn();
      const saved=await request('/api/posts',{method:'POST',headers:{Origin:c.origin,Cookie:auth.cookie,'X-CSRF-Token':auth.csrf,'Content-Type':'application/json'},body:JSON.stringify(sample())});assert.equal(saved.status,201);
      s.req.destroy();await s.result;await new Promise(r=>setTimeout(r,40));
      // The very same pre-login key must be released on cancellation.
      const retry=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:n.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(retry.status,403);
    });
    await t.test('two valid slow anonymous requests time out; authenticated write remains usable',async()=>{
      const first=slow(await nonce()),second=slow(await nonce());
      await new Promise(r=>setTimeout(r,40));
      const saved=await request('/api/posts',{method:'POST',headers:{Origin:c.origin,Cookie:auth.cookie,'X-CSRF-Token':auth.csrf,'Content-Type':'application/json'},body:JSON.stringify(sample({slug:'second-safe-write'}))});assert.equal(saved.status,201);
      assert.deepEqual(await Promise.all([first.result,second.result]),[408,408]);
      await signIn();
    });
    await t.test('dripping data cannot extend the absolute anonymous deadline',async()=>{
      const n=await nonce(),s=slow(n),start=Date.now();
      const timer=setInterval(()=>{if(!s.req.destroyed)s.req.write(' ');},300);
      try{assert.equal(await s.result,408);assert.ok(Date.now()-start<3500);}finally{clearInterval(timer);s.req.destroy();}
      await signIn();
    });
    await t.test('cancelled authenticated readers release all four slots; revoked request cannot write',{timeout:5000},async()=>{
      const held=[],admitted=[],closed=[];
      // The app's request listener runs first and installs the body reader synchronously.
      // Observe each marked request on the server, including its reader and eventual close.
      const observe=(req)=>{
        if(req.headers['x-test-reader']!=='held')return;
        admitted.push(req.listeners('data').some(fn=>fn.name==='data')&&req.listeners('end').some(fn=>fn.name==='end'));
        req.once('close',()=>{closed.push(req);if(closed.length===4)closedResolve();});
        if(admitted.length===4)admittedResolve();
      };
      let admittedResolve,closedResolve;
      const allAdmitted=new Promise(r=>{admittedResolve=r;}),allClosed=new Promise(r=>{closedResolve=r;});
      app.server.on('request',observe);
      for(let i=0;i<4;i++){
        const r=http.request(c.origin+'/api/posts',{method:'POST',headers:{Origin:c.origin,Cookie:auth.cookie,'Content-Type':'application/json','Transfer-Encoding':'chunked','X-CSRF-Token':auth.csrf,'X-Test-Reader':'held'}},res=>res.resume());r.on('error',()=>{});r.write('{');connections.push(r);held.push(r);
      }
      await allAdmitted;app.server.off('request',observe);assert.deepEqual(admitted,[true,true,true,true]);
      const options={method:'POST',headers:{Origin:c.origin,Cookie:auth.cookie,'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify(sample({slug:'released-write'}))};
      assert.equal((await request('/api/posts',options)).status,429);
      held.forEach(r=>r.destroy());await allClosed;
      assert.equal((await request('/api/posts',options)).status,201);
      let finish;const completed=new Promise(r=>{finish=r;});
      const r=http.request(c.origin+'/api/posts',{method:'POST',headers:options.headers},res=>{res.resume();finish(res.statusCode);});r.on('error',()=>finish('cancelled'));r.write('{');connections.push(r);
      await new Promise(resolve=>setTimeout(resolve,40));revokeSessions(app.db,user.user_id);
      r.end(JSON.stringify(sample({slug:'revoked-in-flight'})).slice(1));assert.equal(await completed,401);
      assert.equal(app.db.prepare('SELECT count(*) n FROM posts WHERE slug=?').get('revoked-in-flight').n,0);
    });
  }finally{connections.forEach(r=>r.destroy());await app.close();removeTestRoot(root,'blog-reader-');}
});

test('rejected upload bodies are drained within limits and other requests remain usable',async()=>{
  const root=mkdtempSync(join(tmpdir(),'blog-rejected-body-')),c={...config({BLOG_MODE:'test'},root)};
  const app=await createApp(c,{logger:()=>{}}),connections=[];
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));c.origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(p,options={})=>fetch(c.origin+p,{redirect:'manual',...options});
  const user=await account(app.db,'uploadoperator','admin');
  try{
    const page=await request('/login'),loginCookie=page.headers.getSetCookie()[0].split(';')[0],nonce=(await page.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const login=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:loginCookie,'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:user.password,csrf:nonce})});
    assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0];
    const session=await request('/api/session',{headers:{Cookie:cookie}}),csrf=(await session.json()).csrf;
    const headers={Origin:c.origin,Cookie:cookie,'Content-Type':'application/octet-stream','X-CSRF-Token':csrf};
    const bytes=Buffer.alloc(5*1024*1024+1);
    for(let i=0;i<10;i++)assert.equal((await request('/api/media',{method:'POST',headers,body:bytes})).status,413);
    const chunked=await new Promise((resolve,reject)=>{
      const r=http.request(c.origin+'/api/media',{method:'POST',headers:{...headers,'Transfer-Encoding':'chunked'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      connections.push(r);r.on('error',reject);r.end(bytes);
    });
    assert.equal(chunked,413);
    const start=Date.now();
    const slow=await new Promise((resolve,reject)=>{
      const r=http.request(c.origin+'/api/media',{method:'POST',headers:{...headers,'Content-Length':bytes.length}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      connections.push(r);r.on('error',reject);r.write(Buffer.alloc(1));
    });
    assert.equal(slow,413);assert.ok(Date.now()-start<2000);
    const cancelled=http.request(c.origin+'/api/media',{method:'POST',headers:{...headers,'Content-Length':bytes.length}});
    connections.push(cancelled);cancelled.on('error',()=>{});cancelled.write(Buffer.alloc(1));
    await new Promise(r=>setTimeout(r,40));cancelled.destroy();
    const saved=await request('/api/posts',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(sample({slug:'after-rejected-upload'}))});
    assert.equal(saved.status,201);
    const nextPage=await request('/login'),nextCookie=nextPage.headers.getSetCookie()[0].split(';')[0],nextNonce=(await nextPage.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const nextLogin=await request('/login',{method:'POST',headers:{Origin:c.origin,Cookie:nextCookie,'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:user.password,csrf:nextNonce})});
    assert.equal(nextLogin.status,200);
  }finally{connections.forEach(r=>r.destroy());await app.close();removeTestRoot(root,'blog-rejected-body-');}
});
