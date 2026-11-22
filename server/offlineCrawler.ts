import * as cheerio from 'cheerio';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { safeJoin, sanitizeId, validateSafePublicUrl } from './security.ts';
import { UploadedBundleSummary } from './uploadManager.ts';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'workspace', 'uploads');

function extFromContentType(ct: string | null, fallbackUrl: string): string {
  const cleanUrl = fallbackUrl.split('?')[0].split('#')[0];
  const urlExt = path.extname(cleanUrl).toLowerCase();
  if (urlExt && urlExt.length <= 6 && /^\.[a-z0-9]+$/.test(urlExt)) {
    return urlExt;
  }
  const lower = (ct || '').toLowerCase();
  if (lower.includes('text/html')) return '.html';
  if (lower.includes('text/css')) return '.css';
  if (lower.includes('javascript')) return '.js';
  if (lower.includes('application/json')) return '.json';
  if (lower.includes('image/svg+xml')) return '.svg';
  if (lower.includes('image/png')) return '.png';
  if (lower.includes('image/jpeg')) return '.jpg';
  if (lower.includes('image/webp')) return '.webp';
  if (lower.includes('image/x-icon') || lower.includes('vnd.microsoft.icon')) return '.ico';
  if (lower.includes('font/woff2')) return '.woff2';
  if (lower.includes('font/woff')) return '.woff';
  if (lower.includes('font/ttf')) return '.ttf';
  return '.bin';
}

function hashAssetRelPath(absUrl: string, ct: string | null, folder = 'assets'): string {
  const hash = crypto.createHash('sha1').update(absUrl).digest('hex').slice(0, 12);
  const ext = extFromContentType(ct, absUrl);
  const baseName = path.basename(absUrl.split('?')[0].split('#')[0]).replace(/[^a-zA-Z0-9._-]/g, '_');
  const stem = baseName && baseName !== '/' ? baseName.slice(0, 28) : 'res';
  const finalName = stem.endsWith(ext) ? `${hash}_${stem}` : `${hash}_${stem}${ext}`;
  return `${folder}/${finalName}`;
}

function pageRelPathFromUrl(absUrl: string, rootUrl: string): string {
  const u = new URL(absUrl);
  const r = new URL(rootUrl);
  if (u.origin === r.origin && (u.pathname === r.pathname || u.pathname === '/')) {
    return 'index.html';
  }
  const clean = u.pathname
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9/._-]/g, '_');
  if (!clean) return 'index.html';
  const hash = crypto.createHash('sha1').update(absUrl).digest('hex').slice(0, 6);
  if (clean.endsWith('.html') || clean.endsWith('.htm')) {
    return `pages/${hash}_${clean.replace(/\//g, '_')}`;
  }
  return `pages/${hash}_${clean.replace(/\//g, '_')}.html`;
}

async function safeFetchBytes(
  targetUrl: string,
  timeoutMs = 8000
): Promise<{ buf: Buffer; contentType: string | null; finalUrl: string } | null> {
  try {
    const safe = await validateSafePublicUrl(targetUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(safe.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'AppForgeStudio-OfflinePackager/1.0 (+https://appforge.studio)',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    if (resp.url) {
      await validateSafePublicUrl(resp.url);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      buf,
      contentType: resp.headers.get('content-type'),
      finalUrl: resp.url || safe.toString(),
    };
  } catch {
    return null;
  }
}

export async function captureWebsiteOfflineBundle(
  ownerId: string,
  rawUrl: string,
  options?: { maxPages?: number; maxAssets?: number; maxTotalBytes?: number }
): Promise<UploadedBundleSummary> {
  const maxPages = options?.maxPages ?? 10;
  const maxAssets = options?.maxAssets ?? 140;
  const maxTotalBytes = options?.maxTotalBytes ?? 35 * 1024 * 1024;

  const startSafe = await validateSafePublicUrl(rawUrl);
  const startUrl = startSafe.toString();
  const rootOrigin = startSafe.origin;

  const uid = sanitizeId(ownerId);
  const bundleId = `off_${crypto.randomBytes(8).toString('hex')}`;
  const bundleDir = safeJoin(UPLOAD_ROOT, uid, bundleId);
  await fs.mkdir(bundleDir, { recursive: true });

  const downloadedAssets = new Map<string, string>(); // absUrl -> relPath from bundleDir
  const savedFiles: string[] = [];
  let totalBytes = 0;

  async function writeBundleFile(relPath: string, content: Buffer) {
    if (totalBytes + content.length > maxTotalBytes) return false;
    const dest = safeJoin(bundleDir, relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content);
    totalBytes += content.length;
    if (!savedFiles.includes(relPath)) savedFiles.push(relPath);
    return true;
  }

  async function downloadAsset(absUrl: string, pageDirRel = ''): Promise<string | null> {
    if (absUrl.startsWith('data:') || absUrl.startsWith('blob:') || absUrl.startsWith('javascript:')) {
      return null;
    }
    const existing = downloadedAssets.get(absUrl);
    if (existing) {
      return pageDirRel ? path.posix.relative(pageDirRel, existing) : existing;
    }
    if (downloadedAssets.size >= maxAssets || totalBytes >= maxTotalBytes) {
      return null;
    }

    const res = await safeFetchBytes(absUrl, 7000);
    if (!res || res.buf.length === 0 || res.buf.length > 8 * 1024 * 1024) {
      return null;
    }

    const rel = hashAssetRelPath(res.finalUrl, res.contentType);
    downloadedAssets.set(absUrl, rel);

    // If stylesheet, rewrite internal url(...) references too
    if ((res.contentType || '').toLowerCase().includes('text/css') || rel.endsWith('.css')) {
      let cssText = res.buf.toString('utf8');
      const cssDir = path.posix.dirname(rel);
      const urlMatches = [...cssText.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)];
      for (const m of urlMatches.slice(0, 40)) {
        const rawRef = m[2];
        if (!rawRef || rawRef.startsWith('data:')) continue;
        try {
          const resolved = new URL(rawRef, res.finalUrl).toString();
          const localSub = await downloadAsset(resolved, cssDir);
          if (localSub) {
            cssText = cssText.split(m[0]).join(`url("${localSub}")`);
          }
        } catch {
          // Ignore malformed CSS url()
        }
      }
      await writeBundleFile(rel, Buffer.from(cssText, 'utf8'));
    } else {
      await writeBundleFile(rel, res.buf);
    }

    return pageDirRel ? path.posix.relative(pageDirRel, rel) : rel;
  }

  const visitedPages = new Map<string, string>(); // canonicalUrl -> relHtmlPath
  const pageQueue: string[] = [startUrl];

  while (pageQueue.length > 0 && visitedPages.size < maxPages && totalBytes < maxTotalBytes) {
    const currentUrl = pageQueue.shift()!;
    if (visitedPages.has(currentUrl)) continue;

    const fetched = await safeFetchBytes(currentUrl, 9000);
    if (!fetched) continue;
    const ct = (fetched.contentType || '').toLowerCase();
    if (ct && !ct.includes('text/html') && !ct.includes('application/xhtml+xml')) {
      continue;
    }

    const relHtmlPath = visitedPages.size === 0 ? 'index.html' : pageRelPathFromUrl(fetched.finalUrl, startUrl);
    const htmlDirRel = path.posix.dirname(relHtmlPath) === '.' ? '' : path.posix.dirname(relHtmlPath);
    visitedPages.set(currentUrl, relHtmlPath);
    visitedPages.set(fetched.finalUrl, relHtmlPath);

    const html = fetched.buf.toString('utf8').slice(0, 1_500_000);
    const $ = cheerio.load(html);

    // Collect candidate internal HTML links before mutating
    const internalLinks: Array<{ el: any; absUrl: string }> = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        return;
      }
      try {
        const resolved = new URL(href, fetched.finalUrl);
        resolved.hash = '';
        if (resolved.origin === rootOrigin) {
          const cleanStr = resolved.toString();
          internalLinks.push({ el, absUrl: cleanStr });
          if (!visitedPages.has(cleanStr) && pageQueue.length + visitedPages.size < maxPages) {
            pageQueue.push(cleanStr);
          }
        }
      } catch {
        // Skip invalid href
      }
    });

    // Download & rewrite <link href> (CSS, icons, manifest)
    const linkEls = $('link[href]').toArray();
    for (const el of linkEls) {
      const relAttr = ($(el).attr('rel') || '').toLowerCase();
      const href = $(el).attr('href');
      if (!href) continue;
      if (
        relAttr.includes('stylesheet') ||
        relAttr.includes('icon') ||
        relAttr.includes('apple-touch-icon') ||
        relAttr.includes('manifest')
      ) {
        try {
          const resolved = new URL(href, fetched.finalUrl).toString();
          const localRel = await downloadAsset(resolved, htmlDirRel);
          if (localRel) $(el).attr('href', localRel);
        } catch {
          // Ignore
        }
      }
    }

    // Download & rewrite <script src>
    const scriptEls = $('script[src]').toArray();
    for (const el of scriptEls) {
      const src = $(el).attr('src');
      if (!src) continue;
      try {
        const resolved = new URL(src, fetched.finalUrl).toString();
        const localRel = await downloadAsset(resolved, htmlDirRel);
        if (localRel) $(el).attr('src', localRel);
      } catch {
        // Ignore
      }
    }

    // Download & rewrite <img src> and <source src>
    const mediaEls = $('img[src], source[src]').toArray();
    for (const el of mediaEls) {
      const src = $(el).attr('src');
      if (!src) continue;
      try {
        const resolved = new URL(src, fetched.finalUrl).toString();
        const localRel = await downloadAsset(resolved, htmlDirRel);
        if (localRel) {
          $(el).attr('src', localRel);
          $(el).removeAttr('srcset');
        }
      } catch {
        // Ignore
      }
    }

    // Rewrite internal page links to offline local HTML files
    for (const link of internalLinks) {
      const targetRel =
        visitedPages.get(link.absUrl) || pageRelPathFromUrl(link.absUrl, startUrl);
      const relativeHref = htmlDirRel
        ? path.posix.relative(htmlDirRel, targetRel)
        : targetRel;
      $(link.el).attr('href', relativeHref);
    }

    // Remove strict CSP or frame-blocking meta tags that interfere with local offline serving
    $('meta[http-equiv="Content-Security-Policy"]').remove();

    await writeBundleFile(relHtmlPath, Buffer.from($.html(), 'utf8'));
  }

  if (!savedFiles.includes('index.html')) {
    throw new Error('Não foi possível capturar o documento HTML inicial deste website para modo offline.');
  }

  const joined = savedFiles.join(' ').toLowerCase();
  let detectedFramework: UploadedBundleSummary['detectedFramework'] = 'html';
  if (joined.includes('react')) detectedFramework = 'react';
  else if (joined.includes('vue')) detectedFramework = 'vue';
  else if (joined.includes('angular')) detectedFramework = 'angular';

  return {
    bundleId,
    fileCount: savedFiles.length,
    totalBytes,
    hasIndexHtml: true,
    detectedFramework,
    entryPath: 'index.html',
    filesPreview: savedFiles.slice(0, 25),
  };
}
