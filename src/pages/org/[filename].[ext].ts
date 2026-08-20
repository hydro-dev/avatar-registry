import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { APIRoute, GetStaticPaths } from 'astro';

const AVATAR_DIR = 'avatars';

export const getStaticPaths = (() => fs
  .readdirSync(AVATAR_DIR)
  .map((file) => {
    const filename = path.parse(file).name;
    return [
      { params: { filename, ext: 'webp' }, props: { file } },
      { params: { filename, ext: 'png' }, props: { file } },
    ];
  })
  .flat()) satisfies GetStaticPaths;

export const GET: APIRoute<{ file: string }> = ({ params, props }) => {
  const source = fs.readFileSync(path.join(AVATAR_DIR, props.file));
  // png is generated on the fly to preserve transparency (jpg would flatten it)
  const body = params.ext === 'png' ? sharp(source).png() : source;
  return new Response(body, { headers: { 'Content-Type': `image/${params.ext}` } });
};
