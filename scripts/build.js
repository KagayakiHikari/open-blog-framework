import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';
import { requireSupportedRuntime } from '../src/runtime.js';
import { releaseFiles } from './release-policy.js';
import { scanTree } from './scan-core.js';

requireSupportedRuntime();
const out=join(ROOT,'dist');
if(existsSync(out))throw new Error('Use a clean checkout for each build; existing dist is retained');
const files=releaseFiles(ROOT);
const privateHashes=new Set(process.env.BLOG_PRIVATE_IDENTIFIERS?JSON.parse(readFileSync(process.env.BLOG_PRIVATE_IDENTIFIERS,'utf8')):[]);
function verified(report){if(report.findings.length){console.error(JSON.stringify(report,null,2));throw new Error('Release scan rejected the candidate');}}
verified(scanTree(ROOT,{privateHashes}));
if(spawnSync(process.execPath,[join(ROOT,'scripts/check.js')],{stdio:'inherit',windowsHide:true}).status!==0)process.exit(1);
mkdirSync(out,{mode:0o700});
const manifest={};
for(const file of files){
  const source=join(ROOT,file),target=join(out,file);
  mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
  manifest[file]=createHash('sha256').update(readFileSync(target)).digest('hex');
}
writeFileSync(join(out,'BUILD-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
verified(scanTree(out,{includeGit:false,privateHashes}));
console.log('Build verified: '+files.length+' explicit files; output scan passed. Human release review remains required.');
