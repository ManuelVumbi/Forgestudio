import { auth } from '../lib/firebase';
import {
  AppProject,
  InfrastructureProbe,
  KeystoreMetadata,
  UploadedBundleSummary,
  UrlAnalysisResult,
} from '../types/appforge';

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

function resolveApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return RAW_API_BASE ? `${RAW_API_BASE}${normalizedPath}` : normalizedPath;
}

async function parseJsonSafely(res: Response, fallbackMsg: string): Promise<any> {
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (!ctype.includes('application/json')) {
    const text = await res.text().catch(() => '');
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'O servidor de compilação (/api) não está ligado a este domínio estático. Configure VITE_API_BASE_URL ou utilize a aplicação no servidor principal.'
      );
    }
    throw new Error(fallbackMsg);
  }
  return res.json();
}

async function getBearerHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão expirada. Inicie sessão novamente.');
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export async function apiAnalyzeUrl(url: string): Promise<UrlAnalysisResult> {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl('/api/analyze-url'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await parseJsonSafely(res, 'Erro ao analisar URL.');
  if (!res.ok) throw new Error(data.error || 'Erro ao analisar URL.');
  return data;
}

export async function apiCaptureOffline(url: string): Promise<UploadedBundleSummary> {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl('/api/capture-offline'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await parseJsonSafely(res, 'Erro ao capturar versão offline.');
  if (!res.ok) throw new Error(data.error || 'Erro ao capturar versão offline.');
  return data;
}

export async function apiUploadProjectFiles(files: File[]): Promise<UploadedBundleSummary> {
  const headers = await getBearerHeader();
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const res = await fetch(resolveApiUrl('/api/upload-project'), {
    method: 'POST',
    headers,
    body: form,
  });
  const data = await parseJsonSafely(res, 'Erro ao carregar ficheiros.');
  if (!res.ok) throw new Error(data.error || 'Erro ao carregar ficheiros.');
  return data;
}

export async function apiListKeystores(): Promise<KeystoreMetadata[]> {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl('/api/keystores'), { headers });
  const data = await parseJsonSafely(res, 'Erro ao listar keystores.');
  if (!res.ok) throw new Error(data.error || 'Erro ao listar keystores.');
  return data.keystores || [];
}

export async function apiGenerateKeystore(payload: {
  alias: string;
  password: string;
  commonName: string;
  organization: string;
  country: string;
}): Promise<KeystoreMetadata> {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl('/api/keystores/generate'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafely(res, 'Erro ao gerar Keystore.');
  if (!res.ok) throw new Error(data.error || 'Erro ao gerar Keystore.');
  return data.keystore;
}

export async function apiUploadKeystore(
  file: File,
  alias: string,
  password: string
): Promise<KeystoreMetadata> {
  const headers = await getBearerHeader();
  const form = new FormData();
  form.append('keystore', file);
  form.append('alias', alias);
  form.append('password', password);
  const res = await fetch(resolveApiUrl('/api/keystores/upload'), {
    method: 'POST',
    headers,
    body: form,
  });
  const data = await parseJsonSafely(res, 'Erro ao carregar Keystore.');
  if (!res.ok) throw new Error(data.error || 'Erro ao carregar Keystore.');
  return data.keystore;
}

export async function apiProbeInfrastructure(params?: {
  androidWorkerUrl?: string;
  windowsWorkerUrl?: string;
}): Promise<InfrastructureProbe> {
  const headers = await getBearerHeader();
  const qs = new URLSearchParams();
  if (params?.androidWorkerUrl) qs.set('androidWorkerUrl', params.androidWorkerUrl);
  if (params?.windowsWorkerUrl) qs.set('windowsWorkerUrl', params.windowsWorkerUrl);
  const url = resolveApiUrl(`/api/infrastructure/probe${qs.toString() ? `?${qs.toString()}` : ''}`);
  const res = await fetch(url, { headers });
  const data = await parseJsonSafely(res, 'Erro ao verificar infraestrutura.');
  if (!res.ok) throw new Error(data.error || 'Erro ao verificar infraestrutura.');
  return data;
}

export async function apiStartBuild(
  project: AppProject,
  workerConfig?: { androidWorkerUrl?: string; windowsWorkerUrl?: string; workerToken?: string }
) {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl('/api/builds/start'), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, workerConfig }),
  });
  const data = await parseJsonSafely(res, 'Erro ao iniciar compilação.');
  if (!res.ok) throw new Error(data.error || 'Erro ao iniciar compilação.');
  return data.build;
}

export async function apiGetBuildStatus(buildId: string) {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl(`/api/builds/${encodeURIComponent(buildId)}/status`), {
    headers,
  });
  const data = await parseJsonSafely(res, 'Erro ao consultar compilação.');
  if (!res.ok) throw new Error(data.error || 'Erro ao consultar compilação.');
  return data.build;
}

export async function apiCancelBuild(buildId: string) {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl(`/api/builds/${encodeURIComponent(buildId)}/cancel`), {
    method: 'POST',
    headers,
  });
  const data = await parseJsonSafely(res, 'Erro ao cancelar compilação.');
  if (!res.ok) throw new Error(data.error || 'Erro ao cancelar compilação.');
  return data;
}

export async function apiDownloadArtifact(downloadUrl: string, fileName: string): Promise<void> {
  const headers = await getBearerHeader();
  const res = await fetch(resolveApiUrl(downloadUrl), { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Falha ao descarregar.' }));
    throw new Error(err.error || 'Falha ao descarregar artefacto.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
