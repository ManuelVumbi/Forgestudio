import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import {
  AppProject,
  BuildArtifact,
  BuildStatus,
  InfrastructureProbe,
} from '../src/types/appforge.ts';
import { compileAndroidBinaries } from './engines/androidBinaryCompiler.ts';
import { generateAndroidProjectZip } from './engines/androidGenerator.ts';
import { compileWindowsBinaries } from './engines/windowsBinaryCompiler.ts';
import { generateWindowsProjectZip } from './engines/windowsGenerator.ts';
import { captureWebsiteOfflineBundle } from './offlineCrawler.ts';
import { safeJoin, sanitizeId, sha256Hex, validateSafePublicUrl } from './security.ts';
import { ANDROID_SDK_DIR, ensureAllToolchains } from './toolchainBootstrap.ts';

const execFileAsync = promisify(execFile);

const ARTIFACT_ROOT = path.resolve(process.cwd(), 'workspace', 'artifacts');
const BUILD_WORK_ROOT = path.resolve(process.cwd(), 'workspace', 'builds');

export interface BuildJobRuntime {
  buildId: string;
  ownerId: string;
  projectId: string;
  status: BuildStatus;
  progress: number;
  currentStep: string;
  logs: string[];
  artifacts: BuildArtifact[];
  missingInfrastructure: string[];
  errorMessage?: string;
  cancelled: boolean;
  completedAt?: string;
}

const activeJobs = new Map<string, BuildJobRuntime>();
const jobQueue: Array<{
  buildId: string;
  project: AppProject;
  workerConfig?: {
    androidWorkerUrl?: string;
    windowsWorkerUrl?: string;
    workerToken?: string;
  };
}> = [];
let runningCount = 0;
const MAX_CONCURRENCY = 2;

async function checkBinary(cmd: string, args: string[]): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 3000 });
    const text = (stdout || stderr || '').trim().split('\n')[0];
    return { available: true, version: text.slice(0, 80) };
  } catch {
    return { available: false };
  }
}

async function checkRemoteWorkerHealth(url?: string): Promise<boolean> {
  if (!url || !url.trim()) return false;
  try {
    const parsed = await validateSafePublicUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(new URL('/health', parsed).toString(), { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

export async function probeInfrastructure(custom?: {
  androidWorkerUrl?: string;
  windowsWorkerUrl?: string;
}): Promise<InfrastructureProbe> {
  const androidWorkerUrl = (custom?.androidWorkerUrl || process.env.ANDROID_WORKER_URL || '').trim();
  const windowsWorkerUrl = (custom?.windowsWorkerUrl || process.env.WINDOWS_WORKER_URL || '').trim();

  const [tc, java, javac, makensis, mingw, androidWorkerReachable, windowsWorkerReachable] =
    await Promise.all([
      ensureAllToolchains(),
      checkBinary('java', ['-version']),
      checkBinary('javac', ['-version']),
      checkBinary('makensis', ['-VERSION']),
      checkBinary('x86_64-w64-mingw32-g++', ['--version']),
      checkRemoteWorkerHealth(androidWorkerUrl),
      checkRemoteWorkerHealth(windowsWorkerUrl),
    ]);

  const androidReady = tc.androidReady || androidWorkerReachable;
  const aabReady = tc.aabReady || androidWorkerReachable;
  const windowsReady = tc.windowsReady || windowsWorkerReachable;

  const missingForAndroidBinary: string[] = [];
  if (!androidReady) {
    if (!javac.available) missingForAndroidBinary.push('JDK 17 (javac)');
    if (!tc.androidReady) missingForAndroidBinary.push('Android SDK Build-Tools 34 (aapt2 + d8 + apksigner)');
  }

  const missingForWindowsBinary: string[] = [];
  if (!windowsReady) {
    if (!mingw.available) missingForWindowsBinary.push('MinGW-w64 (x86_64-w64-mingw32-g++)');
    if (!makensis.available) missingForWindowsBinary.push('NSIS (makensis)');
    if (!tc.windowsReady) missingForWindowsBinary.push('Edge WebView2 SDK');
  }

  return {
    hostOs: `${process.platform} (${process.arch})`,
    nodeVersion: process.version,
    localTools: {
      java: java.available ? java : javac,
      gradle: {
        available: tc.androidReady,
        version: tc.androidReady ? 'aapt2 + d8 + apksigner + bundletool' : undefined,
      },
      androidSdk: { available: tc.androidReady, path: tc.androidReady ? ANDROID_SDK_DIR : undefined },
      makensis,
      wine: {
        available: mingw.available,
        version: mingw.available ? 'MinGW-w64 x86_64 + Edge WebView2' : undefined,
      },
      electronBuilder: {
        available: tc.windowsReady,
        version: tc.windowsReady ? 'Native Win32 + WebView2 + NSIS' : undefined,
      },
      zipEngine: { available: true },
    },
    remoteWorkers: {
      androidWorkerUrl,
      androidWorkerReachable,
      windowsWorkerUrl,
      windowsWorkerReachable,
    },
    capabilities: {
      sourceCodeGeneration: true,
      keystoreGeneration: true,
      androidApkCompilation: androidReady,
      androidAabCompilation: aabReady,
      windowsExeCompilation: windowsReady,
      windowsPortableCompilation: windowsReady,
    },
    missingForAndroidBinary,
    missingForWindowsBinary,
  };
}

function appendLog(job: BuildJobRuntime, msg: string) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 8);
  job.logs = [...job.logs.slice(-49), `[${ts}] ${msg}`];
}

async function dispatchToRemoteWorker(params: {
  workerUrl: string;
  token?: string;
  sourceZip: Buffer;
  format: string;
  project: AppProject;
}): Promise<Buffer> {
  const safe = await validateSafePublicUrl(params.workerUrl);
  const endpoint = new URL('/compile', safe).toString();
  const form = new FormData();
  form.append('format', params.format);
  form.append('packageName', params.project.packageName);
  form.append('versionName', params.project.versionName);
  form.append('sourceZip', new Blob([new Uint8Array(params.sourceZip)], { type: 'application/zip' }), 'project.zip');

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: params.token ? { Authorization: `Bearer ${params.token}` } : undefined,
    body: form,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Worker remoto respondeu ${resp.status}: ${errText.slice(0, 180)}`);
  }

  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function runJob(
  buildId: string,
  project: AppProject,
  workerConfig?: { androidWorkerUrl?: string; windowsWorkerUrl?: string; workerToken?: string }
) {
  const job = activeJobs.get(buildId);
  if (!job || job.cancelled) return;

  const uid = sanitizeId(project.ownerId);
  const bid = sanitizeId(buildId);
  const artifactDir = safeJoin(ARTIFACT_ROOT, uid, bid);
  const workDir = safeJoin(BUILD_WORK_ROOT, bid);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });

  const slug = project.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

  try {
    let workingProject: AppProject = project;
    job.status = 'processing';
    job.progress = 12;
    job.currentStep = 'A validar origem e parâmetros do projecto';
    appendLog(job, `Iniciando pipeline isolado para "${workingProject.appName}" (${workingProject.packageName})`);

    if (workingProject.conversionType === 'url' && workingProject.sourceUrl) {
      await validateSafePublicUrl(workingProject.sourceUrl);
      appendLog(job, `URL validado contra SSRF: ${workingProject.sourceUrl}`);

      if (
        (workingProject.advanced.offlineMode === 'offline_app' ||
          workingProject.advanced.offlineMode === 'cache_first') &&
        !workingProject.sourceBundleId
      ) {
        job.progress = 18;
        job.currentStep = 'A capturar recursos web (HTML, CSS, JS, imagens, fontes) para funcionamento offline';
        appendLog(job, `A espelhar sistema web para pacote offline (${workingProject.advanced.offlineMode})...`);
        try {
          const captured = await captureWebsiteOfflineBundle(
            workingProject.ownerId,
            workingProject.sourceUrl
          );
          workingProject = { ...workingProject, sourceBundleId: captured.bundleId };
          appendLog(
            job,
            `Captura offline concluída: ${captured.fileCount} ficheiro(s) (${(
              captured.totalBytes / 1024
            ).toFixed(1)} KB) em ${captured.bundleId}`
          );
        } catch (capErr: any) {
          if (workingProject.advanced.offlineMode === 'offline_app') {
            throw new Error(`Falha na captura offline do website: ${capErr.message}`);
          }
          appendLog(job, `Aviso na captura cache_first (seguirá com página offline de reserva): ${capErr.message}`);
        }
      }
    } else if (workingProject.sourceBundleId) {
      appendLog(job, `Bundle offline associado: ${workingProject.sourceBundleId}`);
    }

    if (job.cancelled) throw new Error('Compilação cancelada pelo utilizador.');

    job.progress = 24;
    job.currentStep = 'A verificar e preparar compiladores nativos (Android SDK & Windows MinGW/NSIS)';
    const tc = await ensureAllToolchains();
    const infra = await probeInfrastructure({
      androidWorkerUrl: workerConfig?.androidWorkerUrl,
      windowsWorkerUrl: workerConfig?.windowsWorkerUrl,
    });
    appendLog(job, `Ambiente host: ${infra.hostOs}, Node ${infra.nodeVersion}`);

    const wantsAndroidBinary =
      workingProject.platforms.androidApkDebug ||
      workingProject.platforms.androidApkRelease ||
      workingProject.platforms.androidAab;
    const wantsWindowsBinary =
      workingProject.platforms.windowsExe || workingProject.platforms.windowsPortable;

    let androidSourceBuf: Buffer | null = null;
    let windowsSourceBuf: Buffer | null = null;

    if (workingProject.platforms.exportSourceCode && (wantsAndroidBinary || !wantsWindowsBinary)) {
      job.progress = 34;
      job.currentStep = 'A gerar código-fonte Android (Kotlin + Gradle)';
      androidSourceBuf = await generateAndroidProjectZip(workingProject, { includeKeystoreInBuild: true });
      const fileName = `${slug}-android-source-${workingProject.versionName}.zip`;
      await fs.writeFile(safeJoin(artifactDir, fileName), androidSourceBuf);
      job.artifacts.push({
        format: 'ANDROID_SOURCE_ZIP',
        label: 'Código-Fonte Android (Gradle / Kotlin)',
        fileName,
        sizeBytes: androidSourceBuf.length,
        downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(fileName)}`,
        sha256: sha256Hex(androidSourceBuf),
        status: 'ready',
      });
      appendLog(job, `Código-fonte Android gerado (${(androidSourceBuf.length / 1024).toFixed(1)} KB)`);
    }

    if (job.cancelled) throw new Error('Compilação cancelada pelo utilizador.');

    if (workingProject.platforms.exportSourceCode && wantsWindowsBinary) {
      job.progress = 42;
      job.currentStep = 'A gerar código-fonte Windows (Electron Builder)';
      windowsSourceBuf = await generateWindowsProjectZip(workingProject);
      const fileName = `${slug}-windows-source-${workingProject.versionName}.zip`;
      await fs.writeFile(safeJoin(artifactDir, fileName), windowsSourceBuf);
      job.artifacts.push({
        format: 'WINDOWS_SOURCE_ZIP',
        label: 'Código-Fonte Windows (Electron Builder)',
        fileName,
        sizeBytes: windowsSourceBuf.length,
        downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(fileName)}`,
        sha256: sha256Hex(windowsSourceBuf),
        status: 'ready',
      });
      appendLog(job, `Código-fonte Windows gerado (${(windowsSourceBuf.length / 1024).toFixed(1)} KB)`);
    }

    if (job.cancelled) throw new Error('Compilação cancelada pelo utilizador.');

    const missingInfraSet = new Set<string>();

    // 1. Native Local Android Binary Compilation (APK Debug, APK Release, AAB)
    if (wantsAndroidBinary) {
      job.status = 'compiling';
      job.progress = 55;
      job.currentStep = 'A compilar pacotes instaláveis Android (.APK / .AAB)';

      if (tc.androidReady) {
        try {
          const compiled = await compileAndroidBinaries(
            workingProject,
            workDir,
            {
              debugApk: workingProject.platforms.androidApkDebug,
              releaseApk: workingProject.platforms.androidApkRelease,
              aab: workingProject.platforms.androidAab && tc.aabReady,
            },
            (msg) => appendLog(job, msg)
          );

          const pushArtifact = async (
            buf: Buffer | undefined,
            format: BuildArtifact['format'],
            ext: string,
            label: string,
            targetError?: string
          ) => {
            const outName = `${slug}-v${project.versionName}-${ext}`;
            if (buf) {
              await fs.writeFile(safeJoin(artifactDir, outName), buf);
              job.artifacts.push({
                format,
                label,
                fileName: outName,
                sizeBytes: buf.length,
                downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(outName)}`,
                sha256: sha256Hex(buf),
                status: 'ready',
              });
              appendLog(job, `${label} pronto (${(buf.length / 1024).toFixed(1)} KB).`);
            } else if (targetError) {
              job.artifacts.push({
                format,
                label,
                fileName: outName,
                sizeBytes: 0,
                status: 'failed',
                missingRequirements: [targetError],
              });
            }
          };

          if (workingProject.platforms.androidApkDebug) {
            await pushArtifact(
              compiled.debugApk,
              'APK_DEBUG',
              'debug.apk',
              'Android APK (Debug)',
              compiled.errors?.debugApk
            );
          }
          if (workingProject.platforms.androidApkRelease) {
            await pushArtifact(
              compiled.releaseApk,
              'APK_RELEASE',
              'release.apk',
              'Android APK (Release Assinado)',
              compiled.errors?.releaseApk
            );
          }
          if (workingProject.platforms.androidAab) {
            if (!tc.aabReady) {
              missingInfraSet.add('Bundletool JAR');
              job.artifacts.push({
                format: 'AAB',
                label: 'Android App Bundle (AAB)',
                fileName: `${slug}-v${project.versionName}-release.aab`,
                sizeBytes: 0,
                status: 'missing_infrastructure',
                missingRequirements: ['Bundletool JAR'],
              });
            } else {
              await pushArtifact(
                compiled.aab,
                'AAB',
                'release.aab',
                'Android App Bundle (AAB)',
                compiled.errors?.aab
              );
            }
          }
        } catch (err: any) {
          const detail = err?.stderr ? `${err.message} (${String(err.stderr).slice(0, 200)})` : err.message;
          appendLog(job, `Erro ao compilar binários Android: ${detail}`);
          const targets = [
            project.platforms.androidApkDebug && { format: 'APK_DEBUG' as const, ext: 'debug.apk', label: 'Android APK (Debug)' },
            project.platforms.androidApkRelease && { format: 'APK_RELEASE' as const, ext: 'release.apk', label: 'Android APK (Release Assinado)' },
            project.platforms.androidAab && { format: 'AAB' as const, ext: 'release.aab', label: 'Android App Bundle (AAB)' },
          ].filter(Boolean) as Array<{ format: BuildArtifact['format']; ext: string; label: string }>;
          for (const t of targets) {
            job.artifacts.push({
              format: t.format,
              label: t.label,
              fileName: `${slug}-v${project.versionName}-${t.ext}`,
              sizeBytes: 0,
              status: 'failed',
              missingRequirements: [err.message],
            });
          }
        }
      } else if (infra.remoteWorkers.androidWorkerReachable) {
        if (!androidSourceBuf) {
          androidSourceBuf = await generateAndroidProjectZip(workingProject, { includeKeystoreInBuild: true });
        }
        const targets = [
          workingProject.platforms.androidApkDebug && { format: 'APK_DEBUG' as const, ext: 'debug.apk', label: 'Android APK (Debug)' },
          workingProject.platforms.androidApkRelease && { format: 'APK_RELEASE' as const, ext: 'release.apk', label: 'Android APK (Release Assinado)' },
          workingProject.platforms.androidAab && { format: 'AAB' as const, ext: 'release.aab', label: 'Android App Bundle (AAB)' },
        ].filter(Boolean) as Array<{ format: BuildArtifact['format']; ext: string; label: string }>;
        for (const target of targets) {
          try {
            appendLog(job, `A enviar ${target.label} para Worker Remoto Android...`);
            const binBuf = await dispatchToRemoteWorker({
              workerUrl: infra.remoteWorkers.androidWorkerUrl,
              token: workerConfig?.workerToken,
              sourceZip: androidSourceBuf,
              format: target.format,
              project: workingProject,
            });
            const outName = `${slug}-v${project.versionName}-${target.ext}`;
            await fs.writeFile(safeJoin(artifactDir, outName), binBuf);
            job.artifacts.push({
              format: target.format,
              label: target.label,
              fileName: outName,
              sizeBytes: binBuf.length,
              downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(outName)}`,
              sha256: sha256Hex(binBuf),
              status: 'ready',
            });
          } catch (err: any) {
            job.artifacts.push({
              format: target.format,
              label: target.label,
              fileName: `${slug}-v${project.versionName}-${target.ext}`,
              sizeBytes: 0,
              status: 'failed',
              missingRequirements: [err.message],
            });
          }
        }
      } else {
        infra.missingForAndroidBinary.forEach((m) => missingInfraSet.add(m));
        const targets = [
          project.platforms.androidApkDebug && { format: 'APK_DEBUG' as const, ext: 'debug.apk', label: 'Android APK (Debug)' },
          project.platforms.androidApkRelease && { format: 'APK_RELEASE' as const, ext: 'release.apk', label: 'Android APK (Release Assinado)' },
          project.platforms.androidAab && { format: 'AAB' as const, ext: 'release.aab', label: 'Android App Bundle (AAB)' },
        ].filter(Boolean) as Array<{ format: BuildArtifact['format']; ext: string; label: string }>;
        for (const t of targets) {
          job.artifacts.push({
            format: t.format,
            label: t.label,
            fileName: `${slug}-v${project.versionName}-${t.ext}`,
            sizeBytes: 0,
            status: 'missing_infrastructure',
            missingRequirements: infra.missingForAndroidBinary,
          });
        }
      }
    }

    if (job.cancelled) throw new Error('Compilação cancelada pelo utilizador.');

    // 2. Native Local Windows Binary Compilation (NSIS Setup .EXE & Portable .EXE)
    if (wantsWindowsBinary) {
      job.status = 'compiling';
      job.progress = 80;
      job.currentStep = 'A compilar executáveis Windows (.EXE Instalador & Portátil)';

      if (tc.windowsReady) {
        try {
          const winCompiled = await compileWindowsBinaries(
            workingProject,
            workDir,
            {
              installerExe: workingProject.platforms.windowsExe,
              portableExe: workingProject.platforms.windowsPortable,
            },
            (msg) => appendLog(job, msg)
          );

          if (winCompiled.installerExe) {
            const outName = `${slug}-v${project.versionName}-setup.exe`;
            await fs.writeFile(safeJoin(artifactDir, outName), winCompiled.installerExe);
            job.artifacts.push({
              format: 'WINDOWS_EXE',
              label: 'Instalador Windows (.EXE)',
              fileName: outName,
              sizeBytes: winCompiled.installerExe.length,
              downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(outName)}`,
              sha256: sha256Hex(winCompiled.installerExe),
              status: 'ready',
            });
          }
          if (winCompiled.portableExe) {
            const outName = `${slug}-v${project.versionName}-portable.exe`;
            await fs.writeFile(safeJoin(artifactDir, outName), winCompiled.portableExe);
            job.artifacts.push({
              format: 'WINDOWS_PORTABLE',
              label: 'Windows Portátil (.EXE)',
              fileName: outName,
              sizeBytes: winCompiled.portableExe.length,
              downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(outName)}`,
              sha256: sha256Hex(winCompiled.portableExe),
              status: 'ready',
            });
          }
        } catch (err: any) {
          appendLog(job, `Erro ao compilar binários Windows: ${err.message}`);
          if (project.platforms.windowsExe) {
            job.artifacts.push({
              format: 'WINDOWS_EXE',
              label: 'Instalador Windows (.EXE)',
              fileName: `${slug}-v${project.versionName}-setup.exe`,
              sizeBytes: 0,
              status: 'failed',
              missingRequirements: [err.message],
            });
          }
          if (project.platforms.windowsPortable) {
            job.artifacts.push({
              format: 'WINDOWS_PORTABLE',
              label: 'Windows Portátil (.EXE)',
              fileName: `${slug}-v${project.versionName}-portable.exe`,
              sizeBytes: 0,
              status: 'failed',
              missingRequirements: [err.message],
            });
          }
        }
      } else if (infra.remoteWorkers.windowsWorkerReachable) {
        if (!windowsSourceBuf) {
          windowsSourceBuf = await generateWindowsProjectZip(workingProject);
        }
        const winTargets = [
          workingProject.platforms.windowsExe && { format: 'WINDOWS_EXE' as const, ext: 'setup.exe', label: 'Instalador Windows (.EXE)' },
          workingProject.platforms.windowsPortable && { format: 'WINDOWS_PORTABLE' as const, ext: 'portable.exe', label: 'Windows Portátil (.EXE)' },
        ].filter(Boolean) as Array<{ format: BuildArtifact['format']; ext: string; label: string }>;
        for (const target of winTargets) {
          try {
            const binBuf = await dispatchToRemoteWorker({
              workerUrl: infra.remoteWorkers.windowsWorkerUrl,
              token: workerConfig?.workerToken,
              sourceZip: windowsSourceBuf,
              format: target.format,
              project: workingProject,
            });
            const outName = `${slug}-v${project.versionName}-${target.ext}`;
            await fs.writeFile(safeJoin(artifactDir, outName), binBuf);
            job.artifacts.push({
              format: target.format,
              label: target.label,
              fileName: outName,
              sizeBytes: binBuf.length,
              downloadUrl: `/api/artifacts/${bid}/${encodeURIComponent(outName)}`,
              sha256: sha256Hex(binBuf),
              status: 'ready',
            });
          } catch (err: any) {
            job.artifacts.push({
              format: target.format,
              label: target.label,
              fileName: `${slug}-v${project.versionName}-${target.ext}`,
              sizeBytes: 0,
              status: 'failed',
              missingRequirements: [err.message],
            });
          }
        }
      } else {
        infra.missingForWindowsBinary.forEach((m) => missingInfraSet.add(m));
        if (project.platforms.windowsExe) {
          job.artifacts.push({
            format: 'WINDOWS_EXE',
            label: 'Instalador Windows (.EXE)',
            fileName: `${slug}-v${project.versionName}-setup.exe`,
            sizeBytes: 0,
            status: 'missing_infrastructure',
            missingRequirements: infra.missingForWindowsBinary,
          });
        }
        if (project.platforms.windowsPortable) {
          job.artifacts.push({
            format: 'WINDOWS_PORTABLE',
            label: 'Windows Portátil (.EXE)',
            fileName: `${slug}-v${project.versionName}-portable.exe`,
            sizeBytes: 0,
            status: 'missing_infrastructure',
            missingRequirements: infra.missingForWindowsBinary,
          });
        }
      }
    }

    job.missingInfrastructure = [...missingInfraSet];
    const anyFailed = job.artifacts.some((a) => a.status !== 'ready');

    job.progress = 100;
    if (anyFailed || job.artifacts.length === 0) {
      job.status = 'failed';
      job.currentStep = 'Compilação concluída com erros parciais';
      job.errorMessage =
        'Um ou mais binários não puderam ser compilados. Consulte o registo de compilação abaixo.';
    } else {
      job.status = 'completed';
      job.currentStep = 'Compilação concluída com sucesso';
    }
    job.completedAt = new Date().toISOString();
    appendLog(job, job.currentStep);
  } catch (err: any) {
    if (job.cancelled) {
      job.status = 'cancelled';
      job.currentStep = 'Cancelado';
      appendLog(job, 'Compilação cancelada.');
    } else {
      job.status = 'failed';
      job.errorMessage = err.message || 'Erro interno no motor de compilação.';
      job.currentStep = 'Erro na compilação';
      appendLog(job, `Erro: ${job.errorMessage}`);
    }
    job.completedAt = new Date().toISOString();
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function pumpQueue() {
  while (runningCount < MAX_CONCURRENCY && jobQueue.length > 0) {
    const next = jobQueue.shift()!;
    const job = activeJobs.get(next.buildId);
    if (!job || job.cancelled) continue;
    runningCount++;
    runJob(next.buildId, next.project, next.workerConfig).finally(() => {
      runningCount--;
      pumpQueue();
    });
  }
}

export function enqueueBuildJob(
  project: AppProject,
  workerConfig?: { androidWorkerUrl?: string; windowsWorkerUrl?: string; workerToken?: string }
): BuildJobRuntime {
  const buildId = `bld_${crypto.randomBytes(8).toString('hex')}`;
  const runtime: BuildJobRuntime = {
    buildId,
    ownerId: project.ownerId,
    projectId: project.id,
    status: 'queued',
    progress: 4,
    currentStep: 'Na fila de compilação isolada',
    logs: [`[${new Date().toISOString().split('T')[1].slice(0, 8)}] Tarefa adicionada à fila (${project.appName})`],
    artifacts: [],
    missingInfrastructure: [],
    cancelled: false,
  };
  activeJobs.set(buildId, runtime);
  jobQueue.push({ buildId, project, workerConfig });
  pumpQueue();
  return runtime;
}

export function getBuildJobStatus(buildId: string, ownerId: string): BuildJobRuntime | null {
  const job = activeJobs.get(buildId);
  if (!job || job.ownerId !== ownerId) return null;
  return job;
}

export function cancelBuildJob(buildId: string, ownerId: string): boolean {
  const job = activeJobs.get(buildId);
  if (!job || job.ownerId !== ownerId) return false;
  job.cancelled = true;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.currentStep = 'Cancelado na fila';
    job.completedAt = new Date().toISOString();
  }
  return true;
}

export async function resolveArtifactFile(
  ownerId: string,
  buildId: string,
  fileName: string
): Promise<string | null> {
  const uid = sanitizeId(ownerId);
  const bid = sanitizeId(buildId);
  const cleanName = path.basename(fileName);
  const fullPath = safeJoin(ARTIFACT_ROOT, uid, bid, cleanName);
  try {
    await fs.access(fullPath);
    return fullPath;
  } catch {
    return null;
  }
}
