import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import PQueue from 'p-queue';

const debug = process.argv[2]?.replace(/[（）()]/g, '');
const queue = new PQueue({ concurrency: 1, autoStart: false });

const IMPORT_DIR = 'import';
const AVATAR_DIR = 'avatars';
const MIN_OUTPUT_SIDE = 512;
const MAX_OUTPUT_SIDE = 1024;
const WORKING_MAX_SIDE = 2048;
const SVG_MAX_DENSITY = 4096;
const ALPHA_THRESHOLD = 8;
const LIGHT_THRESHOLD = 245;
const ENCLOSED_FILL_MIN_RATIO = 0.2;
const EXISTING_WHITE_ARTWORK_MIN_RATIO = 0.01;
const EXISTING_WHITE_ENCLOSED_FILL_MIN_RATIO = 0.25;
const ENCLOSED_FILL_INSET_RATIO = 8 / 1024;
const ENCLOSED_FILL_MIN_INSET = 2;
const execFileAsync = promisify(execFile);

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

type AlphaComponent = {
  bbox: BBox;
  size: number;
  total: number;
};

function cleanName(filename: string) {
  return path.parse(filename).name.replace(/[（）()]/g, '').replace(/^\d+ ?/, '');
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

function alphaBBox(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  threshold = ALPHA_THRESHOLD,
): BBox | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = pixelOffset(width, x, y);
      if (data[index + 3] > threshold) {
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

function exteriorSafetyBand(candidate: Uint8Array, width: number, height: number, radius: number) {
  const protectedPixels = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (index: number) => {
    if (protectedPixels[index]) return;
    protectedPixels[index] = 1;
    queue[tail++] = index;
  };

  // Edge-connected transparency is the real exterior. The image boundary is
  // also exterior, even when opaque artwork touches it; treating it as such
  // is equivalent to padding a mask with black before eroding it.
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] === 2) push(index);
  }
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  for (let distance = 0; distance < radius; distance++) {
    const levelEnd = tail;
    while (head < levelEnd) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);

      const left = x > 0;
      const right = x + 1 < width;
      const top = y > 0;
      const bottom = y + 1 < height;
      if (left) push(index - 1);
      if (right) push(index + 1);
      if (top) push(index - width);
      if (bottom) push(index + width);
      if (left && top) push(index - width - 1);
      if (right && top) push(index - width + 1);
      if (left && bottom) push(index + width - 1);
      if (right && bottom) push(index + width + 1);
    }
  }

  return protectedPixels;
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

function dominantAlphaComponent(image: RawImage, threshold = 128): AlphaComponent | null {
  const { data, width, height } = image;
  const visited = new Uint8Array(width * height);
  const componentQueue = new Int32Array(width * height);
  let total = 0;
  let largestSize = 0;
  let largestBBox: BBox | null = null;

  for (let index = 0; index < visited.length; index++) {
    if (data[index * 4 + 3] > threshold) total++;
  }

  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || data[start * 4 + 3] <= threshold) continue;

    let head = 0;
    let tail = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    visited[start] = 1;
    componentQueue[tail++] = start;

    const push = (index: number) => {
      if (visited[index] || data[index * 4 + 3] <= threshold) return;
      visited[index] = 1;
      componentQueue[tail++] = index;
    };

    while (head < tail) {
      const index = componentQueue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;

      if (x > 0) push(index - 1);
      if (x + 1 < width) push(index + 1);
      if (y > 0) push(index - width);
      if (y + 1 < height) push(index + width);
    }

    if (tail <= largestSize) continue;
    largestSize = tail;
    largestBBox = { left, top, right: right + 1, bottom: bottom + 1 };
  }

  if (!largestBBox) return null;
  return { bbox: largestBBox, size: largestSize, total };
}

function strictEllipseSealBBox(image: RawImage) {
  const component = dominantAlphaComponent(image);
  if (!component) return null;

  const { bbox } = component;
  const boxWidth = bbox.right - bbox.left;
  const boxHeight = bbox.bottom - bbox.top;
  const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight);
  if (aspect < 0.55 || component.size / component.total < 0.98) {
    return null;
  }

  const cx = (bbox.left + bbox.right - 1) / 2;
  const cy = (bbox.top + bbox.bottom - 1) / 2;
  const rx = boxWidth / 2;
  const ry = boxHeight / 2;
  let matchingAngles = 0;

  for (let degree = 0; degree < 360; degree++) {
    const theta = degree * Math.PI / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    let outerRadius = 0;

    for (let percent = 80; percent <= 106; percent++) {
      const radius = percent / 100;
      const x = Math.round(cx + cos * rx * radius);
      const y = Math.round(cy + sin * ry * radius);
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
      if (image.data[pixelOffset(image.width, x, y) + 3] > 128) {
        outerRadius = radius;
      }
    }

    if (outerRadius >= 0.97 && outerRadius <= 1.03) matchingAngles++;
  }

  return matchingAngles >= 342 ? bbox : null;
}

function fillEnclosedTransparency(image: RawImage) {
  const { data, width, height } = image;
  const candidate = new Uint8Array(width * height);
  let opaqueWhitePixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = pixelOffset(width, x, y);
      const alpha = data[pixel + 3];
      if (alpha <= ALPHA_THRESHOLD) {
        candidate[y * width + x] = 1;
      }
      if (
        alpha >= 240
        && data[pixel] >= LIGHT_THRESHOLD
        && data[pixel + 1] >= LIGHT_THRESHOLD
        && data[pixel + 2] >= LIGHT_THRESHOLD
      ) {
        opaqueWhitePixels++;
      }
    }
  }

  floodEdgeConnected(candidate, width, height);

  const bbox = alphaBBox(data, width, height);
  if (!bbox) return 0;
  const bboxArea = (bbox.right - bbox.left) * (bbox.bottom - bbox.top);

  const componentQueue = new Int32Array(width * height);
  let largestComponent = 0;
  let enclosedPixels = 0;

  for (let start = 0; start < candidate.length; start++) {
    if (candidate[start] !== 1) continue;

    let head = 0;
    let tail = 0;
    candidate[start] = 3;
    componentQueue[tail++] = start;

    const push = (index: number) => {
      if (candidate[index] !== 1) return;
      candidate[index] = 3;
      componentQueue[tail++] = index;
    };

    while (head < tail) {
      const index = componentQueue[head++];
      const x = index % width;
      const y = Math.floor(index / width);

      if (x > 0) push(index - 1);
      if (x + 1 < width) push(index + 1);
      if (y > 0) push(index - width);
      if (y + 1 < height) push(index + width);
    }

    largestComponent = Math.max(largestComponent, tail);
    enclosedPixels += tail;
  }

  const hasExistingWhiteArtwork = opaqueWhitePixels >= bboxArea * EXISTING_WHITE_ARTWORK_MIN_RATIO;
  const minimumFillRatio = hasExistingWhiteArtwork
    ? EXISTING_WHITE_ENCLOSED_FILL_MIN_RATIO
    : ENCLOSED_FILL_MIN_RATIO;
  if (
    largestComponent < bboxArea * minimumFillRatio
    && enclosedPixels < bboxArea * minimumFillRatio
  ) return 0;

  const fillInset = Math.max(
    ENCLOSED_FILL_MIN_INSET,
    Math.round(Math.max(width, height) * ENCLOSED_FILL_INSET_RATIO),
  );
  const protectedPixels = exteriorSafetyBand(candidate, width, height, fillInset);

  let changed = 0;
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] !== 3 || protectedPixels[index]) continue;
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
  const targetSide = Math.max(MIN_OUTPUT_SIDE, Math.min(MAX_OUTPUT_SIDE, maxSide));
  const scale = targetSide / maxSide;
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

function padToSquare(image: RawImage): RawImage {
  if (image.width === image.height) return image;

  const side = Math.max(image.width, image.height);
  const canvas = Buffer.alloc(side * side * 4);
  const left = Math.floor((side - image.width) / 2);
  const top = Math.floor((side - image.height) / 2);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = pixelOffset(image.width, x, y);
      const dst = pixelOffset(side, x + left, y + top);
      canvas[dst] = image.data[src];
      canvas[dst + 1] = image.data[src + 1];
      canvas[dst + 2] = image.data[src + 2];
      canvas[dst + 3] = image.data[src + 3];
    }
  }

  return { data: canvas, width: side, height: side };
}

function clipOutsideEllipse(image: RawImage, explicitBBox?: BBox, inset = 0) {
  const bbox = explicitBBox || alphaBBox(image.data, image.width, image.height, 128);
  if (!bbox) return 0;

  const cx = (bbox.left + bbox.right - 1) / 2;
  const cy = (bbox.top + bbox.bottom - 1) / 2;
  const rx = (bbox.right - bbox.left) / 2 + 0.5 - inset;
  const ry = (bbox.bottom - bbox.top) / 2 + 0.5 - inset;
  const edgeScale = Math.min(rx, ry);
  let changed = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = pixelOffset(image.width, x, y);
      const alpha = image.data[index + 3];
      if (alpha === 0) continue;

      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const coverage = Math.max(0, Math.min(1, (1 - distance) * edgeScale + 0.5));
      const clippedAlpha = Math.round(alpha * coverage);
      if (clippedAlpha === alpha) continue;

      image.data[index + 3] = clippedAlpha;
      if (clippedAlpha === 0) {
        image.data[index] = 0;
        image.data[index + 1] = 0;
        image.data[index + 2] = 0;
      }
      changed++;
    }
  }

  return changed;
}

async function writeExactWebp(image: RawImage, outputPath: string) {
  if (image.width !== image.height) {
    throw new Error(`refusing to write non-square avatar: ${image.width}x${image.height}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-import-'));
  const tempPng = path.join(tempDir, 'input.png');

  try {
    await sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png()
      .toFile(tempPng);

    await execFileAsync('magick', [
      tempPng,
      '-define',
      'webp:lossless=true',
      '-define',
      'webp:exact=true',
      '-define',
      'webp:method=6',
      outputPath,
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function processFile(file: fs.Dirent) {
  const name = cleanName(file.name);
  if (debug && name !== debug) return;

  const inputPath = path.join(IMPORT_DIR, file.name);
  const outputPath = path.join(AVATAR_DIR, `${name}.webp`);
  const image = await loadWorkingImage(inputPath);
  const clearedPixels = clearEdgeLightBackground(image);
  const filledPixels = fillEnclosedTransparency(image);
  const ellipseSealBBox = strictEllipseSealBBox(image);
  const ellipseSealInset = ellipseSealBBox
    ? Math.max(
      1,
      Math.round(
        Math.min(
          ellipseSealBBox.right - ellipseSealBBox.left,
          ellipseSealBBox.bottom - ellipseSealBBox.top,
        ) * 0.008,
      ),
    )
    : 0;
  const clippedPixels = ellipseSealBBox
    ? clipOutsideEllipse(image, ellipseSealBBox, ellipseSealInset)
    : 0;
  cleanTransparentRgb(image.data);

  const bbox = alphaBBox(image.data, image.width, image.height);
  if (!bbox) throw new Error('empty image after background cleanup');

  const cropped = extractWithPadding(image, bbox);
  const resized = await resizeToOutput(cropped);
  const squared = padToSquare(resized);
  cleanTransparentRgb(squared.data);

  await writeExactWebp(squared, outputPath);

  console.log(
    'Processed',
    file.name,
    '->',
    outputPath,
    `${squared.width}x${squared.height}`,
    `cleared=${clearedPixels}`,
    `filled=${filledPixels}`,
    `clipped=${clippedPixels}`,
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
