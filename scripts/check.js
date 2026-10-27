import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';
import { requireSupportedRuntime } from '../src/runtime.js';

requireSupportedRuntime();

let count=0;
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.js')){count++;const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});if(result.status!==0){console.error('Syntax check failed:',file);process.exitCode=1;}}}}
for(const dir of ['src','scripts','tests','public'])if(existsSync(join(ROOT,dir)))walk(join(ROOT,dir));
console.log(`${count} JavaScript files checked.`);
