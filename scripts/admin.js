import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase, audit, transaction } from '../src/db.js';
import { passwordHash, revokeSessions } from '../src/security.js';

// Passwords are read from a pipe, never command arguments, environment or logs.
async function readPassword() {
  if(process.stdin.isTTY)throw new Error('Pipe a generated password through standard input');
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>258)throw new Error('Password too long');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'');
}
let db;
try {
  const [command,username,role='editor']=process.argv.slice(2);
  if(!['create','password','revoke'].includes(command)||!/^[a-zA-Z0-9_-]{3,40}$/.test(username??'')||!['admin','editor'].includes(role))throw new Error('Usage: npm run admin -- create|password|revoke USERNAME [admin|editor]');
  const encoded=command==='revoke'?null:await passwordHash(await readPassword());
  db=openDatabase(config());
  const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if(command==='create')transaction(db,()=>{
      if(user)throw new Error('Account already exists');
      const id=randomUUID();db.prepare('INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,?,?,?)').run(id,username,encoded,role,Date.now());audit(db,'user_created',null,id);
  });
  else {
    if(!user)throw new Error('Account does not exist');
    revokeSessions(db,user.id,encoded);
  }
  console.log('Local account operation completed.');
}catch(error){console.error(['Account already exists','Account does not exist'].includes(error.message)?error.message:'Account operation rejected. Use a valid command and pipe a unique password of at least 16 bytes when required.');process.exitCode=1;}
finally{db?.close();}
