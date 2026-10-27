import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { passwordHash } from '../src/security.js';

export function fixture(){
  const root=mkdtempSync(join(tmpdir(),'open-blog-test-'));
  const c=config({BLOG_MODE:'test',BLOG_PORT:'4300',BLOG_ORIGIN:'http://127.0.0.1:4300'},root);
  const db=openDatabase(c);
  return {root,c,db,dispose(){db.close();rmSync(root,{recursive:true,force:true});}};
}
export async function account(db,username='writer',role='admin',password='Synthetic-only-password-482!'){
  const id=randomUUID();db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,?,?)').run(id,username,await passwordHash(password),role,Date.now());
  return {user_id:id,username,role,password};
}
export const sample=(overrides={})=>({title:'A synthetic article',slug:'synthetic-article',summary:'A fictional description.',content:'# Hello\n\nA **synthetic** publication.',tags:['example'],status:'draft',...overrides});

export function removeTestRoot(root, prefix) {
  const target=resolve(root),tail=relative(resolve(tmpdir()),target);
  if(!tail.startsWith(prefix)||tail.includes('..')||isAbsolute(tail)||/[\\/]/.test(tail))throw new Error('Test cleanup boundary rejected');
  rmSync(target,{recursive:true,force:true});
}
