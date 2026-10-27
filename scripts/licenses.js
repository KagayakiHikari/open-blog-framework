import { readFileSync,readdirSync,existsSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.js';

const lock=JSON.parse(readFileSync(join(ROOT,'package-lock.json'),'utf8'));
const inventory=Object.entries(lock.packages).filter(([path])=>path).map(([path,entry])=>({package:path.replace(/^node_modules\//,''),version:entry.version,license:entry.license??'UNKNOWN',optional:!!entry.optional,integrity:entry.integrity??null}));
const native=[];
for(const [path] of Object.entries(lock.packages)){
  const file=join(ROOT,path,'versions.json');
  if(path.startsWith('node_modules/@img/')&&existsSync(file))native.push({package:path.replace(/^node_modules\//,''),components:JSON.parse(readFileSync(file,'utf8'))});
}
const report={inventory,nativeComponents:native,unverified:'License metadata is an inventory, not legal clearance. Native component notice/source obligations require human review before redistributing binaries.'};
if(process.argv.includes('--write'))writeFileSync(join(ROOT,'docs','dependency-inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({lockedPackages:inventory.length,unknownLicenses:inventory.filter(p=>p.license==='UNKNOWN').length,nativeBundles:native.length,licenseCounts:inventory.reduce((counts,p)=>(counts[p.license]=(counts[p.license]??0)+1,counts),{}),status:'REVIEW REQUIRED'},null,2));
if(inventory.some(p=>p.license==='UNKNOWN'))process.exitCode=1;
