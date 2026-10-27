import { HttpError, fail } from './errors.js';

// Anonymous login readers never consume the authenticated write budget.
// These are application-instance limits; peer traffic limits remain separate.
export function createBodyReader() {
  const active = { anonymous: 0, authenticated: 0 }, keys = new Set();
  return function readBody(req, max, { anonymous = false, key = '' } = {}) {
    const group = anonymous ? 'anonymous' : 'authenticated';
    if (active[group] >= (anonymous ? 2 : 4) || anonymous && keys.has(key)) fail(429, 'Request reader busy', 2);
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'Compressed bodies are unsupported');
    const declared = req.headers['content-length'];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) fail(413, 'Request body too large');
    active[group]++;
    if (anonymous) keys.add(key);
    return new Promise((resolve, reject) => {
      let size = 0, done = false, idle;
      const parts = [];
      const deadline = setTimeout(() => finish(new HttpError(408, 'Request body timed out')), anonymous ? 2000 : 15000);
      const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => finish(new HttpError(408, 'Request body timed out')), anonymous ? 750 : 3000); };
      function finish(error) {
        if (done) return;
        done = true; clearTimeout(deadline); clearTimeout(idle);
        req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', failed);
        active[group]--; if (anonymous) keys.delete(key);
        if (error) { req.pause(); req.once('error', () => {}); reject(error); }
        else resolve(Buffer.concat(parts));
      }
      function data(chunk) { size += chunk.length; if (size > max) finish(new HttpError(413, 'Request body too large')); else { parts.push(chunk); resetIdle(); } }
      function end() { finish(); }
      function aborted() { finish(new HttpError(400, 'Request cancelled')); }
      function failed() { finish(new HttpError(400, 'Request cancelled')); }
      req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', failed);
      resetIdle();
    });
  };
}
