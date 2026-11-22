import * as cheerio from 'cheerio';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { UrlAnalysisResult, WebFramework } from '../src/types/appforge.ts';
import { detectImageExtension, rasterizeSvgBufferToPng } from './engines/iconHelper.ts';
import { validateSafePublicUrl } from './security.ts';

const execFileAsync = promisify(execFile);

function slugifyPackageSegment(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '');
  return cleaned || 'app';
}

function buildPackageName(hostname: string, appName: string): string {
  const hostParts = hostname
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean)
    .reverse()
    .map(slugifyPackageSegment);
  const appSlug = slugifyPackageSegment(appName);
  const segments = [...hostParts, appSlug].slice(0, 4);
  if (segments.length < 2) {
    return `com.appforge.${appSlug}`;
  }
  return segments.join('.');
}

function resolveUrl(base: string, candidate?: string | null): string {
  if (!candidate) return '';
  if (candidate.startsWith('data:image/')) return candidate;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return '';
  }
}

function extractCssColors(html: string): string[] {
  const matches = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const counts = new Map<string, number>();
  for (const raw of matches) {
    const hex = raw.toLowerCase();
    if (hex === '#ffffff' || hex === '#000000' || hex === '#f8fafc') continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex)
    .slice(0, 4);
}

function detectFramework(html: string, headers: Headers): { framework: WebFramework; markers: string[] } {
  const markers: string[] = [];
  const poweredBy = (headers.get('x-powered-by') || '').toLowerCase();
  const setCookie = (headers.get('set-cookie') || '').toLowerCase();

  if (setCookie.includes('laravel_session') || (html.includes('csrf-token') && poweredBy.includes('php'))) {
    markers.push('Laravel / PHP Session');
    return { framework: 'laravel', markers };
  }
  if (poweredBy.includes('php') || html.includes('.php')) {
    markers.push('PHP Backend');
    return { framework: 'php', markers };
  }
  if (html.includes('__NEXT_DATA__') || html.includes('/_next/') || html.includes('data-reactroot') || html.includes('id="root"')) {
    markers.push('React / Next.js DOM');
    return { framework: 'react', markers };
  }
  if (html.includes('__NUXT__') || html.includes('data-v-') || html.includes('id="app"')) {
    markers.push('Vue / Nuxt Bundle');
    return { framework: 'vue', markers };
  }
  if (html.includes('ng-version') || html.includes('<app-root')) {
    markers.push('Angular Framework');
    return { framework: 'angular', markers };
  }
  markers.push('HTML / Web Standard');
  return { framework: 'html', markers };
}

function buildBrandedSvgDataUri(primaryColor: string, appName: string): string {
  const hex = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#1D4ED8';
  const letter = (appName.trim().charAt(0) || 'A').toUpperCase().replace(/[^A-Z0-9]/g, 'A');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${hex}"/><text x="256" y="318" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="230" font-weight="700" fill="#ffffff">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function isLikelyImageBuffer(buf: Buffer, contentType: string): boolean {
  if (buf.length < 32) return false;
  const headText = buf.subarray(0, 200).toString('utf8').trimStart().toLowerCase();
  if (headText.startsWith('<!doctype html') || headText.startsWith('<html') || headText.startsWith('<head')) {
    return false;
  }
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    return false;
  }
  // PNG, JPEG, GIF, WEBP, ICO, CUR, SVG
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isGif = buf.subarray(0, 4).toString('ascii') === 'GIF8';
  const isWebp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const isIco = buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00;
  const isSvg = headText.includes('<svg');
  return isPng || isJpg || isGif || isWebp || isIco || isSvg || contentType.startsWith('image/');
}

async function normalizeImageToDataUri(buf: Buffer, hint?: string): Promise<string | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'af-url-ico-'));
  try {
    const ext = detectImageExtension(buf, hint);
    const rawPath = path.join(tmpDir, ext === 'svg' ? 'raw.png' : `raw.${ext}`);
    const outPng = path.join(tmpDir, 'icon.png');
    if (ext === 'svg') {
      const pngBuf = await rasterizeSvgBufferToPng(buf, 256);
      await fs.writeFile(rawPath, pngBuf);
    } else {
      await fs.writeFile(rawPath, buf);
    }

    // Pick largest frame for .ico/.gif files
    let frameIndex = 0;
    if (ext === 'ico' || ext === 'gif') {
      try {
        const { stdout } = await execFileAsync('identify', ['-format', '%p %w\n', rawPath], {
          timeout: 4000,
        });
        let bestW = -1;
        for (const line of stdout.trim().split('\n')) {
          const [idxStr, wStr] = line.trim().split(/\s+/);
          const idx = Number(idxStr);
          const w = Number(wStr);
          if (Number.isFinite(idx) && Number.isFinite(w) && w > bestW) {
            bestW = w;
            frameIndex = idx;
          }
        }
      } catch {
        // keep 0
      }
    }

    await execFileAsync(
      'convert',
      [
        '-background',
        'none',
        `${rawPath}[${frameIndex}]`,
        '-alpha',
        'on',
        '-resize',
        '256x256',
        '-gravity',
        'center',
        '-extent',
        '256x256',
        `PNG32:${outPng}`,
      ],
      { timeout: 6000 }
    );
    const pngBuf = await fs.readFile(outPng);
    if (pngBuf.length > 0 && pngBuf.length <= 220 * 1024) {
      return `data:image/png;base64,${pngBuf.toString('base64')}`;
    }
    return null;
  } catch {
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fetchVerifiedSiteIcon(
  candidates: string[],
  primaryColor: string,
  appName: string
): Promise<string> {
  const seen = new Set<string>();
  for (const rawCandidate of candidates) {
    if (!rawCandidate || seen.has(rawCandidate)) continue;
    seen.add(rawCandidate);

    if (rawCandidate.startsWith('data:image/')) {
      return rawCandidate;
    }

    if (!rawCandidate.startsWith('http://') && !rawCandidate.startsWith('https://')) {
      continue;
    }

    try {
      const safe = await validateSafePublicUrl(rawCandidate);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(safe.toString(), {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'AppForgeStudio-Inspector/1.0 (+https://appforge.studio)',
          Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/x-icon,image/*;q=0.8',
        },
      });
      clearTimeout(timer);

      if (!resp.ok) continue;
      const ctype = (resp.headers.get('content-type') || '').toLowerCase();
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!isLikelyImageBuffer(buf, ctype)) continue;

      const normalized = await normalizeImageToDataUri(buf, `${ctype} ${resp.url || safe.toString()}`);
      if (normalized) return normalized;
      return resp.url || safe.toString();
    } catch {
      // Try next candidate
    }
  }

  return buildBrandedSvgDataUri(primaryColor, appName);
}

export async function analyzeTargetUrl(rawUrl: string): Promise<UrlAnalysisResult> {
  const safeUrl = await validateSafePublicUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  let response: Response;
  try {
    response = await fetch(safeUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'AppForgeStudio-Inspector/1.0 (+https://appforge.studio)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  // Re-validate final URL after redirects to guard against redirect-based SSRF
  if (response.url) {
    await validateSafePublicUrl(response.url);
  }

  const finalUrl = response.url || safeUrl.toString();
  const finalParsed = new URL(finalUrl);
  const html = (await response.text()).slice(0, 650000);
  const $ = cheerio.load(html);

  const rawTitle =
    $('meta[property="og:site_name"]').attr('content') ||
    $('meta[name="application-name"]').attr('content') ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text() ||
    finalParsed.hostname.replace(/^www\./, '');

  const appName = rawTitle.trim().slice(0, 50) || finalParsed.hostname;

  const description = (
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    `Aplicação oficial para ${finalParsed.hostname}`
  )
    .trim()
    .slice(0, 260);

  const themeColor =
    $('meta[name="theme-color"]').attr('content')?.trim() ||
    $('meta[name="msapplication-TileColor"]').attr('content')?.trim();

  const cssPalette = extractCssColors(html);
  const primaryColor =
    themeColor && /^#[0-9a-fA-F]{6}$/.test(themeColor)
      ? themeColor
      : cssPalette[0] || '#1D4ED8';
  const secondaryColor = cssPalette.find((c) => c !== primaryColor) || '#0F172A';

  const rawCandidates = [
    $('link[rel="apple-touch-icon"]').attr('href'),
    $('link[rel="apple-touch-icon-precomposed"]').attr('href'),
    $('link[rel="icon"][sizes="512x512"]').attr('href'),
    $('link[rel="icon"][sizes="192x192"]').attr('href'),
    $('link[rel="icon"][sizes="180x180"]').attr('href'),
    $('link[rel="icon"]').attr('href'),
    $('link[rel="shortcut icon"]').attr('href'),
    '/favicon.ico',
    $('meta[property="og:image"]').attr('content'),
  ]
    .map((c) => resolveUrl(finalUrl, c))
    .filter(Boolean);

  const iconUrl = await fetchVerifiedSiteIcon(rawCandidates, primaryColor, appName);
  const ogImage = resolveUrl(finalUrl, $('meta[property="og:image"]').attr('content'));
  const manifestHref = $('link[rel="manifest"]').attr('href');

  const { framework, markers } = detectFramework(html, response.headers);

  const xfo = (response.headers.get('x-frame-options') || '').toLowerCase();
  const csp = (response.headers.get('content-security-policy') || '').toLowerCase();
  const blocksIframe =
    xfo.includes('deny') ||
    xfo.includes('sameorigin') ||
    csp.includes("frame-ancestors 'none'") ||
    csp.includes("frame-ancestors 'self'");

  return {
    url: finalUrl,
    appName,
    description,
    packageName: buildPackageName(finalParsed.hostname, appName),
    iconUrl,
    splashUrl: ogImage || iconUrl,
    primaryColor,
    secondaryColor,
    detectedFramework: framework,
    detectedMarkers: markers,
    hasManifest: Boolean(manifestHref),
    supportsIframePreview: !blocksIframe,
  };
}
