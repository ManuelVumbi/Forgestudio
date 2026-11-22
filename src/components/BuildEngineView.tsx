import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Code2,
  Download,
  Monitor,
  Package,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  apiCancelBuild,
  apiDownloadArtifact,
  apiGetBuildStatus,
  apiProbeInfrastructure,
} from '../services/apiClient';
import { recordDownload, syncBuildJobDoc } from '../services/firestoreService';
import { BuildArtifact, BuildJob, InfrastructureProbe } from '../types/appforge';

interface BuildEngineViewProps {
  focusedBuildId?: string | null;
  onGoToAdminInfra?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'A aguardar',
  processing: 'Em processamento',
  compiling: 'A compilar',
  completed: 'Compilação concluída',
  failed: 'Erro / Infraestrutura Pendente',
  cancelled: 'Cancelado',
};

function getArtifactMeta(format: BuildArtifact['format']) {
  switch (format) {
    case 'APK_DEBUG':
      return {
        icon: Smartphone,
        platform: 'Android',
        installTip: 'Instale directamente no telemóvel Android para testes rápidos (ícone + Splash nativos).',
      };
    case 'APK_RELEASE':
      return {
        icon: Smartphone,
        platform: 'Android Assinado',
        installTip: 'APK pronto para instalação directa com assinatura digital e ícone adaptativo.',
      };
    case 'AAB':
      return {
        icon: Package,
        platform: 'Google Play Store',
        installTip: 'Submeta este Android App Bundle directamente na Google Play Console.',
      };
    case 'WINDOWS_EXE':
      return {
        icon: Monitor,
        platform: 'Windows 10/11',
        installTip: 'Instalador moderno MUI2 com logótipo, barra lateral, atalhos com ícone e desinstalador.',
      };
    case 'WINDOWS_PORTABLE':
      return {
        icon: Monitor,
        platform: 'Windows Portátil',
        installTip: 'Execute directamente sem instalar; ícone nativo e suporte offline incorporados.',
      };
    case 'ANDROID_SOURCE_ZIP':
      return {
        icon: Code2,
        platform: 'Código-Fonte Android',
        installTip: 'Projecto Android Studio (Gradle/Java) pronto para personalização ou compilação local.',
      };
    case 'WINDOWS_SOURCE_ZIP':
    default:
      return {
        icon: Code2,
        platform: 'Código-Fonte Windows',
        installTip: 'Projecto Electron / WebView2 pronto para personalização e build desktop.',
      };
  }
}

export const BuildEngineView: React.FC<BuildEngineViewProps> = ({
  focusedBuildId,
  onGoToAdminInfra,
}) => {
  const { user, builds, engineSettings, isAdmin } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(focusedBuildId || null);
  const [probe, setProbe] = useState<InfrastructureProbe | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusedBuildId) setSelectedId(focusedBuildId);
    else if (!selectedId && builds.length > 0) setSelectedId(builds[0].id);
  }, [focusedBuildId, builds, selectedId]);

  useEffect(() => {
    apiProbeInfrastructure({
      androidWorkerUrl: engineSettings.androidWorkerUrl,
      windowsWorkerUrl: engineSettings.windowsWorkerUrl,
    })
      .then(setProbe)
      .catch(() => {});
  }, [engineSettings.androidWorkerUrl, engineSettings.windowsWorkerUrl]);

  const activeBuild: BuildJob | undefined =
    builds.find((b) => b.id === selectedId) || builds[0];

  // Poll live backend worker while build is non-terminal and sync to Firestore
  useEffect(() => {
    if (!activeBuild) return;
    if (['completed', 'failed', 'cancelled'].includes(activeBuild.status)) return;

    const timer = setInterval(async () => {
      try {
        const runtime = await apiGetBuildStatus(activeBuild.id);
        const isTerminal = ['completed', 'failed', 'cancelled'].includes(runtime.status);
        await syncBuildJobDoc(activeBuild.id, {
          status: runtime.status,
          progress: runtime.progress,
          currentStep: runtime.currentStep,
          logs: runtime.logs,
          artifacts: runtime.artifacts,
          missingInfrastructure: runtime.missingInfrastructure,
          errorMessage: runtime.errorMessage,
          isTerminal,
        });
      } catch {
        // Build may have been from an earlier container restart
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [activeBuild?.id, activeBuild?.status]);

  const handleDownload = async (artifact: BuildArtifact, build: BuildJob) => {
    if (!artifact.downloadUrl || !user) return;
    setDownloadingFile(artifact.fileName);
    setError(null);
    try {
      await apiDownloadArtifact(artifact.downloadUrl, artifact.fileName);
      await recordDownload({
        ownerId: user.uid,
        buildId: build.id,
        projectId: build.projectId,
        appName: build.appName,
        format: artifact.format,
        fileName: artifact.fileName,
        sizeBytes: artifact.sizeBytes,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloadingFile(null);
    }
  };

  const handleCancel = async (buildId: string) => {
    try {
      await apiCancelBuild(buildId);
      const runtime = await apiGetBuildStatus(buildId);
      await syncBuildJobDoc(buildId, {
        status: 'cancelled',
        progress: runtime.progress,
        currentStep: 'Cancelado pelo utilizador',
        logs: runtime.logs,
        artifacts: runtime.artifacts,
        missingInfrastructure: runtime.missingInfrastructure,
        isTerminal: true,
      });
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Motor Automático de Compilação
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Fila isolada de compilação nativa Android (.APK / .AAB) e Windows (.EXE / Portátil) com logs em tempo real.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            apiProbeInfrastructure({
              androidWorkerUrl: engineSettings.androidWorkerUrl,
              windowsWorkerUrl: engineSettings.windowsWorkerUrl,
            }).then(setProbe)
          }
          className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Verificar Infraestrutura</span>
        </button>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Honest Infrastructure Readiness Strip */}
      {probe && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-900/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-slate-700 dark:text-slate-300" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Estado dos Motores de Compilação ({probe.hostOs})
              </h2>
            </div>
            {isAdmin && onGoToAdminInfra && (
              <button
                type="button"
                onClick={onGoToAdminInfra}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Gerir Motores no Painel Admin
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">
                Código-Fonte Android &amp; Windows
              </span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                Operacional (ZIP Nativo)
              </span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">
                Keystores PKCS#12 (RSA-2048)
              </span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                Operacional (AES-256-GCM)
              </span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">
                Compilador Binário APK / AAB
              </span>
              <span
                className={`font-semibold ${
                  probe.capabilities.androidApkCompilation
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {probe.capabilities.androidApkCompilation
                  ? 'Pronto (SDK 34 + apksigner)'
                  : `Pendente: ${probe.missingForAndroidBinary[0] || 'Android SDK'}`}
              </span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <span className="text-slate-500 dark:text-slate-400 block mb-1">
                Compilador Binário Windows EXE
              </span>
              <span
                className={`font-semibold ${
                  probe.capabilities.windowsExeCompilation
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {probe.capabilities.windowsExeCompilation
                  ? 'Pronto (MinGW + WebView2 + MUI2)'
                  : `Pendente: ${probe.missingForWindowsBinary[0] || 'MinGW/NSIS'}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Builds Split View */}
      {builds.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center bg-white dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
            Nenhuma compilação iniciada ainda
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Crie uma aplicação no assistente e clique em Iniciar Compilação para acompanhar o progresso aqui.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Build Queue List */}
          <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Fila e Histórico ({builds.length})
            </div>
            {builds.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                className={`w-full text-left px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer ${
                  activeBuild?.id === b.id ? 'bg-blue-50/50 dark:bg-blue-950/40' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {b.appName}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    {b.progress}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{STATUS_LABELS[b.status] || b.status}</span>
                  <span className="font-mono">v{b.versionName}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Active Build Details */}
          {activeBuild && (
            <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-6 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    {activeBuild.status === 'completed' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    ) : activeBuild.status === 'failed' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    ) : activeBuild.status === 'cancelled' ? (
                      <XCircle className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    ) : (
                      <Clock className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                    )}
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
                      {activeBuild.appName} · v{activeBuild.versionName}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {STATUS_LABELS[activeBuild.status] || activeBuild.status} — {activeBuild.currentStep}
                  </p>
                </div>

                {['queued', 'processing', 'compiling'].includes(activeBuild.status) && (
                  <button
                    type="button"
                    onClick={() => handleCancel(activeBuild.id)}
                    className="px-3 py-1.5 text-xs font-medium border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    Cancelar Build
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400">Progresso do Pipeline</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {activeBuild.progress}%
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      activeBuild.status === 'failed'
                        ? 'bg-amber-500'
                        : activeBuild.status === 'completed'
                        ? 'bg-emerald-600'
                        : 'bg-blue-700'
                    }`}
                    style={{ width: `${activeBuild.progress}%` }}
                  />
                </div>
              </div>

              {activeBuild.errorMessage && (
                <div className="border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 rounded-xl p-4 text-xs leading-relaxed space-y-2">
                  <p className="font-semibold">Diagnóstico do Motor de Compilação</p>
                  <p>{activeBuild.errorMessage}</p>
                  {activeBuild.missingInfrastructure?.length > 0 && (
                    <p className="font-mono text-[11px] text-amber-800 dark:text-amber-400">
                      Componentes em falta: {activeBuild.missingInfrastructure.join(' · ')}
                    </p>
                  )}
                </div>
              )}

              {/* Modern Artifacts & Installation Download Cards */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Instaladores e Artefactos Prontos
                  </h3>
                  {activeBuild.status === 'completed' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Pronto para instalação
                    </span>
                  )}
                </div>

                {activeBuild.artifacts.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    A aguardar conclusão dos passos de empacotamento...
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeBuild.artifacts.map((art, i) => {
                      const meta = getArtifactMeta(art.format);
                      const FormatIcon = meta.icon;
                      return (
                        <div
                          key={i}
                          className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-950/50 flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-blue-700 dark:text-blue-400 shrink-0">
                                  <FormatIcon className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {art.label}
                                  </p>
                                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                    {meta.platform}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                              {meta.installTip}
                            </p>

                            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                              {art.fileName}
                            </p>

                            {art.status === 'ready' ? (
                              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                {(art.sizeBytes / 1024).toFixed(1)} KB · SHA-256: {art.sha256?.slice(0, 12)}...
                              </p>
                            ) : (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                {art.status === 'failed' ? 'Erro:' : 'Requer:'}{' '}
                                {art.missingRequirements?.join(', ') || 'Falha na compilação'}
                              </p>
                            )}
                          </div>

                          {art.status === 'ready' && art.downloadUrl ? (
                            <button
                              type="button"
                              disabled={downloadingFile === art.fileName}
                              onClick={() => handleDownload(art, activeBuild)}
                              className="w-full py-2.5 px-3 bg-slate-900 dark:bg-blue-700 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 dark:hover:bg-blue-600 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>
                                {downloadingFile === art.fileName
                                  ? 'A descarregar...'
                                  : 'Descarregar Instalador'}
                              </span>
                            </button>
                          ) : (
                            <div className="text-xs font-medium text-amber-700 dark:text-amber-400 py-1.5">
                              {art.status === 'failed'
                                ? 'Falha ao gerar este artefacto'
                                : 'Ferramenta de compilação pendente neste servidor'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Real-Time Logs */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Terminal className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Registo de Compilação
                  </h3>
                </div>
                <div className="bg-slate-950 text-slate-200 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1 max-h-56 overflow-y-auto">
                  {activeBuild.logs.map((line, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
