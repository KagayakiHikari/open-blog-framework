import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.js';

test('redacted scanner detects working tree, private hashes and removed Git secrets',()=>{
  const temp=mkdtempSync(join(tmpdir(),'open-blog-scanner-')),root=join(temp,'fixture');
  try{
    for(const dir of ['src','scripts'])mkdirSync(join(root,dir),{recursive:true});
    copyFileSync(join(ROOT,'scripts','scan.js'),join(root,'scripts','scan.js'));copyFileSync(join(ROOT,'src','config.js'),join(root,'src','config.js'));copyFileSync(join(ROOT,'src','design.js'),join(root,'src','design.js'));
    copyFileSync(join(ROOT,'src','runtime.js'),join(root,'src','runtime.js'));
    copyFileSync(join(ROOT,'scripts','scan-core.js'),join(root,'scripts','scan-core.js'));
    writeFileSync(join(root,'package.json'),'{"type":"module"}');
    const scan=env=>spawnSync(process.execPath,[join(root,'scripts','scan.js')],{encoding:'utf8',env:{...process.env,...env},windowsHide:true});
    assert.equal(scan().status,0);
    const token='ghp_'+'A'.repeat(36),value='private-correlation.test';
    writeFileSync(join(root,'fixture.txt'),token+'\nhttps://'+value+'/\n'+Buffer.from(token).toString('base64'));
    const hashes=join(temp,'identifiers.json');writeFileSync(hashes,JSON.stringify([createHash('sha256').update(value).digest('hex')]));
    const found=scan({BLOG_PRIVATE_IDENTIFIERS:hashes});assert.equal(found.status,1);assert.doesNotMatch(found.stdout,new RegExp(token+'|'+value));const report=JSON.parse(found.stdout);assert.ok(report.findings.some(f=>f.category==='provider-token'));assert.ok(report.findings.some(f=>f.category==='private-system-identifier'));
    const git=args=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};
    git(['init','--initial-branch=main']);git(['add','.']);git(['-c','user.name=Fixture Maintainer','-c','user.email=maintainer@example.invalid','-c','commit.gpgsign=false','commit','-m','Synthetic scanner fixture']);
    unlinkSync(join(root,'fixture.txt'));git(['add','-u']);git(['-c','user.name=Fixture Maintainer','-c','user.email=maintainer@example.invalid','-c','commit.gpgsign=false','commit','-m','Remove synthetic fixture']);
    const history=scan();assert.equal(history.status,1);assert.ok(JSON.parse(history.stdout).findings.some(f=>f.location.startsWith('git-object:')&&f.category==='provider-token'&&f.encoding.includes('base64')));
    assert.doesNotMatch(history.stdout,new RegExp(token));
  }finally{rmSync(temp,{recursive:true,force:true});}
});
