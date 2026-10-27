import { readFileSync } from 'node:fs';
import { ROOT } from '../src/config.js';
import { requireSupportedRuntime } from '../src/runtime.js';
import { scanTree } from './scan-core.js';

requireSupportedRuntime();
// Supply only reviewed hashes locally; never configure private identifiers in public CI.
const hashes = new Set(process.env.BLOG_PRIVATE_IDENTIFIERS ? JSON.parse(readFileSync(process.env.BLOG_PRIVATE_IDENTIFIERS,'utf8')) : []);
const report = scanTree(ROOT,{privateHashes:hashes});
console.log(JSON.stringify(report,null,2));
if (report.findings.length) process.exitCode=1;
