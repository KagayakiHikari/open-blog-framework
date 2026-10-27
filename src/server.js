import { config } from './config.js';
import { createApp } from './app.js';

try {
  const c=config();
  const app=await createApp(c);
  // One process per data directory; do not run this entry point in a cluster.
  app.server.listen(c.port,c.host,()=>console.log(`Blog listening at ${c.origin}`));
  app.server.on('error',()=>{console.error('Listener failed; verify the configured port.');process.exitCode=1;app.close();});
  const stop=()=>app.close().then(()=>process.exit(0));
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
} catch { console.error('Startup rejected. Verify local configuration and dedicated data directory.');process.exitCode=1; }
