import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.js';
import { scanBytes, scanTree } from '../scripts/scan-core.js';
import { releaseFiles } from '../scripts/release-policy.js';
import { removeTestRoot } from './helpers.js';

test('encoded scanner detects bounded common encodings without disclosing values',()=>{
  const token='gh'+'p_'+'Q7z3'.repeat(10);
  const base64=Buffer.from(token).toString('base64');
  const cases=[token,base64,Buffer.from(base64).toString('base64'),Array.from(token).map(c=>'%'+c.charCodeAt(0).toString(16)).join(''),Buffer.from(token).toString('hex'),Array.from(token).map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''),Array.from(token).map(c=>'\\x'+c.charCodeAt(0).toString(16)).join('')];
  for(const value of cases){
    const result=scanBytes(Buffer.from('Mixed text with % invalid escape; '+value),'synthetic.txt');
    assert.ok(result.some(f=>f.category==='provider-token'));assert.ok(!JSON.stringify(result).includes(token));assert.ok(!JSON.stringify(result).includes(value));
  }
  const host='correlation-fixture.test-example.net',hashes=new Set([createHash('sha256').update(host).digest('hex')]);
  assert.ok(scanBytes(Buffer.from(Buffer.from('https://'+host+'/').toString('base64')),'synthetic.txt',hashes).some(f=>f.category==='private-system-identifier'));
  assert.deepEqual(scanBytes(Buffer.from('Normal public documentation and configuration.'),'synthetic.txt'),[]);
  assert.ok(scanBytes(Buffer.from(Array(300).fill(base64).join(' ')),'synthetic.txt').some(f=>f.category==='decode-budget-exceeded'));
});

test('local reflog contacts remain visible while secrets and known private identifiers still block',()=>{
  const root=mkdtempSync(join(tmpdir(),'blog-release-'));
  const email='reviewer'+'@'+'fixture.test',token='gh'+'p_'+'Q7z3'.repeat(10);
  try{
    assert.equal(spawnSync('git',['-C',root,'init','--initial-branch=main'],{windowsHide:true}).status,0);
    mkdirSync(join(root,'.git/logs'),{recursive:true});writeFileSync(join(root,'.git/logs/HEAD'),'Synthetic <'+email+'>');
    const local=scanTree(root);assert.equal(local.findings.length,0);assert.equal(local.localMetadataReview.length,1);assert.ok(!JSON.stringify(local).includes(email));
    assert.ok(scanTree(root,{privateHashes:new Set([createHash('sha256').update(email).digest('hex')])}).findings.some(f=>f.category==='private-system-identifier'));
    writeFileSync(join(root,'.git/logs/HEAD'),token);assert.ok(scanTree(root).findings.some(f=>f.category==='provider-token'));
  }finally{removeTestRoot(root,'blog-release-');}
});

test('Git public identity review is limited to canonical identity headers',()=>{
  const root=mkdtempSync(join(tmpdir(),'blog-release-'));
  const email='12345678+fixture-user'+'@'+'users.noreply.github.com';
  const git=(args,input)=>{const r=spawnSync('git',['-C',root,...args],{input,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  try{
    git(['init','--initial-branch=main']);
    writeFileSync(join(root,'fixture.txt'),'synthetic');git(['add','fixture.txt']);
    const env={...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_COMMITTER_NAME:'Fixture',GIT_AUTHOR_EMAIL:email,GIT_COMMITTER_EMAIL:email};
    const committed=spawnSync('git',['-C',root,'commit','-m','Synthetic root'],{env,encoding:'utf8',windowsHide:true});assert.equal(committed.status,0,committed.stderr);
    let report=scanTree(root);assert.equal(report.findings.length,0);assert.deepEqual(report.publicIdentityReview.map(x=>x.field).sort(),['author','committer']);assert.ok(!JSON.stringify(report).includes(email));
    const hash=createHash('sha256').update(email).digest('hex');
    assert.ok(scanTree(root,{privateHashes:new Set([hash])}).findings.some(x=>x.category==='private-system-identifier'));
    const tree=git(['rev-parse','HEAD^{tree}']),head=git(['rev-parse','HEAD']);
    const identity='Fixture <'+email+'> 1700000000 +0000';
    const object=(type,body)=>git(['hash-object','--literally','-t',type,'-w','--stdin'],body);
    const tag=object('tag',`object ${head}\ntype commit\ntag synthetic\ntagger ${identity}\n\nSynthetic tag\n`);
    report=scanTree(root);assert.ok(report.publicIdentityReview.some(x=>x.location==='git-object:'+tag.slice(0,12)&&x.field==='tagger'));
    const cases=[
      `tree ${tree}\nauthor ${identity}\ncommitter ${identity}\n\n${email}\n`,
      `tree ${tree}\nauthor ${identity}\nauthor ${identity}\ncommitter ${identity}\n\nSynthetic\n`,
      `tree ${tree}\nauthor Fixture <${'123+fixture'+'@'+'users.noreply.github.com.evil.test'}> 1700000000 +0000\ncommitter ${identity}\n\nSynthetic\n`,
      `tree ${tree}\nauthor ${identity}\ncommitter ${identity}\nextra ${email}\n\nSynthetic\n`,
      `tree ${tree}\nauthor ${identity}\ncommitter ${identity}\n\n${Buffer.from(email).toString('base64')}\n`
    ];
    for(const body of cases){const id=object('commit',body);report=scanTree(root);assert.ok(report.findings.some(x=>x.location==='git-object:'+id.slice(0,12)&&x.category==='email-reference'));}
    writeFileSync(join(root,'fixture.txt'),email);assert.ok(scanTree(root).findings.some(x=>x.location==='fixture.txt'&&x.category==='email-reference'));
    git(['config','user.email',email]);assert.ok(scanTree(root).findings.some(x=>x.location==='.git/config'&&x.category==='email-reference'));
  }finally{removeTestRoot(root,'blog-release-');}
});

test('CI accepts only its exact canonical checkout origin and rejects extra or rewritten push targets',()=>{
  const root=mkdtempSync(join(tmpdir(),'blog-release-'));
  const git=args=>{const r=spawnSync('git',['-C',root,...args],{windowsHide:true,stdio:'ignore'});assert.equal(r.status,0);};
  try{
    git(['init','--initial-branch=main']);git(['remote','add','origin','https://github.com/framework-fixture/blog.git']);
    const context={ciRepository:'framework-fixture/blog'};
    assert.equal(scanTree(root,context).findings.length,0);
    assert.ok(scanTree(root,{ciRepository:null}).findings.some(f=>f.category==='unreviewed-remote'));
    git(['remote','set-url','--push','origin','https://github.com/unapproved-fixture/blog']);
    assert.ok(scanTree(root,context).findings.some(f=>f.category==='unreviewed-remote'));
    git(['remote','set-url','--push','origin','https://github.com/framework-fixture/blog']);
    git(['config','url.https://unapproved.invalid/.insteadOf','https://github.com/']);
    assert.ok(scanTree(root,context).findings.some(f=>f.category==='unreviewed-remote'));
  }finally{removeTestRoot(root,'blog-release-');}
});

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'blog-release-'));
  const files=JSON.parse(readFileSync(join(ROOT,'release-files.json'),'utf8'));
  for(const file of files){const dest=join(root,file);mkdirSync(join(dest,'..'),{recursive:true});cpSync(join(ROOT,file),dest);}
  return {root,dispose(){removeTestRoot(root,'blog-release-');}};
}
function build(root){return spawnSync(process.execPath,['scripts/build.js'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});}

test('release admits only the exact root LICENSE and preserves its copyright and bytes',()=>{
  const f=fixture();try{
    const license=readFileSync(join(ROOT,'LICENSE'));
    assert.match(license.toString('utf8'),/Copyright \(c\) 2026 KagayakiHikari/);
    assert.ok(releaseFiles(f.root).includes('LICENSE'));
    for(const path of ['docs/LICENSE','LICENSE-OTHER']){
      const original=JSON.parse(readFileSync(join(f.root,'release-files.json'),'utf8'));
      writeFileSync(join(f.root,'release-files.json'),JSON.stringify([...original,path]));
      assert.throws(()=>releaseFiles(f.root),/Unsupported release entry/);
      writeFileSync(join(f.root,'release-files.json'),JSON.stringify(original));
    }
    assert.equal(build(f.root).status,0);
    assert.deepEqual(readFileSync(join(f.root,'dist/LICENSE')),license);
    assert.equal(JSON.parse(readFileSync(join(f.root,'dist/BUILD-MANIFEST.json'),'utf8')).LICENSE,createHash('sha256').update(license).digest('hex'));
  }finally{f.dispose();}
});

test('release policy rejects nested sensitive, hidden, unlisted and linked entries before output exists',()=>{
  for(const file of ['public/.env','docs/.hidden/notes.txt','public/unlisted.svg','src/extra.map']){
    const f=fixture();try{
      mkdirSync(join(f.root,file,'..'),{recursive:true});writeFileSync(join(f.root,file),'Synthetic release marker');
      assert.throws(()=>releaseFiles(f.root));assert.notEqual(build(f.root).status,0);assert.equal(existsSync(join(f.root,'dist')),false);
    }finally{f.dispose();}
  }
  const f=fixture();try{symlinkSync(join(f.root,'docs'),join(f.root,'public/link'),'junction');assert.throws(()=>releaseFiles(f.root),/linked/);}finally{f.dispose();}
});

test('release manifest rejects traversal, platform separators and case collisions',()=>{
  for(const extra of ['../outside.js','src\\outside.js','/outside.js','src/../outside.js','src/APP.js']){
    const f=fixture();try{const manifest=JSON.parse(readFileSync(join(f.root,'release-files.json'),'utf8'));manifest.push(extra);writeFileSync(join(f.root,'release-files.json'),JSON.stringify(manifest));assert.throws(()=>releaseFiles(f.root));}finally{f.dispose();}
  }
});

test('build rejects encoded secret in an admitted file and scans successful output',()=>{
  const f=fixture();try{
    const file=join(f.root,'docs/AUDIT.md'),saved=readFileSync(file),token='gh'+'p_'+'Q7z3'.repeat(10);
    writeFileSync(file,Buffer.from(token).toString('base64'));
    const blocked=build(f.root);assert.notEqual(blocked.status,0);assert.ok(!blocked.stdout.includes(token));assert.equal(existsSync(join(f.root,'dist')),false);
    writeFileSync(file,saved);const ready=build(f.root);assert.equal(ready.status,0,ready.stderr);assert.match(ready.stdout,/output scan passed/);
    const manifest=JSON.parse(readFileSync(join(f.root,'dist/BUILD-MANIFEST.json'),'utf8'));
    assert.equal(Object.keys(manifest).length,releaseFiles(f.root).length);
    assert.ok(manifest['third-party/lucide-LICENSE.txt']);
    assert.notEqual(build(f.root).status,0); // An existing output must be retained, not replaced.
  }finally{f.dispose();}
});
