import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { writeFile, readFile, rename, rm, stat, readdir, statfs } from 'node:fs/promises';
import { fail } from './errors.js';
import { audit } from './db.js';
import { ROOT } from './config.js';

export function mediaService(c, db) {
  let busy = false;
  return {
    async cleanup(now = Date.now()) {
      // Only files created by this module, never follow links or remove unknown entries.
      for (const directory of ['tmp', 'media']) {
        for (const entry of await readdir(join(c.dataDir, directory), { withFileTypes: true })) {
          if (!entry.isFile() || !/^[a-f0-9-]{36}\.(input|webp)$/.test(entry.name)) continue;
          const file = join(c.dataDir, directory, entry.name);
          if ((await stat(file)).mtimeMs > now - 3600000) continue;
          if (directory === 'tmp' || !db.prepare('SELECT 1 FROM media WHERE filename=?').get(entry.name)) await rm(file, { force: true });
        }
      }
    },
    async upload(bytes, user) {
      if (busy) fail(429, 'Image processor busy', 5);
      busy = true;
      const id = randomUUID(), filename = `${id}.webp`;
      const input = join(c.dataDir, 'tmp', `${id}.input`), output = join(c.dataDir, 'tmp', filename), destination = join(c.dataDir, 'media', filename);
      let stored = false;
      try {
        if (bytes.length > 5 * 1024 * 1024 || bytes.length < 12) fail(400, 'Invalid image size');
        const signature = bytes.subarray(0, 12);
        if (!(signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || signature[0] === 255 && signature[1] === 216 && signature[2] === 255 || signature.toString('ascii',0,4) === 'RIFF' && signature.toString('ascii',8,12) === 'WEBP')) fail(400, 'PNG, JPEG or WebP required');
        const disk = await statfs(c.dataDir);
        if (disk.bavail * disk.bsize < 256 * 1024 * 1024) fail(503, 'Insufficient storage');
        await writeFile(input, bytes, { flag: 'wx', mode: 0o600 });
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['--max-old-space-size=96', join(ROOT, 'src', 'media-worker.js'), input, output], { windowsHide: true, stdio: 'ignore', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: join(c.dataDir, 'tmp'), TMP: join(c.dataDir, 'tmp'), TMPDIR: join(c.dataDir, 'tmp') } });
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 12000);
          child.once('error', () => { clearTimeout(timer); reject(new Error('Image worker unavailable')); });
          child.once('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve() : reject(new Error('Image decode rejected')); });
        });
        const info = await stat(output);
        if (info.size > 5 * 1024 * 1024) fail(400, 'Image output too large');
        await rename(output, destination);
        db.prepare('INSERT INTO media VALUES (?,?,?,?,?)').run(id, user.user_id, filename, info.size, Date.now());
        stored = true;
        audit(db, 'media_created', user.user_id, id);
        return { id, url: `/media/${filename}`, size: info.size };
      } catch (error) {
        if (error.status) throw error;
        fail(400, 'Image could not be processed');
      } finally {
        await Promise.all([rm(input, { force: true }), rm(output, { force: true }), stored ? Promise.resolve() : rm(destination, { force: true })]);
        busy = false;
      }
    },
    async get(filename) {
      if (!/^[a-f0-9-]{36}\.webp$/.test(filename) || !db.prepare('SELECT 1 FROM media WHERE filename=?').get(filename)) fail(404, 'Image not found');
      try { return await readFile(join(c.dataDir, 'media', filename)); } catch { fail(404, 'Image not found'); }
    },
    async delete(id, user) {
      const row = db.prepare('SELECT * FROM media WHERE id=?').get(id);
      if (!row) fail(404, 'Image not found');
      if (user.role !== 'admin' && row.user_id !== user.user_id) fail(403, 'Image access denied');
      db.prepare('DELETE FROM media WHERE id=?').run(id);
      // A crash leaves an unserved orphan; cleanup will remove it after one hour.
      await rm(join(c.dataDir, 'media', row.filename), { force: true });
      audit(db, 'media_deleted', user.user_id, id);
    }
  };
}
