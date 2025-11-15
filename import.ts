import sharp from 'sharp';
import fs from 'fs';
import PQueue from 'p-queue';
import os from 'os';

const queue = new PQueue({ concurrency: os.cpus().length, autoStart: false });
const debug = process.argv[process.argv.length - 1];

// 检测图像是否为圆形logo
// 通过检查宽高比和边缘像素分布来判断
async function isCircularLogo(
  imageBuffer: Buffer,
  width: number,
  height: number,
): Promise<boolean> {
  // 1. 检查宽高比：圆形logo在trim后应该接近正方形
  const aspectRatio = Math.min(width, height) / Math.max(width, height);
  if (aspectRatio < 0.85) return false;
  // 2. 检查边缘像素分布，判断是否大致为圆形
  const { data } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2;
  const threshold = 10; // 白色检测阈值

  // 采样边缘像素，检查是否大致形成圆形
  const sampleCount = 32; // 采样32个点
  let circularPoints = 0;
  let totalSamples = 0;

  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * Math.PI * 2;
    // 从中心向外扫描，找到第一个非白色像素
    for (let radius = maxRadius * 0.85; radius <= maxRadius * 0.98; radius += 0.2) {
      const x = Math.round(centerX + Math.cos(angle) * radius);
      const y = Math.round(centerY + Math.sin(angle) * radius);

      if (x >= 0 && x < width && y >= 0 && y < height) {
        const pixelIndex = (y * width + x) * 4;
        if (pixelIndex >= 0 && pixelIndex < data.length) {
          const r = data[pixelIndex];
          const g = data[pixelIndex + 1];
          const b = data[pixelIndex + 2];
          const alpha = data[pixelIndex + 3];

          if (!isWhitePixel(r, g, b, alpha, threshold)) {
            // 计算这个点到中心的距离
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            // 如果距离接近当前半径，说明边缘大致是圆形的
            if (Math.abs(distance - radius) < maxRadius * 0.15) {
              circularPoints++;
            }
            totalSamples++;
            break;
          }
        }
      }
    }
  }

  // 如果超过60%的采样点符合圆形特征，认为是圆形logo
  const circularRatio = totalSamples > 0 ? circularPoints / totalSamples : 0;
  return circularRatio > 0.6 && aspectRatio > 0.9;
}

// 判断像素是否为白色（允许一定阈值）
function isWhitePixel(r: number, g: number, b: number, alpha: number, threshold = 10) {
  return r >= 255 - threshold && g >= 255 - threshold && b >= 255 - threshold || alpha === 0;
}

// 检查像素是否在狭窄的白色区域内（只有1~2个像素宽）
function isInNarrowWhiteRegion(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  threshold: number = 10,
): boolean {
  // 检查水平方向的连续白色像素数量
  let horizontalWidth = 1;
  // 向左检查
  for (let i = x - 1; i >= 0; i--) {
    const pixelIndex = (y * width + i) * 4;
    if (pixelIndex >= data.length) break;
    const r = data[pixelIndex];
    const g = data[pixelIndex + 1];
    const b = data[pixelIndex + 2];
    if (isWhitePixel(r, g, b, data[pixelIndex + 3], threshold)) {
      horizontalWidth++;
    } else {
      break;
    }
  }
  // 向右检查
  for (let i = x + 1; i < width; i++) {
    const pixelIndex = (y * width + i) * 4;
    if (pixelIndex >= data.length) break;
    const r = data[pixelIndex];
    const g = data[pixelIndex + 1];
    const b = data[pixelIndex + 2];
    if (isWhitePixel(r, g, b, data[pixelIndex + 3], threshold)) {
      horizontalWidth++;
    } else {
      break;
    }
  }

  // 检查垂直方向的连续白色像素数量
  let verticalWidth = 1;
  // 向上检查
  for (let i = y - 1; i >= 0; i--) {
    const pixelIndex = (i * width + x) * 4;
    if (pixelIndex >= data.length) break;
    const r = data[pixelIndex];
    const g = data[pixelIndex + 1];
    const b = data[pixelIndex + 2];
    if (isWhitePixel(r, g, b, data[pixelIndex + 3], threshold)) {
      verticalWidth++;
    } else {
      break;
    }
  }
  // 向下检查
  for (let i = y + 1; i < height; i++) {
    const pixelIndex = (i * width + x) * 4;
    if (pixelIndex >= data.length) break;
    const r = data[pixelIndex];
    const g = data[pixelIndex + 1];
    const b = data[pixelIndex + 2];
    if (isWhitePixel(r, g, b, data[pixelIndex + 3], threshold)) {
      verticalWidth++;
    } else {
      break;
    }
  }

  // 如果水平或垂直方向只有1~2个像素宽，认为是狭窄区域
  return horizontalWidth <= 2 || verticalWidth <= 2;
}

// 从指定点开始进行 flood fill，填充连续的白色区域为透明
function floodFillFrom(
  data: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Set<number>,
  threshold: number = 10,
): void {
  const queue: Array<[number, number]> = [];
  const startIndex = startY * width + startX;
  const startPixelIndex = startIndex * 4;

  // 检查起始点是否为白色
  if (startPixelIndex >= data.length) return;
  const r = data[startPixelIndex];
  const g = data[startPixelIndex + 1];
  const b = data[startPixelIndex + 2];

  if (!isWhitePixel(r, g, b, data[startPixelIndex + 3], threshold) || visited.has(startIndex)) {
    return;
  }

  // 如果起始点在狭窄区域内，跳过
  if (isInNarrowWhiteRegion(data, width, height, startX, startY, threshold)) {
    return;
  }

  queue.push([startX, startY]);
  visited.add(startIndex);

  // BFS flood fill
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const pixelIndex = (y * width + x) * 4;

    if (pixelIndex >= 0 && pixelIndex < data.length) {
      // 将像素设置为透明
      data[pixelIndex + 3] = 0; // alpha = 0
    }

    // 检查四个方向的邻居
    const directions = [
      [0, 1], // 下
      [0, -1], // 上
      [1, 0], // 右
      [-1, 0], // 左
    ];

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighborIndex = ny * width + nx;
        if (!visited.has(neighborIndex)) {
          const neighborPixelIndex = neighborIndex * 4;
          if (neighborPixelIndex < data.length) {
            const r = data[neighborPixelIndex];
            const g = data[neighborPixelIndex + 1];
            const b = data[neighborPixelIndex + 2];

            if (isWhitePixel(r, g, b, data[neighborPixelIndex + 3], threshold)) {
              // 如果邻居在狭窄区域内，跳过
              if (!isInNarrowWhiteRegion(data, width, height, nx, ny, threshold)) {
                visited.add(neighborIndex);
                queue.push([nx, ny]);
              }
            }
          }
        }
      }
    }
  }
}

// 平滑边缘，减少锯齿效果
function smoothEdges(data: Uint8Array, width: number, height: number) {
  const directions = [
    [0, 1], // 下
    [0, -1], // 上
    [1, 0], // 右
    [-1, 0], // 左
    [1, 1], // 右下
    [-1, -1], // 左上
    [1, -1], // 右上
    [-1, 1], // 左下
  ];

  // 创建边缘像素列表（非透明像素周围有透明像素的像素）
  const edgePixels: Array<[number, number]> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      if (pixelIndex >= data.length) continue;

      const alpha = data[pixelIndex + 3];

      // 检查非透明像素周围是否有透明像素（边缘像素）
      if (alpha > 0) {
        let hasTransparentNeighbor = false;
        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const neighborIndex = (ny * width + nx) * 4;
            if (neighborIndex < data.length && data[neighborIndex + 3] === 0) {
              hasTransparentNeighbor = true;
              break;
            }
          }
        }
        if (hasTransparentNeighbor) {
          edgePixels.push([x, y]);
        }
      }
    }
  }

  // 对边缘像素应用渐变透明度，创建平滑过渡
  for (const [x, y] of edgePixels) {
    let transparentCount = 0;
    let totalAlpha = 0;
    let neighborCount = 0;

    // 统计周围像素的透明度和非透明像素数量
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighborIndex = (ny * width + nx) * 4;
        if (neighborIndex < data.length) {
          const neighborAlpha = data[neighborIndex + 3];
          if (neighborAlpha === 0) {
            transparentCount++;
          } else {
            totalAlpha += neighborAlpha;
          }
          neighborCount++;
        }
      }
    }

    if (neighborCount > 0) {
      const pixelIndex = (y * width + x) * 4;
      if (pixelIndex < data.length) {
        // 根据周围透明像素的比例，调整边缘像素的 alpha 值
        // 透明像素越多，alpha 值越小，创建平滑过渡
        const transparencyRatio = transparentCount / neighborCount;
        const originalAlpha = data[pixelIndex + 3];
        // 根据透明像素比例，减少 alpha 值，但保持一定的可见度
        const newAlpha = Math.round(originalAlpha * (1 - transparencyRatio * 0.5));
        data[pixelIndex + 3] = Math.max(newAlpha, originalAlpha * 0.3); // 保持至少 30% 的原始透明度
      }
    }
  }
}

// 从所有边界点开始，使用透明油漆桶填充连续的白色区域
async function floodFillTransparent(
  imageBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const { data } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const threshold = 10; // 白色检测阈值
  const visited = new Set<number>(); // 记录已访问的像素
  for (let x = 0; x < width; x++) {
    floodFillFrom(data, width, height, x, 0, visited, threshold);
    floodFillFrom(data, width, height, x, height - 1, visited, threshold);
  }
  for (let y = 0; y < height; y++) {
    floodFillFrom(data, width, height, 0, y, visited, threshold);
    floodFillFrom(data, width, height, width - 1, y, visited, threshold);
  }
  smoothEdges(data, width, height);
  return await sharp(data, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function main() {
  const files = fs.readdirSync('import');
  for (const file of files) {
    let [name, ext] = file.split('.');
    if (!name || !ext) continue;
    name = name.replace(/[（）]/g, '');
    if (debug && name !== debug) continue;
    queue.add(async () => {
      try {
        console.log('Processing', file, `${files.length - queue.size}/${files.length}`);
        let image = sharp(`import/${file}`);

        // 先去除白色边缘，使用 trim 自动检测边界
        // background 指定要裁剪的背景色（白色），lineArt 可以更精确地检测边缘
        let trimmedImage = image
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .trim({
            background: { r: 255, g: 255, b: 255 }, // 白色背景
            threshold: 10, // 检测接近白色的像素的阈值（0-255），值越小越敏感
          });

        let trimmedMetadata = await trimmedImage.metadata();
        let trimmedWidth = trimmedMetadata.width || 0;
        let trimmedHeight = trimmedMetadata.height || 0;
        const size = Math.max(trimmedWidth, trimmedHeight); // 使用最大边作为正方形边长

        // 检测是否为圆形logo
        const trimmedBuffer = await trimmedImage.ensureAlpha().toBuffer();
        const isCircular = await isCircularLogo(trimmedBuffer, trimmedWidth, trimmedHeight);

        // 将裁剪后的图像调整到正方形，居中放置，透明部分用白色填充
        let processedImage = trimmedImage.resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }, // 白色背景填充透明部分
        });

        // 如果是圆形logo，应用圆形遮罩
        if (isCircular) {
          const radius = size / 2;

          // 创建圆形遮罩 SVG
          const maskSvg = `
            <svg width="${size}" height="${size}">
              <circle cx="${radius}" cy="${radius}" r="${radius}" fill="white"/>
            </svg>
          `;

          // 创建圆形遮罩图像
          const mask = sharp(Buffer.from(maskSvg))
            .resize(size, size)
            .toFormat('png');

          // 应用圆形遮罩，使圆形外的部分透明，圆形内的透明部分保持白色
          processedImage = processedImage.composite([
            {
              input: await mask.toBuffer(),
              blend: 'dest-in',
            },
          ]);
        } else {
          // 对于非圆形logo，使用透明油漆桶从(0,0)填充白色背景为透明
          // 直接使用 size，因为 resize 后的尺寸就是 size x size
          const processedBuffer = await processedImage.ensureAlpha().toBuffer();
          const floodFilledBuffer = await floodFillTransparent(
            processedBuffer,
            size,
            size,
          );
          // sharp 会自动识别 PNG buffer 的尺寸
          processedImage = sharp(floodFilledBuffer);
        }

        // 保存处理后的图像
        await processedImage.toFormat('webp').toFile(`avatars/${name}.webp`);
      } catch (e) {
        console.error(file, e);
      }
    });
  }
  queue.start();
}

main().catch(console.error);
