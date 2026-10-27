import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { requireSupportedRuntime } from '../src/runtime.js';

requireSupportedRuntime();
function run(args) {
  const result=spawnSync(process.execPath,args,{cwd:ROOT,stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status||1);
}
const lookup=spawnSync(process.platform==='win32'?'where.exe':'which',[process.platform==='win32'?'npm.cmd':'npm'],{encoding:'utf8',windowsHide:true});
if(lookup.status!==0)throw new Error('npm is required for release verification');
const npmCommand=lookup.stdout.trim().split(/\r?\n/)[0];
const npmCli=process.env.npm_execpath || (process.platform==='win32'?join(dirname(npmCommand),'node_modules/npm/bin/npm-cli.js'):resolve(npmCommand,'../../lib/node_modules/npm/bin/npm-cli.js'));
run(['scripts/check.js']);
run(['--test','--test-concurrency=1','tests/*.test.js']);
run([npmCli,'audit','--omit=dev','--audit-level=low','--registry=https://registry.npmjs.org/']);
run(['scripts/licenses.js']);
run(['scripts/build.js']);
run(['scripts/scan.js']);
run(['scripts/verify-isolated.js']);
console.log('Automated release verification completed; license, history, reporting-channel and deployment approval remain manual.');
