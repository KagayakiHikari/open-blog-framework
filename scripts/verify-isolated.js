import { mkdtempSync,cpSync,rmSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { ROOT } from '../src/config.js';

const workspace=mkdtempSync(join(tmpdir(),'open-blog-independent-'));
let child;
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:workspace,TMP:workspace,TMPDIR:workspace};
const phases=[];
function run(args,{input,environment=env}={}){
  const result=spawnSync(process.execPath,args,{cwd:workspace,env:environment,input,encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000,windowsHide:true});
  if(result.status!==0){
    const error=new Error('Isolated command failed: '+(args[0]==='--test'?'tests':args[0].startsWith('scripts/')?args[0]:'dependency-install'));
    // Return only counts and project-relative test locations, never assertion payloads or credentials.
    if(args[0]==='--test')error.testDiagnostics={
      counts:[...result.stdout.matchAll(/(?:ℹ |# )(tests|pass|fail|cancelled|skipped) (\d+)/g)].map(m=>({kind:m[1],count:Number(m[2])})),
      locations:[...new Set(result.stdout.match(/test at tests[\\/][A-Za-z0-9_.-]+:\d+:\d+/g)??[])]
    };
    throw error;
  }
  return result.stdout;
}
try{
  cpSync(join(ROOT,'dist'),workspace,{recursive:true});
  cpSync(join(ROOT,'tests'),join(workspace,'tests'),{recursive:true});
  // npm itself is obtained from the local runtime, not the reference project.
  const executable=process.platform==='win32'?'where.exe':'which';
  const lookup=spawnSync(executable,[process.platform==='win32'?'npm.cmd':'npm'],{encoding:'utf8',env,windowsHide:true});
  if(lookup.status!==0)throw new Error('npm not available');
  const npmCommand=lookup.stdout.trim().split(/\r?\n/)[0];
  const npmCli=process.platform==='win32'?join(resolve(npmCommand,'..'),'node_modules','npm','bin','npm-cli.js'):resolve(npmCommand,'../../lib/node_modules/npm/bin/npm-cli.js');
  mkdirSync(join(workspace,'empty-npm'),{recursive:true});
  writeFileSync(join(workspace,'empty-npm','userconfig'),'');writeFileSync(join(workspace,'empty-npm','globalconfig'),'');
  const installEnv={...env,npm_config_userconfig:join(workspace,'empty-npm','userconfig'),npm_config_globalconfig:join(workspace,'empty-npm','globalconfig'),npm_config_cache:join(workspace,'npm-cache')};
  run([npmCli,'ci','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'],{environment:installEnv});phases.push('fresh-official-registry-install');
  run(['scripts/check.js']);phases.push('syntax');
  const tests=run(['--test','--test-concurrency=1','tests/*.test.js']);
  const count=tests.match(/(?:ℹ |# )tests (\d+)/)?.[1];phases.push(`automated-tests:${count??'completed'}`);
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const runtimeEnv={...env,BLOG_MODE:'test',BLOG_ORIGIN:`http://127.0.0.1:${port}`,BLOG_HOST:'127.0.0.1',BLOG_PORT:String(port)};
  run(['scripts/migrate.js'],{environment:runtimeEnv});run(['scripts/migrate.js'],{environment:runtimeEnv});phases.push('fresh-idempotent-migrations');
  const password=randomBytes(24).toString('base64url');
  run(['scripts/admin.js','create','syntheticadmin','admin'],{input:password,environment:runtimeEnv});phases.push('fresh-admin-initialization');
  child=spawn(process.execPath,['src/server.js'],{cwd:workspace,env:runtimeEnv,stdio:'ignore',windowsHide:true});
  let healthy=false;
  for(let i=0;i<50;i++){try{const r=await fetch(runtimeEnv.BLOG_ORIGIN+'/health');if(r.status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!healthy)throw new Error('Isolated server not healthy');
  const page=await fetch(runtimeEnv.BLOG_ORIGIN+'/login');const cookie=page.headers.getSetCookie()[0].split(';')[0],csrf=(await page.text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const auth=await fetch(runtimeEnv.BLOG_ORIGIN+'/login',{method:'POST',redirect:'manual',headers:{Origin:runtimeEnv.BLOG_ORIGIN,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'syntheticadmin',password,csrf})});
  if(auth.status!==200)throw new Error('Fresh login failed');phases.push('entrypoint-health-and-first-login');
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});child=undefined;
  console.log(JSON.stringify({status:'passed',phases,environment:'fresh temporary copy; no inherited application variables or private configuration',network:'package installation uses official npm registry; application smoke requests target only an ephemeral loopback port',limitations:'No OS packet capture or egress firewall enforcement; static review of runtime network imports is separate.'},null,2));
}catch(error){console.error(JSON.stringify({status:'failed',phases,reason:error.message,testDiagnostics:error.testDiagnostics}));process.exitCode=1;}
finally{
  if(child)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
  // Verify the absolute deletion target stays exactly inside the temporary parent.
  const tail=relative(resolve(tmpdir()),resolve(workspace));
  if(!tail.startsWith('open-blog-independent-')||tail.includes('..')||isAbsolute(tail)||/[\\/]/.test(tail))throw new Error('Temporary cleanup boundary rejected');
  rmSync(workspace,{recursive:true,force:true});
}
