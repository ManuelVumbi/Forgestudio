import crypto from 'crypto';
import fs from 'fs/promises';
import forge from 'node-forge';
import path from 'path';
import { decryptBuffer, decryptText, encryptBuffer, encryptText, safeJoin, sanitizeId, sha256Hex } from './security.ts';

const KEYSTORE_ROOT = path.resolve(process.cwd(), 'workspace', 'keystores');

export interface KeystoreMetadata {
  keystoreId: string;
  ownerId: string;
  alias: string;
  commonName: string;
  organization: string;
  country: string;
  sha1Fingerprint: string;
  sha256Fingerprint: string;
  mode: 'auto_managed' | 'custom_uploaded';
  fileName: string;
  createdAt: string;
}

interface StoredKeystoreRecord {
  metadata: KeystoreMetadata;
  encryptedPassword: string;
  encryptedAliasPassword: string;
  encryptedKeystoreBase64: string;
}

function toAsciiSafe(input: string | undefined, fallback: string, maxLen = 64): string {
  const cleaned = (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[,=+<>;#\\"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

export async function generateAndroidKeystore(params: {
  ownerId: string;
  alias: string;
  password: string;
  commonName: string;
  organization: string;
  country?: string;
}): Promise<KeystoreMetadata> {
  const uid = sanitizeId(params.ownerId);
  const keystoreId = `ks_${crypto.randomBytes(8).toString('hex')}`;
  const alias = params.alias.replace(/[^a-zA-Z0-9_-]/g, '') || 'appforge_release';
  const rawPassword = (params.password || '').replace(/[^\x21-\x7E]/g, '') || crypto.randomBytes(16).toString('hex');
  const password = rawPassword;
  const rawCountry = toAsciiSafe(params.country || 'PT', 'PT', 2).replace(/[^A-Za-z]/g, '').toUpperCase();
  const country = rawCountry.length === 2 ? rawCountry : 'PT';
  const certCommonName = toAsciiSafe(params.commonName, 'AppForge Release', 64);
  const certOrganization = toAsciiSafe(params.organization, 'AppForge Studio', 64);

  // Generate real 2048-bit RSA keypair and self-signed X.509 certificate
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 25);

  const attrs = [
    { name: 'commonName', value: certCommonName },
    { name: 'organizationName', value: certOrganization },
    { name: 'countryName', value: country },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const derBytes = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary'
  );
  const sha1Fingerprint = crypto
    .createHash('sha1')
    .update(derBytes)
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');
  const sha256Fingerprint = sha256Hex(derBytes)
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    friendlyName: alias,
    algorithm: '3des',
  });
  const p12Der = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');

  const userDir = safeJoin(KEYSTORE_ROOT, uid);
  await fs.mkdir(userDir, { recursive: true });

  const metadata: KeystoreMetadata = {
    keystoreId,
    ownerId: uid,
    alias,
    commonName: params.commonName || 'AppForge Release',
    organization: params.organization || 'AppForge Studio',
    country,
    sha1Fingerprint,
    sha256Fingerprint,
    mode: 'auto_managed',
    fileName: `${alias}.p12`,
    createdAt: new Date().toISOString(),
  };

  const record: StoredKeystoreRecord = {
    metadata,
    encryptedPassword: encryptText(password),
    encryptedAliasPassword: encryptText(password),
    encryptedKeystoreBase64: encryptBuffer(p12Der).toString('base64'),
  };

  await fs.writeFile(
    safeJoin(userDir, `${keystoreId}.json`),
    JSON.stringify(record, null, 2),
    'utf8'
  );

  return metadata;
}

export async function saveUploadedKeystore(params: {
  ownerId: string;
  alias: string;
  password: string;
  fileName: string;
  buffer: Buffer;
}): Promise<KeystoreMetadata> {
  const uid = sanitizeId(params.ownerId);
  const keystoreId = `ks_${crypto.randomBytes(8).toString('hex')}`;
  const alias = params.alias.replace(/[^a-zA-Z0-9_-]/g, '') || 'upload_key';
  const cleanName = path.basename(params.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');

  const sha256Fingerprint = sha256Hex(params.buffer)
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');
  const sha1Fingerprint = crypto
    .createHash('sha1')
    .update(params.buffer)
    .digest('hex')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');

  const userDir = safeJoin(KEYSTORE_ROOT, uid);
  await fs.mkdir(userDir, { recursive: true });

  const metadata: KeystoreMetadata = {
    keystoreId,
    ownerId: uid,
    alias,
    commonName: 'Keystore Carregada',
    organization: 'Certificado Externo',
    country: '--',
    sha1Fingerprint,
    sha256Fingerprint,
    mode: 'custom_uploaded',
    fileName: cleanName,
    createdAt: new Date().toISOString(),
  };

  const record: StoredKeystoreRecord = {
    metadata,
    encryptedPassword: encryptText(params.password),
    encryptedAliasPassword: encryptText(params.password),
    encryptedKeystoreBase64: encryptBuffer(params.buffer).toString('base64'),
  };

  await fs.writeFile(
    safeJoin(userDir, `${keystoreId}.json`),
    JSON.stringify(record, null, 2),
    'utf8'
  );

  return metadata;
}

export async function listUserKeystores(ownerId: string): Promise<KeystoreMetadata[]> {
  const uid = sanitizeId(ownerId);
  const userDir = safeJoin(KEYSTORE_ROOT, uid);
  try {
    const files = await fs.readdir(userDir);
    const items: KeystoreMetadata[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await fs.readFile(safeJoin(userDir, file), 'utf8');
      const parsed = JSON.parse(raw) as StoredKeystoreRecord;
      items.push(parsed.metadata);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function loadDecryptedKeystore(
  ownerId: string,
  keystoreId: string
): Promise<{ metadata: KeystoreMetadata; password: string; buffer: Buffer } | null> {
  const uid = sanitizeId(ownerId);
  const ksid = sanitizeId(keystoreId);
  try {
    const raw = await fs.readFile(safeJoin(KEYSTORE_ROOT, uid, `${ksid}.json`), 'utf8');
    const record = JSON.parse(raw) as StoredKeystoreRecord;
    return {
      metadata: record.metadata,
      password: decryptText(record.encryptedPassword),
      buffer: decryptBuffer(Buffer.from(record.encryptedKeystoreBase64, 'base64')),
    };
  } catch {
    return null;
  }
}
