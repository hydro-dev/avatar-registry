import sharp from 'sharp';
import fs from 'fs';
import PQueue from 'p-queue';
import os from 'os';
import crypto from 'crypto';
import child from 'child_process';

const md5 = (str: string) => crypto.createHash('md5').update(str).digest('hex');
const queue = new PQueue({ concurrency: os.cpus().length });
const target = process.argv[2];

async function main() {
    for (const file of fs.readdirSync('avatars')) {
        let [name, ext] = file.split('.');
        if (!name || !ext) continue;
        name = name.replace(/[（）]/g, '');
        queue.add(async () => {
            try {
                console.log('Processing', file);
                await sharp(`avatars/${file}`).toFormat('png', { quality: 80 }).toFile(`dist/${name}.png`);
                fs.copyFileSync(`avatars/${file}`, `dist/${name}.webp`);
            } catch (e) {
                console.error(file, e);
            }
        });
    }
    await queue.onIdle();
    for (const file of fs.readdirSync('dist')) {
        let [name, ext] = file.split('.');
        if (!name || !ext) continue;
        fs.copyFileSync(`dist/${file}`, `dist/${md5(name)}.${ext}`);
    }
    if (target) child.execSync(`scp -Or dist/* ${target}`, { stdio: 'inherit' });
}

main().catch(console.error);
