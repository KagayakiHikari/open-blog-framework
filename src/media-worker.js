import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

sharp.cache(false);
sharp.concurrency(1);
try {
  const [input, output] = process.argv.slice(2);
  const decoder = sharp(input, { limitInputPixels: 16000000, sequentialRead: true, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error('Unsupported image');
  const result = await decoder.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  if (result.length > 5 * 1024 * 1024) throw new Error('Output exceeds budget');
  await writeFile(output, result, { flag: 'wx', mode: 0o600 });
} catch { process.exitCode = 1; }
