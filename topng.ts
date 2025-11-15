import sharp from 'sharp';
import fs from 'fs';
import PQueue from 'p-queue';
import os from 'os';

const queue = new PQueue({ concurrency: os.cpus().length });

async function main() {
    for (const file of fs.readdirSync('avatars')) {
        let [name, ext] = file.split('.');
        if (!name || !ext) continue;
        name = name.replace(/[（）]/g, '');
        queue.add(async () => {
            try {
                console.log('Processing', file);
                await sharp(`avatars/${file}`).toFormat('png', { quality: 80 }).toFile(`png/${name}.png`);
            } catch (e) {
                console.error(file, e);
            }
        });
    }
}

main().catch(console.error);
