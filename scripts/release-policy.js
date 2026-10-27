import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { forbiddenArtifact } from './scan-core.js';

const releaseRoots = new Set(['src','scripts','migrations','public','docs','third-party']);
const hiddenRoots = new Set(['.npmrc','.env.example']);
export function releaseFiles(root) {
  const manifest = JSON.parse(readFileSync(join(root,'release-files.json'),'utf8'));
  if (!Array.isArray(manifest) || new Set(manifest).size !== manifest.length) throw new Error('Invalid release manifest');
  const normalized = new Set();
  for (const file of manifest) {
    if (typeof file !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(file) || file.includes('\\') || file.startsWith('/') || file.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error('Unsafe release path');
    if (file.split('/').some(p=>p.startsWith('.')) && !hiddenRoots.has(file)) throw new Error('Hidden release entry rejected');
    if (forbiddenArtifact(file) || file !== 'LICENSE' && !/\.(?:js|json|md|txt|sql|css|svg)$/.test(file.toLowerCase()) && !hiddenRoots.has(file)) throw new Error('Unsupported release entry');
    const key = file.toLowerCase(); if (normalized.has(key)) throw new Error('Case-colliding release paths'); normalized.add(key);
    let current = root;
    for (const segment of file.split('/')) { current=join(current,segment); if(lstatSync(current).isSymbolicLink())throw new Error('Linked release entry rejected'); }
    if (!lstatSync(current).isFile()) throw new Error('Non-regular release entry rejected');
  }
  const allowed = new Set(manifest);
  function inspect(directory, prefix) {
    for (const entry of readdirSync(directory,{withFileTypes:true})) {
      const file=prefix+'/'+entry.name, info=lstatSync(join(directory,entry.name));
      if (entry.name.startsWith('.') || info.isSymbolicLink()) throw new Error('Hidden or linked source entry rejected');
      if (info.isDirectory()) inspect(join(directory,entry.name),file);
      else if (!info.isFile() || !allowed.has(file)) throw new Error('Unlisted source entry rejected');
    }
  }
  for (const name of releaseRoots) inspect(join(root,name),name);
  return [...manifest].sort();
}
