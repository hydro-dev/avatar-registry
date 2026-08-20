import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PQueue from 'p-queue';
import sharp from 'sharp';
import { loadAvatarRegistry } from './src/avatarRegistry';

// Usage: yarn topng:name [--force] | yarn topng:id [--force]
const args = process.argv.slice(2).filter(a => a !== '--force');
const mode = args[0] ?? 'name';
if (args.length > 1 || (mode !== 'name' && mode !== 'id')) throw new Error('Invalid arguments');
const force = process.argv.includes('--force');

const registry = loadAvatarRegistry();
const queue = new PQueue({ concurrency: os.availableParallelism() });

fs.mkdirSync('png', { recursive: true });
for (const file of fs.readdirSync('avatars')) {
  if (!file.endsWith('.webp')) continue;
  const filename = path.parse(file).name;
  const aliases = registry.get(filename);
  if (mode === 'id' && !aliases?.[1]) throw new Error(`WebP file has no id alias: ${file}`);
  const target = `png/${mode === 'id' ? aliases![1] : filename}.png`;
  if (!force && fs.existsSync(target) && fs.statSync(`avatars/${file}`).mtimeMs <= fs.statSync(target).mtimeMs) continue;
  queue.add(() => sharp(`avatars/${file}`).toFormat('png', { quality: 80 }).toFile(target)
    .then(() => console.log('Converting', file, '->', target))
    .catch(e => console.error(file, e)));
}
queue.onIdle().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
