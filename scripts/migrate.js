import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
try { const db=openDatabase(config());const count=db.prepare('SELECT count(*) AS n FROM migrations').get().n;db.close();console.log(`Database ready; ${count} migrations recorded.`); }
catch { console.error('Migration rejected; verify the dedicated local data directory.');process.exitCode=1; }
