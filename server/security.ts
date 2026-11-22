import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import path from 'path';

const DEFAULT_SECRET = 'appforge-studio-ephemeral-dev-key-2026';

function getEncryptionKey(): Buffer {
  const raw = process.env.BUILD_ENCRYPTION_KEY || DEFAULT_SECRET;
  return crypto.scryptSync(raw, 'appforge-keystore-salt', 32);
}

export function encryptBuffer(plain: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  const key = getEncryptionKey();
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptText(text: string): string {
  return encryptBuffer(Buffer.from(text, 'utf8')).toString('base64');
}

export function decryptText(encoded: string): string {
  return decryptBuffer(Buffer.from(encoded, 'base64')).toString('utf8');
}

export function sanitizeId(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned || cleaned.length > 128) {
    throw new Error('Identificador inválido.');
  }
  return cleaned;
}

export function safeJoin(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const target = path.resolve(resolvedBase, ...segments);
  if (!target.startsWith(resolvedBase + path.sep) && target !== resolvedBase) {
    throw new Error('Tentativa de path traversal bloqueada.');
  }
  return target;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') ||
      normalized.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
  }
  return false;
}

export async function validateSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL inválido. Utilize o formato https://exemplo.com');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas protocolos HTTP e HTTPS são permitidos.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Endereços locais ou internos são bloqueados por segurança (SSRF).');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Endereços IP privados ou reservados não são permitidos.');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) {
      throw new Error('Não foi possível resolver o domínio informado.');
    }
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('O domínio aponta para um IP interno protegido (SSRF bloqueado).');
      }
    }
  } catch (err: any) {
    if (err.message.includes('SSRF') || err.message.includes('domínio')) {
      throw err;
    }
    throw new Error(`Falha na resolução DNS do domínio: ${hostname}`);
  }

  return parsed;
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
