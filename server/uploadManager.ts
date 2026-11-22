import crypto from 'crypto';
import fs from 'fs/promises';
import JSZip from 'jszip';
import path from 'path';
import { safeJoin, sanitizeId } from './security.ts';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'workspace', 'uploads');

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.so', '.dylib', '.php', '.py', '.rb', '.pl',
]);

export interface UploadedBundleSummary {
  bundleId: string;
  fileCount: number;
  totalBytes: number;
  hasIndexHtml: boolean;
  detectedFramework: 'html' | 'react' | 'vue' | 'angular' | 'static';
  entryPath: string;
  filesPreview: string[];
}

export async function processUploadedProjectFiles(
  ownerId: string,
  files: Array<{ originalname: string; buffer: Buffer; mimetype: string }>
): Promise<UploadedBundleSummary> {
  const uid = sanitizeId(ownerId);
  const bundleId = `bnd_${crypto.randomBytes(8).toString('hex')}`;
  const bundleDir = safeJoin(UPLOAD_ROOT, uid, bundleId);
  await fs.mkdir(bundleDir, { recursive: true });

  const extractedFiles: string[] = [];
  let totalBytes = 0;

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      const zip = await JSZip.loadAsync(file.buffer);
      const entries = Object.values(zip.files);
      for (const entry of entries) {
        if (entry.dir) continue;
        // Reject path traversal inside zip
        if (entry.name.includes('..') || path.isAbsolute(entry.name)) {
          throw new Error(`Ficheiro inseguro bloqueado no ZIP: ${entry.name}`);
        }
        const entryExt = path.extname(entry.name).toLowerCase();
        if (BLOCKED_EXTENSIONS.has(entryExt)) {
          continue; // Skip unsafe server/executable scripts
        }
        const content = await entry.async('nodebuffer');
        totalBytes += content.length;
        if (totalBytes > 80 * 1024 * 1024) {
          throw new Error('O projecto excede o limite máximo de 80 MB descompactado.');
        }
        const destPath = safeJoin(bundleDir, entry.name);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, content);
        extractedFiles.push(entry.name);
      }
    } else {
      const cleanName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (BLOCKED_EXTENSIONS.has(ext)) {
        throw new Error(`Extensão não permitida para apps web estáticas: ${ext}`);
      }
      totalBytes += file.buffer.length;
      const destPath = safeJoin(bundleDir, cleanName);
      await fs.writeFile(destPath, file.buffer);
      extractedFiles.push(cleanName);
    }
  }

  // Strip common top-level dist/ or build/ wrapper directory if index.html sits one level deep
  let entryPath = 'index.html';
  let hasIndexHtml = extractedFiles.some((f) => f.toLowerCase() === 'index.html');
  if (!hasIndexHtml) {
    const nestedIndex = extractedFiles.find((f) => f.toLowerCase().endsWith('/index.html'));
    if (nestedIndex) {
      hasIndexHtml = true;
      entryPath = nestedIndex;
    }
  }

  let detectedFramework: 'html' | 'react' | 'vue' | 'angular' | 'static' = 'html';
  const joined = extractedFiles.join(' ').toLowerCase();
  if (joined.includes('react') || joined.includes('static/js/main')) {
    detectedFramework = 'react';
  } else if (joined.includes('vue') || joined.includes('app.') && joined.includes('chunk-vendors')) {
    detectedFramework = 'vue';
  } else if (joined.includes('main.') && joined.includes('polyfills.')) {
    detectedFramework = 'angular';
  } else if (!hasIndexHtml) {
    detectedFramework = 'static';
  }

  return {
    bundleId,
    fileCount: extractedFiles.length,
    totalBytes,
    hasIndexHtml,
    detectedFramework,
    entryPath,
    filesPreview: extractedFiles.slice(0, 25),
  };
}

export async function readBundleFilesForPackaging(
  ownerId: string,
  bundleId: string
): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const uid = sanitizeId(ownerId);
  const bid = sanitizeId(bundleId);
  const bundleDir = safeJoin(UPLOAD_ROOT, uid, bid);
  const collected: Array<{ relativePath: string; content: Buffer }> = [];

  async function walk(currentDir: string, prefix: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, rel);
      } else {
        const content = await fs.readFile(fullPath);
        collected.push({ relativePath: rel, content });
      }
    }
  }

  try {
    await walk(bundleDir, '');
  } catch {
    return [];
  }
  return collected;
}
