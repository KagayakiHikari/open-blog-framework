import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const standardHosts = new Set(['registry.npmjs.org','nodejs.org','github.com','www.w3.org','www.sitemaps.org','sharp.pixelplumbing.com','opensource.org','apache.org']);
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['provider-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/],
  ['jwt-literal', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/],
  ['credential-url', /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^\s"'`]+/],
  ['http-url-credentials', /https?:\/\/[^\s/:@]+:[^\s/@]+@/],
  ['windows-user-path', /[A-Za-z]:[\\/]Users[\\/][^\s/\\"']+/],
  ['unix-private-path', /\/(?:home|Users)\/[a-zA-Z0-9_.-]+\//],
  ['literal-secret-assignment', /\b(?:JWT_SECRET|SESSION_SECRET|API_KEY|DATABASE_PASSWORD|SSH_PASSWORD)\s*[:=]\s*["'][^"'\r\n]{8,}["']/]
];
export const forbiddenArtifact = name => /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:sqlite\w*|db|pem|key|p12|pfx|zip|gz|tgz|7z|map|log))$/i.test(name) && !['.env.example','dist/.env.example'].includes(name);

export function scanBytes(buffer, location, privateHashes = new Set()) {
  const findings = [], seen = new Set(), queue = [{text:buffer.toString('utf8'), encoding:'plain', depth:0}];
  let decodedBytes = 0, candidates = 0, budgetExceeded = false;
  const add = (category, encoding = 'plain', severity = 'high') => {
    const key = category + ':' + encoding;
    if (!seen.has(key)) { seen.add(key); findings.push({location, category, severity, encoding}); }
  };
  if (buffer.includes(0) || !Buffer.from(buffer.toString('utf8')).equals(buffer)) add('unexpected-binary');
  if (queue[0].text.startsWith('version https://git-lfs.github.com/spec/v1')) add('unreviewed-lfs-pointer');
  const enqueue = (text, encoding, depth) => {
    if (text.includes('\ufffd')) return;
    const bytes = Buffer.byteLength(text);
    if (++candidates > 256 || decodedBytes + bytes > 1024 * 1024) { budgetExceeded = true; return; }
    decodedBytes += bytes; queue.push({text, encoding, depth});
  };
  for (let at = 0; at < queue.length; at++) {
    const {text, encoding, depth} = queue[at];
    for (const [category, rule] of rules) if (rule.test(text)) add(category, encoding);
    for (const match of text.matchAll(/https?:\/\/([^\s/<>"'`]+)|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/gi)) {
      const value = (match[1] || match[0]).toLowerCase();
      if (standardHosts.has(value) || /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|example\.(com|org)|[^\s]+\.invalid)(:\d+)?$/.test(value)) continue;
      if (privateHashes.has(createHash('sha256').update(value).digest('hex'))) add('private-system-identifier',encoding);
      else if (match[0].includes('@') && !/example\.(?:com|org|invalid)$/.test(value)) add('email-reference',encoding,'review');
      else if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(n=>Number(n)<=255) && !location.includes('package-lock.json')) add('ip-reference',encoding,'review');
    }
    for (const match of text.matchAll(/\b(?:password|token|secret|apiKey)\s*[:=]\s*["']([^"'\r\n]{20,})["']/gi)) {
      if (!/^(?:Synthetic|synthetic|a{20,}|b{20,})/.test(match[1])) add('credential-literal-review',encoding,'review');
    }
    if (depth >= 2) continue;
    for (const match of text.matchAll(/(?:[A-Za-z0-9_.:/+-]|%[a-f0-9]{2}){6,}/gi)) {
      if (match[0].includes('%') && match[0].length <= 65536) try { enqueue(decodeURIComponent(match[0]),encoding+'>url',depth+1); } catch {}
    }
    if (/\\(?:u[\da-f]{4}|x[\da-f]{2})/i.test(text) && text.length <= 262144) enqueue(text.replace(/\\u([\da-f]{4})|\\x([\da-f]{2})/gi,(_,a,b)=>String.fromCharCode(parseInt(a||b,16))),encoding+'>escape',depth+1);
    for (const match of text.matchAll(/(?<![\w+\/-])[A-Za-z0-9+\/_-]{20,}={0,2}(?![\w+\/-])/g)) {
      if (match[0].length > 65536) { add('oversized-encoded-token',encoding,'review'); continue; }
      const bytes = Buffer.from(match[0],'base64');
      if (bytes.length && [...bytes].filter(n=>n===9||n===10||n===13||n>=32&&n<127).length/bytes.length > .9) enqueue(bytes.toString('utf8'),encoding+'>base64',depth+1);
    }
    for (const match of text.matchAll(/\b(?:[a-f0-9]{2}){12,32768}\b/gi)) {
      const bytes = Buffer.from(match[0],'hex');
      if ([...bytes].filter(n=>n>=32&&n<127).length/bytes.length > .9) enqueue(bytes.toString('utf8'),encoding+'>hex',depth+1);
    }
  }
  if (budgetExceeded) add('decode-budget-exceeded','bounded-decoding','review');
  return findings;
}

// Only Git's unambiguous identity headers may receive a public-identity review.
// Scan the address separately so no finding elsewhere in the object is suppressed.
function scanGitIdentityObject(buffer, type, location, privateHashes) {
  const text = buffer.toString('utf8');
  if (!Buffer.from(text).equals(buffer)) return {findings:scanBytes(buffer,location,privateHashes), reviews:[]};
  const boundary = text.indexOf('\n\n');
  if (boundary < 0) return {findings:scanBytes(buffer,location,privateHashes), reviews:[]};
  const headers = text.slice(0,boundary).split('\n');
  const keys = type === 'commit' ? ['author','committer'] : ['tagger'];
  const selected = [];
  for (const key of keys) {
    const lines = headers.map((line,index)=>({line,index})).filter(({line})=>new RegExp('^'+key+'(?:\\s|$)').test(line));
    if (lines.length !== 1) continue;
    const match = lines[0].line.match(new RegExp('^'+key+' [^<>\\r\\n]+ <([1-9][0-9]*\\+[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?@users\\.noreply\\.github\\.com)> [0-9]+ [+-][0-9]{4}$'));
    if (match) selected.push({...lines[0],email:match[1]});
  }
  const reviews = [], findings = [];
  for (const item of selected) {
    const result = scanBytes(Buffer.from(item.email),location,privateHashes);
    for (const finding of result) {
      if (finding.category === 'email-reference' && finding.encoding === 'plain') reviews.push({...finding,field:headers[item.index].split(' ')[0]});
      else findings.push(finding);
    }
    headers[item.index] = item.line.replace(item.email,'PUBLIC_IDENTITY');
  }
  findings.push(...scanBytes(Buffer.from(headers.join('\n')+text.slice(boundary)),location,privateHashes));
  return {findings,reviews};
}

export function scanTree(root, {
  includeGit = true, privateHashes = new Set(),
  ciRepository = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_SERVER_URL === 'https://github.com' ? process.env.GITHUB_REPOSITORY : null
} = {}) {
  const findings = [], localMetadataReview = [], publicIdentityReview = []; let files = 0, blobs = 0, commits = 0, gitMetadataFiles = 0;
  const add = (location,category) => findings.push({location,category,severity:'high'});
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (directory === root && ['.git','node_modules'].includes(name)) continue;
      const file = join(directory,name), location = relative(root,file).replaceAll('\\','/'), info = lstatSync(file);
      if (info.isSymbolicLink()) { add(location,'symbolic-link-or-junction'); continue; }
      if (info.isDirectory()) { walk(file); continue; }
      if (!info.isFile()) { add(location,'non-regular-file'); continue; }
      files++;
      if (forbiddenArtifact(location)) add(location,'forbidden-artifact');
      if (info.size > 4*1024*1024) { add(location,'oversized-uninspected-file'); continue; }
      findings.push(...scanBytes(readFileSync(file),location,privateHashes));
    }
  }
  walk(root);
  let history = 'not-initialized';
  if (includeGit && existsSync(join(root,'.git'))) {
    if (!lstatSync(join(root,'.git')).isDirectory()) throw new Error('Review external Git directory before scanning');
    const run = (args,encoding='utf8') => { const r=spawnSync('git',['-C',root,...args],{encoding,maxBuffer:32*1024*1024,windowsHide:true}); if(r.status!==0)throw new Error('Git scan failed'); return r.stdout; };
    if (/^(?:120000|160000) /m.test(run(['ls-files','--stage']))) add('git-index','link-or-submodule');
    const expectedCiRemote=typeof ciRepository==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(ciRepository)?`https://github.com/${ciRepository}`.toLowerCase():null;
    for(const remote of run(['remote']).trim().split(/\r?\n/).filter(Boolean)) {
      // GitHub checkout's canonical origin is expected in CI, not a production dependency.
      // Resolve fetch/push rewrites locally and reject extra targets, credentials or noncanonical URLs.
      let approved=false;
      try {
        const urls=[...run(['remote','get-url','--all',remote]).trim().split(/\r?\n/),...run(['remote','get-url','--push','--all',remote]).trim().split(/\r?\n/)];
        approved=remote==='origin'&&!!expectedCiRemote&&urls.every(url=>url.replace(/\.git\/?$/,'').replace(/\/$/,'').toLowerCase()===expectedCiRemote);
      } catch {}
      if(!approved)add('git-config','unreviewed-remote');
    }
    for (const commit of run(['rev-list','--all']).trim().split(/\r?\n/).filter(Boolean)) {
      for (const file of run(['ls-tree','-r','--name-only',commit]).trim().split(/\r?\n/)) {
        if (forbiddenArtifact(file) || file === '.gitmodules') add(`git-tree:${commit.slice(0,12)}:${file}`,'historical-forbidden-path');
      }
    }
    function metadata(directory) {
      for (const name of readdirSync(directory)) {
        if (directory===join(root,'.git') && ['objects','lfs','index'].includes(name)) continue;
        const file=join(directory,name), info=lstatSync(file), location=relative(root,file).replaceAll('\\','/');
        if(info.isSymbolicLink()){add(location,'linked-git-metadata');continue;}
        if(info.isDirectory())metadata(file);
        else if(info.isFile()){
          gitMetadataFiles++;
          if(location.startsWith('.git/hooks/')&&!name.endsWith('.sample'))add(location,'active-git-hook');
          if(info.size>4*1024*1024)add(location,'oversized-git-metadata');
          else for(const result of scanBytes(readFileSync(file),location,privateHashes)) {
            // Reflogs are local administration records, not Git transfer objects or release files.
            // Keep unknown contact references visible for review; real secrets and private-hash
            // matches remain blocking, including inside reflogs. Never print the contact value.
            if(location.startsWith('.git/logs/')&&result.category==='email-reference')localMetadataReview.push(result);
            else findings.push(result);
          }
        }
      }
    }
    metadata(join(root,'.git'));
    if(existsSync(join(root,'.git/lfs')))add('git-lfs','unreviewed-lfs-storage');
    if(existsSync(join(root,'.git/objects/info/alternates')))add('git-alternates','external-object-storage');
    for (const line of run(['cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype) %(objectsize)']).trim().split(/\r?\n/).filter(Boolean)) {
      const [id,type,size] = line.split(' '), location = `git-object:${id.slice(0,12)}`;
      if (Number(size) > 4*1024*1024) { add(location,'oversized-uninspected-object'); continue; }
      if (type === 'tree') {
        if (/(?:120000|160000) /.test(run(['cat-file',type,id]))) add(location,'historical-link-or-submodule');
      } else if (['blob','commit','tag'].includes(type)) {
        const contents=run(['cat-file',type,id],null);
        if(type === 'commit' || type === 'tag') {
          const result=scanGitIdentityObject(contents,type,location,privateHashes);
          findings.push(...result.findings); publicIdentityReview.push(...result.reviews);
        } else findings.push(...scanBytes(contents,location,privateHashes));
        if (type === 'blob') blobs++; else if (type === 'commit') commits++;
      }
    }
    history = 'all-local-objects';
  }
  return {scope:'first-party files including hidden entries and dist; all local Git objects, historical paths and text metadata',excluded:'node_modules; native dependency analysis is separate; binary Git index inspected via Git APIs; .git must never be included in release archives',files,blobs,commits,gitMetadataFiles,history,privateComparison:privateHashes.size?'enabled':'not-configured',decoding:'depth<=2, tokens<=256/file, decoded<=1MiB/file; unsupported encodings and steganography require review',localMetadataReview,publicIdentityReview,findings};
}
