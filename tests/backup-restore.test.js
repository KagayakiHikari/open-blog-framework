import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {ROOT,config} from '../src/config.js';
import {createApp} from '../src/app.js';
import {openDatabase} from '../src/db.js';
import {savePost} from '../src/content.js';
import {login,session,revokeSessions} from '../src/security.js';
import {account,sample,removeTestRoot} from './helpers.js';

function inventory(root,prefix=''){
  return readdirSync(root).sort().flatMap(name=>{
    const file=join(root,name),info=lstatSync(file),path=prefix+name;
    assert.equal(info.isSymbolicLink(),false);
    return info.isDirectory()?inventory(file,path+'/'):[{path,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}];
  });
}

test('stopped synthetic backup restores data and media; real CLI revokes restored sessions before traffic',async()=>{
  const root=mkdtempSync(join(tmpdir(),'open-blog-recovery-')),source=join(root,'source'),restored=join(root,'restored'),backup=join(root,'backup');
  mkdirSync(source);mkdirSync(restored);
  let app,db;
  try{
    const c=config({BLOG_MODE:'test'},source);app=await createApp(c,{logger:()=>{}});
    const user=await account(app.db,'recoveryoperator');
    savePost(app.db,sample({slug:'restored-public',title:'Synthetic recovered publication',status:'published',publishedAt:'2024-01-01T00:00:00Z',tags:['recovery']}),user);
    savePost(app.db,sample({slug:'restored-draft',title:'Synthetic recovered draft'}),user);
    const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#8170ba'}}).png().toBuffer();
    const media=await app.media.upload(bytes,user),token=await login(app.db,user.username,user.password,'127.0.0.1');
    const request={headers:{cookie:`blog_session=${token}`}};
    assert.ok(session(app.db,request,c));
    await app.close();app=undefined;
    assert.equal(existsSync(join(c.dataDir,'.server.lock')),false);
    cpSync(c.dataDir,backup,{recursive:true,errorOnExist:true,force:false});
    assert.ok(inventory(backup).some(file=>file.path==='.framework-data'));
    // A later revocation is absent from the old snapshot: restoring it must not reopen traffic yet.
    db=openDatabase(c);revokeSessions(db,user.user_id);assert.equal(session(db,request,c),null);db.close();db=undefined;
    cpSync(backup,join(restored,'var'),{recursive:true,errorOnExist:true,force:false});
    assert.deepEqual(inventory(join(restored,'var')),inventory(backup));
    const rc={...config({BLOG_MODE:'test'},restored)};
    db=openDatabase(rc);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('SELECT count(*) n FROM migrations').get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM posts').get().n,2);
    assert.equal(db.prepare('SELECT count(*) n FROM media').get().n,1);
    assert.ok(session(db,request,rc)); // Actual rollback hazard, observed without a listening server.
    db.close();db=undefined;
    for(const path of ['src','scripts','migrations','package.json'])cpSync(join(ROOT,path),join(restored,path),{recursive:true});
    const revoke=spawnSync(process.execPath,[join(restored,'scripts/admin.js'),'revoke',user.username],{cwd:restored,encoding:'utf8',windowsHide:true,timeout:15000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}});
    assert.equal(revoke.status,0,'Restored-account revocation CLI must succeed');
    app=await createApp(rc,{logger:()=>{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));rc.origin=`http://127.0.0.1:${app.server.address().port}`;
    const get=path=>fetch(rc.origin+path);
    assert.equal((await fetch(rc.origin+'/api/session',{headers:{Cookie:request.headers.cookie}})).status,401);
    assert.match(await (await get('/posts/restored-public')).text(),/Synthetic recovered publication/);
    assert.equal((await get('/posts/restored-draft')).status,404);
    const archives=await (await get('/archives')).text();assert.match(archives,/Synthetic recovered publication/);assert.doesNotMatch(archives,/Synthetic recovered draft/);
    const image=await get(media.url);assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),readFileSync(join(backup,'media',media.url.split('/').pop())));
    assert.equal((await get('/health')).status,200);
    // Use the real HTTP nonce/password/session path after recovery, not a mocked login result.
    const page=await get('/login'),cookie=page.headers.getSetCookie()[0].split(';')[0],csrf=(await page.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
    const auth=await fetch(rc.origin+'/login',{method:'POST',headers:{Origin:rc.origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:user.password,csrf})});assert.equal(auth.status,200);
    const active=auth.headers.getSetCookie()[0].split(';')[0];assert.equal((await fetch(rc.origin+'/api/session',{headers:{Cookie:active}})).status,200);
  }finally{if(app)await app.close();db?.close();removeTestRoot(root,'open-blog-recovery-');}
});
