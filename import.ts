import sharp from 'sharp';
import fs from 'fs';

async function main() {
  for (const file of fs.readdirSync('import')) {
    let [name, ext] = file.split('.');
    if (!name || !ext) continue;
    name = name.replace(/[（）]/g, '');
    try {
      await sharp(`import/${file}`)
        .toFormat('webp')
        .toFile(`avatars/${name}.webp`);
    } catch (e) {
      console.error(file, e);
    }
  }
}

main().catch(console.error);
