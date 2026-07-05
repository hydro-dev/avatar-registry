import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import PQueue from 'p-queue';

const debug = process.argv[2]?.replace(/[（）]/g, '');
const queue = new PQueue({ concurrency: 1, autoStart: false });

const IMPORT_DIR = 'import';
const AVATAR_DIR = 'avatars';
const MIN_OUTPUT_SIDE = 512;
const MAX_OUTPUT_SIDE = 1024;
const WORKING_MAX_SIDE = 2048;
const SVG_MAX_DENSITY = 4096;
const ALPHA_THRESHOLD = 8;
const LIGHT_THRESHOLD = 245;
const EDGE_COVERAGE_MIN = 0.72;

type RawImage = {
  data: Buffer;
  width: number;
  height: number;
};

type BBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function cleanName(filename: string) {
  return path.parse(filename).name.replace(/[（）]/g, '').replace(/^\d+ ?/, '');
}

function supported(filename: string) {
  return /\.(png|webp|jpe?g|svg)$/i.test(filename);
}

function pixelOffset(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

function isNearWhite(r: number, g: number, b: number, a: number) {
  return a > ALPHA_THRESHOLD && r >= LIGHT_THRESHOLD && g >= LIGHT_THRESHOLD && b >= LIGHT_THRESHOLD;
}

function alphaBBox(data: Buffer | Uint8Array, width: number, height: number): BBox | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = pixelOffset(width, x, y);
      if (data[index + 3] > ALPHA_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < left || bottom < top) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

function floodEdgeConnected(candidate: Uint8Array, width: number, height: number) {
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (index: number) => {
    if (candidate[index] !== 1) return;
    candidate[index] = 2;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }
}

function clearEdgeLightBackground(image: RawImage) {
  const { data, width, height } = image;
  const candidate = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = pixelOffset(width, x, y);
      if (isNearWhite(data[index], data[index + 1], data[index + 2], data[index + 3])) {
        candidate[y * width + x] = 1;
      }
    }
  }

  floodEdgeConnected(candidate, width, height);

  let changed = 0;
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] !== 2) continue;
    const pixel = index * 4;
    data[pixel] = 0;
    data[pixel + 1] = 0;
    data[pixel + 2] = 0;
    data[pixel + 3] = 0;
    changed++;
  }
  return changed;
}

function outerAngleCoverage(image: RawImage, bbox: BBox) {
  const { data, width, height } = image;
  const boxWidth = bbox.right - bbox.left;
  const boxHeight = bbox.bottom - bbox.top;
  const cx = (bbox.left + bbox.right - 1) / 2;
  const cy = (bbox.top + bbox.bottom - 1) / 2;
  const rx = boxWidth / 2;
  const ry = boxHeight / 2;
  let hits = 0;
  const angles = 360;

  for (let degree = 0; degree < angles; degree++) {
    const theta = degree * Math.PI / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    let hit = false;
    for (let percent = 72; percent <= 104; percent += 2) {
      const radius = percent / 100;
      const x = Math.round(cx + cos * rx * radius);
      const y = Math.round(cy + sin * ry * radius);
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (data[pixelOffset(width, x, y) + 3] > ALPHA_THRESHOLD) {
        hit = true;
        break;
      }
    }
    if (hit) hits++;
  }

  return hits / angles;
}

function isCircularSeal(image: RawImage) {
  const bbox = alphaBBox(image.data, image.width, image.height);
  if (!bbox) return false;
  const boxWidth = bbox.right - bbox.left;
  const boxHeight = bbox.bottom - bbox.top;
  const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight);
  return aspect >= 0.9 && outerAngleCoverage(image, bbox) >= EDGE_COVERAGE_MIN;
}

function fillEnclosedTransparency(image: RawImage) {
  const { data, width, height } = image;
  const candidate = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[pixelOffset(width, x, y) + 3] <= ALPHA_THRESHOLD) {
        candidate[y * width + x] = 1;
      }
    }
  }

  floodEdgeConnected(candidate, width, height);

  let changed = 0;
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] !== 1) continue;
    const pixel = index * 4;
    data[pixel] = 255;
    data[pixel + 1] = 255;
    data[pixel + 2] = 255;
    data[pixel + 3] = 255;
    changed++;
  }
  return changed;
}

function extractWithPadding(image: RawImage, bbox: BBox) {
  const boxWidth = bbox.right - bbox.left;
  const boxHeight = bbox.bottom - bbox.top;
  const pad = Math.max(2, Math.round(Math.max(boxWidth, boxHeight) * 0.02));
  const width = boxWidth + pad * 2;
  const height = boxHeight + pad * 2;
  const data = Buffer.alloc(width * height * 4);

  for (let y = bbox.top; y < bbox.bottom; y++) {
    for (let x = bbox.left; x < bbox.right; x++) {
      const src = pixelOffset(image.width, x, y);
      const dst = pixelOffset(width, x - bbox.left + pad, y - bbox.top + pad);
      data[dst] = image.data[src];
      data[dst + 1] = image.data[src + 1];
      data[dst + 2] = image.data[src + 2];
      data[dst + 3] = image.data[src + 3];
    }
  }

  return { data, width, height };
}

function cleanTransparentRgb(data: Buffer | Uint8Array) {
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] !== 0) continue;
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
  }
}

async function createSharpInput(filePath: string, ext: string) {
  const options: sharp.SharpOptions = { failOn: 'none', limitInputPixels: false };
  if (ext !== '.svg') return sharp(filePath, options);

  const baseMetadata = await sharp(filePath, { ...options, density: 72 }).metadata();
  const baseMax = Math.max(baseMetadata.width || 0, baseMetadata.height || 0, 1);
  const density = Math.max(72, Math.min(SVG_MAX_DENSITY, Math.round(72 * WORKING_MAX_SIDE / baseMax)));
  return sharp(filePath, { ...options, density });
}

async function loadWorkingImage(filePath: string): Promise<RawImage> {
  const ext = path.extname(filePath).toLowerCase();
  const input = await createSharpInput(filePath, ext);
  const metadata = await input.metadata();
  const maxSide = Math.max(metadata.width || 0, metadata.height || 0);
  let pipeline = input.clone().rotate().ensureAlpha();

  if (maxSide > WORKING_MAX_SIDE) {
    pipeline = pipeline.resize({
      width: WORKING_MAX_SIDE,
      height: WORKING_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function resizeToOutput(image: RawImage) {
  const maxSide = Math.max(image.width, image.height);
  const targetMaxSide = Math.max(MIN_OUTPUT_SIDE, Math.min(MAX_OUTPUT_SIDE, maxSide));
  const scale = targetMaxSide / maxSide;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const { data, info } = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  cleanTransparentRgb(data);
  return { data, width: info.width, height: info.height };
}

async function processFile(file: fs.Dirent) {
  const name = cleanName(file.name);
  if (debug && name !== debug) return;

  const inputPath = path.join(IMPORT_DIR, file.name);
  const outputPath = path.join(AVATAR_DIR, `${name}.webp`);
  const image = await loadWorkingImage(inputPath);
  const clearedPixels = clearEdgeLightBackground(image);
  const filledPixels = isCircularSeal(image) ? fillEnclosedTransparency(image) : 0;
  cleanTransparentRgb(image.data);

  const bbox = alphaBBox(image.data, image.width, image.height);
  if (!bbox) throw new Error('empty image after background cleanup');

  const cropped = extractWithPadding(image, bbox);
  const resized = await resizeToOutput(cropped);

  await sharp(resized.data, {
    raw: { width: resized.width, height: resized.height, channels: 4 },
  })
    .webp({ lossless: true, effort: 6 })
    .toFile(outputPath);

  console.log(
    'Processed',
    file.name,
    '->',
    outputPath,
    `${resized.width}x${resized.height}`,
    `cleared=${clearedPixels}`,
    `filled=${filledPixels}`,
  );
}

async function main() {
  const files = fs
    .readdirSync(IMPORT_DIR, { withFileTypes: true })
    .filter(file => file.isFile() && supported(file.name));

  for (const file of files) {
    queue.add(async () => {
      try {
        await processFile(file);
      } catch (e) {
        console.error(file.name, e);
      }
    });
  }

  queue.start();
  await queue.onIdle();
}

main().catch(console.error);
