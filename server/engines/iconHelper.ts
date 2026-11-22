import { Resvg } from '@resvg/resvg-js';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { validateSafePublicUrl } from '../security.ts';

const execFileAsync = promisify(execFile);

function safeHex(color: string | undefined, fallback: string): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color.trim()) ? color.trim() : fallback;
}

function hexLuminance(hex: string): number {
  const clean = safeHex(hex, '#1D4ED8').slice(1);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbStringToHex(pixelStr: string): string | null {
  const hexMatch = pixelStr.match(/#[0-9a-fA-F]{6}/);
  if (hexMatch) return hexMatch[0].toUpperCase();
  const rgbMatch = pixelStr.match(/srgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbMatch) return null;
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(Number(rgbMatch[1]))}${toHex(Number(rgbMatch[2]))}${toHex(Number(rgbMatch[3]))}`.toUpperCase();
}

function looksLikeHtml(buf: Buffer): boolean {
  const head = buf.subarray(0, 300).toString('utf8').trimStart().toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body')
  );
}

export function detectImageExtension(buf: Buffer, hint?: string): string {
  if (buf.length >= 4) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
    if (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'webp';
    }
    if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
    if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00) {
      return 'ico';
    }
  }
  const headText = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (headText.includes('<svg')) return 'svg';

  const h = (hint || '').toLowerCase();
  if (h.includes('svg')) return 'svg';
  if (h.includes('png')) return 'png';
  if (h.includes('jpeg') || h.includes('jpg')) return 'jpg';
  if (h.includes('webp')) return 'webp';
  if (h.includes('x-icon') || h.includes('vnd.microsoft.icon') || h.endsWith('.ico')) return 'ico';
  if (h.includes('gif')) return 'gif';
  if (h.includes('bmp')) return 'bmp';
  return 'png';
}

async function resolveLocalViteAsset(sourceUrl: string): Promise<string | null> {
  const cleanPath = sourceUrl.split('?')[0].split('#')[0];
  if (cleanPath.startsWith('/')) {
    const publicPath = path.resolve(process.cwd(), 'public', cleanPath.slice(1));
    if (publicPath.startsWith(path.resolve(process.cwd(), 'public'))) {
      try {
        await fs.access(publicPath);
        return publicPath;
      } catch {
        // fall through
      }
    }
  }
  if (cleanPath.startsWith('/src/assets/')) {
    const localPath = path.resolve(process.cwd(), cleanPath.slice(1));
    if (localPath.startsWith(path.resolve(process.cwd(), 'src', 'assets'))) {
      try {
        await fs.access(localPath);
        return localPath;
      } catch {
        // fall through
      }
    }
  }
  if (cleanPath.startsWith('/assets/')) {
    const distAsset = path.resolve(process.cwd(), 'dist', cleanPath.slice(1));
    try {
      await fs.access(distAsset);
      return distAsset;
    } catch {
      const base = path.basename(cleanPath).replace(/-[A-Za-z0-9_-]{6,}(\.[a-z0-9]+)$/i, '$1');
      const fallbackSrc = path.resolve(process.cwd(), 'src', 'assets', 'images', base);
      try {
        await fs.access(fallbackSrc);
        return fallbackSrc;
      } catch {
        // ignore
      }
    }
  }
  if (cleanPath.includes('appforge_default_icon')) {
    const defPath = path.resolve(
      process.cwd(),
      'src',
      'assets',
      'images',
      'appforge_default_icon_1795292674430.jpg'
    );
    try {
      await fs.access(defPath);
      return defPath;
    } catch {
      // ignore
    }
  }
  if (cleanPath.includes('appforge_splash_backdrop')) {
    const splPath = path.resolve(
      process.cwd(),
      'src',
      'assets',
      'images',
      'appforge_splash_backdrop_1795292673414.jpg'
    );
    try {
      await fs.access(splPath);
      return splPath;
    } catch {
      // ignore
    }
  }
  return null;
}

async function fetchImageBuffer(
  sourceUrl: string
): Promise<{ buffer: Buffer; ext: string } | null> {
  const cleanUrl = (sourceUrl || '').trim();
  if (!cleanUrl) return null;
  try {
    if (cleanUrl.startsWith('data:image/')) {
      const comma = cleanUrl.indexOf(',');
      if (comma !== -1) {
        const meta = cleanUrl.slice(0, comma).toLowerCase();
        const body = cleanUrl.slice(comma + 1);
        const buf = meta.includes(';base64')
          ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
          : Buffer.from(decodeURIComponent(body), 'utf8');
        if (buf.length > 16 && !looksLikeHtml(buf)) {
          return { buffer: buf, ext: detectImageExtension(buf, meta) };
        }
      }
    } else if (cleanUrl.startsWith('/')) {
      const localAsset = await resolveLocalViteAsset(cleanUrl);
      if (localAsset) {
        const buf = await fs.readFile(localAsset);
        if (buf.length > 16 && !looksLikeHtml(buf)) {
          return { buffer: buf, ext: detectImageExtension(buf, localAsset) };
        }
      }
    } else if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
      const safe = await validateSafePublicUrl(cleanUrl);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const resp = await fetch(safe.toString(), {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'AppForgeStudio-AssetFetcher/1.0',
          Accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/*;q=0.8',
        },
      });
      clearTimeout(timer);
      if (resp.ok) {
        const ctype = (resp.headers.get('content-type') || '').toLowerCase();
        if (ctype.includes('text/html') || ctype.includes('application/json')) {
          return null;
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > 16 && !looksLikeHtml(buf)) {
          return { buffer: buf, ext: detectImageExtension(buf, `${ctype} ${resp.url || cleanUrl}`) };
        }
      }
    }
  } catch (err) {
    console.warn('Falha ao obter asset visual:', err);
    return null;
  }
  return null;
}

export async function rasterizeSvgBufferToPng(svgBuf: Buffer, targetWidth = 512): Promise<Buffer> {
  const resvg = new Resvg(svgBuf, {
    fitTo: { mode: 'width', value: targetWidth },
  });
  return resvg.render().asPng();
}

async function pickBestFrameIndex(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('identify', ['-format', '%p %w\n', filePath], {
      timeout: 5000,
    });
    let bestIdx = 0;
    let bestWidth = -1;
    for (const line of stdout.trim().split('\n')) {
      const [idxStr, wStr] = line.trim().split(/\s+/);
      const idx = Number(idxStr);
      const w = Number(wStr);
      if (Number.isFinite(idx) && Number.isFinite(w) && w > bestWidth) {
        bestWidth = w;
        bestIdx = idx;
      }
    }
    return bestIdx;
  } catch {
    return 0;
  }
}

export async function resolveIconToPng(
  iconUrl: string,
  primaryColor: string,
  _appName: string,
  outPngPath: string
): Promise<void> {
  const fetched = await fetchImageBuffer(iconUrl);

  if (fetched) {
    let inputPath = `${outPngPath}.input.${fetched.ext}`;
    try {
      if (fetched.ext === 'svg') {
        const pngBuf = await rasterizeSvgBufferToPng(fetched.buffer, 512);
        inputPath = `${outPngPath}.input.png`;
        await fs.writeFile(inputPath, pngBuf);
      } else {
        await fs.writeFile(inputPath, fetched.buffer);
      }

      const isMultiFrame = inputPath.endsWith('.ico') || inputPath.endsWith('.gif');
      const frameArg = isMultiFrame ? `${inputPath}[${await pickBestFrameIndex(inputPath)}]` : `${inputPath}[0]`;
      await execFileAsync(
        'convert',
        [
          '-background',
          'none',
          frameArg,
          '-alpha',
          'on',
          '-resize',
          '512x512',
          '-gravity',
          'center',
          '-extent',
          '512x512',
          `PNG32:${outPngPath}`,
        ],
        { timeout: 10000 }
      );
      const st = await fs.stat(outPngPath);
      if (st.size > 0) {
        await fs.rm(inputPath, { force: true }).catch(() => {});
        return;
      }
    } catch (err) {
      console.warn('Falha ao converter ícone personalizado, usando fallback:', err);
    } finally {
      await fs.rm(inputPath, { force: true }).catch(() => {});
    }
  }

  // Fallback: default bundled brand icon or crisp geometric PNG32 badge
  const hex = safeHex(primaryColor, '#1D4ED8');
  const defaultAsset = path.resolve(
    process.cwd(),
    'src',
    'assets',
    'images',
    'appforge_default_icon_1795292674430.jpg'
  );
  try {
    await fs.access(defaultAsset);
    await execFileAsync(
      'convert',
      [defaultAsset, '-alpha', 'on', '-resize', '512x512!', `PNG32:${outPngPath}`],
      { timeout: 8000 }
    );
    return;
  } catch {
    // Pure geometric fallback if bundled image is unavailable
  }

  await execFileAsync(
    'convert',
    [
      '-size',
      '512x512',
      'xc:none',
      '-fill',
      hex,
      '-draw',
      'roundrectangle 24,24 488,488 96,96',
      '-fill',
      '#FFFFFF',
      '-draw',
      'roundrectangle 136,136 376,376 52,52',
      '-fill',
      hex,
      '-draw',
      'circle 256,256 256,184',
      `PNG32:${outPngPath}`,
    ],
    { timeout: 8000 }
  );
}

export async function resolveSplashToPng(
  splashUrl: string | undefined,
  primaryColor: string,
  secondaryColor: string,
  outPngPath: string
): Promise<boolean> {
  const fetched = splashUrl ? await fetchImageBuffer(splashUrl) : null;
  if (fetched) {
    let inputPath = `${outPngPath}.input.${fetched.ext}`;
    try {
      if (fetched.ext === 'svg') {
        const pngBuf = await rasterizeSvgBufferToPng(fetched.buffer, 1080);
        inputPath = `${outPngPath}.input.png`;
        await fs.writeFile(inputPath, pngBuf);
      } else {
        await fs.writeFile(inputPath, fetched.buffer);
      }
      const isMultiFrame = inputPath.endsWith('.ico') || inputPath.endsWith('.gif');
      const frameArg = isMultiFrame ? `${inputPath}[${await pickBestFrameIndex(inputPath)}]` : `${inputPath}[0]`;
      await execFileAsync(
        'convert',
        [
          frameArg,
          '-alpha',
          'on',
          '-resize',
          '1080x1920>',
          `PNG32:${outPngPath}`,
        ],
        { timeout: 10000 }
      );
      const st = await fs.stat(outPngPath);
      if (st.size > 0) {
        await fs.rm(inputPath, { force: true }).catch(() => {});
        return true;
      }
    } catch (err) {
      console.warn('Falha ao converter splash personalizada:', err);
    } finally {
      await fs.rm(inputPath, { force: true }).catch(() => {});
    }
  }

  const pri = safeHex(primaryColor, '#1D4ED8');
  const sec = safeHex(secondaryColor, '#0F172A');
  await execFileAsync(
    'convert',
    ['-size', '1080x1920', `gradient:${sec}-${pri}`, `PNG32:${outPngPath}`],
    { timeout: 8000 }
  );
  return false;
}

export async function resolveSplashToBmp(
  splashUrl: string | undefined,
  primaryColor: string,
  secondaryColor: string,
  outBmpPath: string
): Promise<boolean> {
  const tmpPng = `${outBmpPath}.tmp.png`;
  try {
    const hasCustom = await resolveSplashToPng(splashUrl, primaryColor, secondaryColor, tmpPng);
    await execFileAsync(
      'convert',
      [
        tmpPng,
        '-background',
        safeHex(secondaryColor, '#0F172A'),
        '-alpha',
        'remove',
        '-alpha',
        'off',
        '-resize',
        '960x640^',
        '-gravity',
        'center',
        '-extent',
        '960x640',
        '-type',
        'TrueColor',
        `BMP3:${outBmpPath}`,
      ],
      { timeout: 10000 }
    );
    return hasCustom;
  } finally {
    await fs.rm(tmpPng, { force: true }).catch(() => {});
  }
}

export async function generateWindowsIco(sourcePng: string, outIco: string): Promise<void> {
  // Canonical Windows ICO ordering: uncompressed 32-bit DIB frames first (16..128), 256x256 PNG last
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const args: string[] = [];
  for (const s of sizes) {
    args.push('(', sourcePng, '-alpha', 'on', '-resize', `${s}x${s}!`, ')');
  }
  args.push(outIco);
  await execFileAsync('convert', args, { timeout: 12000 });
}

export async function generateNsisModernBitmaps(
  sourcePng: string,
  primaryColor: string,
  secondaryColor: string,
  headerBmpPath: string,
  wizardBmpPath: string
): Promise<void> {
  const pri = safeHex(primaryColor, '#1D4ED8');
  const sec = safeHex(secondaryColor, '#0F172A');

  // Header BMP: 150x57 BMP3 (top-right logo banner on modern NSIS installer pages)
  await execFileAsync(
    'convert',
    [
      '-size',
      '150x57',
      'xc:#FFFFFF',
      '(',
      sourcePng,
      '-resize',
      '42x42',
      ')',
      '-gravity',
      'east',
      '-geometry',
      '+16+0',
      '-composite',
      '-type',
      'TrueColor',
      `BMP3:${headerBmpPath}`,
    ],
    { timeout: 10000 }
  );

  // Welcome/Finish Sidebar BMP: 164x314 BMP3 (left branding panel with app icon badge)
  await execFileAsync(
    'convert',
    [
      '-size',
      '164x314',
      `gradient:${sec}-${pri}`,
      '(',
      '-size',
      '112x112',
      'xc:none',
      '-fill',
      '#FFFFFF',
      '-draw',
      'roundrectangle 0,0 111,111 22,22',
      ')',
      '-gravity',
      'center',
      '-geometry',
      '+0-24',
      '-composite',
      '(',
      sourcePng,
      '-resize',
      '84x84',
      ')',
      '-gravity',
      'center',
      '-geometry',
      '+0-24',
      '-composite',
      '-type',
      'TrueColor',
      `BMP3:${wizardBmpPath}`,
    ],
    { timeout: 10000 }
  );
}

async function analyzeAdaptiveIconAppearance(
  sourcePng: string,
  primaryColor: string
): Promise<{ isOpaqueEdge: boolean; adaptiveBgHex: string; foregroundRatio: number }> {
  const fallbackHex = safeHex(primaryColor, '#1D4ED8');
  try {
    const { stdout } = await execFileAsync(
      'identify',
      [
        '-format',
        '%[fx:p{2,2}.a] %[fx:p{509,2}.a] %[fx:p{2,509}.a] %[pixel:p{4,4}] %[fx:mean.r] %[fx:mean.g] %[fx:mean.b]',
        sourcePng,
      ],
      { timeout: 5000 }
    );
    const parts = stdout.trim().split(/\s+/);
    const a1 = Number(parts[0]);
    const a2 = Number(parts[1]);
    const a3 = Number(parts[2]);
    const cornerHex = rgbStringToHex(parts[3] || '');
    const meanR = Number(parts[4]);
    const meanG = Number(parts[5]);
    const meanB = Number(parts[6]);

    // Opaque square/rectangular image (e.g. JPG or solid-background PNG)
    if (a1 > 0.9 && a2 > 0.9 && a3 > 0.9 && cornerHex) {
      return {
        isOpaqueEdge: true,
        adaptiveBgHex: cornerHex,
        foregroundRatio: 0.74,
      };
    }

    // Transparent logo: ensure foreground has good contrast against adaptive background
    const meanLum = 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB;
    const bgLum = hexLuminance(fallbackHex);
    const adaptiveBgHex =
      Math.abs(meanLum - bgLum) < 0.22
        ? meanLum < 0.45
          ? '#FFFFFF'
          : '#0F172A'
        : fallbackHex;

    return {
      isOpaqueEdge: false,
      adaptiveBgHex,
      foregroundRatio: 0.66,
    };
  } catch {
    return {
      isOpaqueEdge: false,
      adaptiveBgHex: fallbackHex,
      foregroundRatio: 0.66,
    };
  }
}

export async function generateAndroidMipmaps(
  sourcePng: string,
  resDir: string,
  primaryColor: string,
  splashUrl?: string,
  secondaryColor?: string
): Promise<void> {
  const densities: Array<[string, number, number]> = [
    ['mipmap-mdpi', 48, 108],
    ['mipmap-hdpi', 72, 162],
    ['mipmap-xhdpi', 96, 216],
    ['mipmap-xxhdpi', 144, 324],
    ['mipmap-xxxhdpi', 192, 432],
  ];

  const adaptive = await analyzeAdaptiveIconAppearance(sourcePng, primaryColor);

  await Promise.all(
    densities.map(async ([folder, size, adaptiveSize]) => {
      const dir = path.join(resDir, folder);
      await fs.mkdir(dir, { recursive: true });
      const launcherPng = path.join(dir, 'ic_launcher.png');
      const roundPng = path.join(dir, 'ic_launcher_round.png');
      const fgPng = path.join(dir, 'ic_launcher_foreground.png');

      const radius = Math.max(8, Math.round(size * 0.2));
      const half = Math.floor(size / 2);
      const badgeInner = Math.max(16, Math.round(size * 0.78));

      if (adaptive.isOpaqueEdge) {
        // Opaque image: clip cleanly with DstIn alpha mask (no CopyOpacity black artifacts)
        await execFileAsync(
          'convert',
          [
            sourcePng,
            '-alpha',
            'on',
            '-resize',
            `${size}x${size}!`,
            '(',
            '-size',
            `${size}x${size}`,
            'xc:none',
            '-fill',
            'white',
            '-draw',
            `roundrectangle 0,0 ${size - 1},${size - 1} ${radius},${radius}`,
            ')',
            '-compose',
            'DstIn',
            '-composite',
            `PNG32:${launcherPng}`,
          ],
          { timeout: 8000 }
        );

        await execFileAsync(
          'convert',
          [
            sourcePng,
            '-alpha',
            'on',
            '-resize',
            `${size}x${size}!`,
            '(',
            '-size',
            `${size}x${size}`,
            'xc:none',
            '-fill',
            'white',
            '-draw',
            `circle ${half},${half} ${half},1`,
            ')',
            '-compose',
            'DstIn',
            '-composite',
            `PNG32:${roundPng}`,
          ],
          { timeout: 8000 }
        );
      } else {
        // Transparent logo: frame cleanly on adaptive background badge matching UI preview
        await execFileAsync(
          'convert',
          [
            '-size',
            `${size}x${size}`,
            'xc:none',
            '-fill',
            adaptive.adaptiveBgHex,
            '-draw',
            `roundrectangle 0,0 ${size - 1},${size - 1} ${radius},${radius}`,
            '(',
            sourcePng,
            '-alpha',
            'on',
            '-resize',
            `${badgeInner}x${badgeInner}`,
            ')',
            '-gravity',
            'center',
            '-compose',
            'Over',
            '-composite',
            `PNG32:${launcherPng}`,
          ],
          { timeout: 8000 }
        );

        await execFileAsync(
          'convert',
          [
            '-size',
            `${size}x${size}`,
            'xc:none',
            '-fill',
            adaptive.adaptiveBgHex,
            '-draw',
            `circle ${half},${half} ${half},1`,
            '(',
            sourcePng,
            '-alpha',
            'on',
            '-resize',
            `${badgeInner}x${badgeInner}`,
            ')',
            '-gravity',
            'center',
            '-compose',
            'Over',
            '-composite',
            `PNG32:${roundPng}`,
          ],
          { timeout: 8000 }
        );
      }

      // Adaptive foreground icon safely centered inside 108dp canvas
      const innerSize = Math.round(adaptiveSize * adaptive.foregroundRatio);
      await execFileAsync(
        'convert',
        [
          '-size',
          `${adaptiveSize}x${adaptiveSize}`,
          'xc:none',
          '(',
          sourcePng,
          '-alpha',
          'on',
          '-resize',
          `${innerSize}x${innerSize}`,
          ')',
          '-gravity',
          'center',
          '-composite',
          `PNG32:${fgPng}`,
        ],
        { timeout: 8000 }
      );
    })
  );

  const anyDpiDir = path.join(resDir, 'mipmap-anydpi-v26');
  await fs.mkdir(anyDpiDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  await Promise.all([
    fs.writeFile(path.join(anyDpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8'),
    fs.writeFile(path.join(anyDpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8'),
  ]);

  const valuesDir = path.join(resDir, 'values');
  await fs.mkdir(valuesDir, { recursive: true });
  await fs.writeFile(
    path.join(valuesDir, 'colors.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${adaptive.adaptiveBgHex}</color>\n</resources>\n`,
    'utf8'
  );

  // Native splash logo drawable (app icon) + splash screen backdrop image (user splashUrl)
  const drawableDir = path.join(resDir, 'drawable');
  await fs.mkdir(drawableDir, { recursive: true });
  await execFileAsync(
    'convert',
    [
      sourcePng,
      '-alpha',
      'on',
      '-resize',
      '256x256!',
      `PNG32:${path.join(drawableDir, 'app_splash_logo.png')}`,
    ],
    { timeout: 8000 }
  );
  await resolveSplashToPng(
    splashUrl,
    primaryColor,
    secondaryColor || '#0F172A',
    path.join(drawableDir, 'app_splash_screen.png')
  );
}
