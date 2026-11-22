import React, { useMemo } from 'react';
import {
  ArrowUpRight,
  Download,
  FolderKanban,
  HardDrive,
  Monitor,
  Plus,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AppProject } from '../types/appforge';
import { AppIconImage } from './AppIconImage';

interface DashboardViewProps {
  onNewApp: () => void;
  onEditProject: (project: AppProject) => void;
  onOpenBuild: (buildId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNewApp,
  onEditProject,
  onOpenBuild,
}) => {
  const { profile, projects, builds, downloads } = useAuth();

  const metrics = useMemo(() => {
    let apkCount = 0;
    let exeCount = 0;
    let aabCount = 0;
    let totalArtifactBytes = 0;

    for (const b of builds) {
      for (const art of b.artifacts || []) {
        if (art.status === 'ready') {
          totalArtifactBytes += art.sizeBytes || 0;
          if (art.format === 'APK_DEBUG' || art.format === 'APK_RELEASE') apkCount++;
          if (art.format === 'WINDOWS_EXE' || art.format === 'WINDOWS_PORTABLE') exeCount++;
          if (art.format === 'AAB') aabCount++;
        }
      }
    }

    const activeBuilds = builds.filter((b) =>
      ['queued', 'processing', 'compiling'].includes(b.status)
    );

    const usedMb = Math.max(
      totalArtifactBytes / (1024 * 1024),
      (profile?.storageUsedBytes || 0) / (1024 * 1024)
    );

    return {
      totalApps: projects.length,
      apkCount,
      exeCount,
      aabCount,
      activeBuilds,
      usedMb,
    };
  }, [projects, builds, profile]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Painel Geral</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Resumo das suas aplicações Android e Windows, compilações e ficheiros gerados.
          </p>
        </div>

        <button
          type="button"
          onClick={onNewApp}
          className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Criar Aplicação</span>
        </button>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-medium">Total de Aplicações</span>
            <FolderKanban className="w-4 h-4" />
          </div>
          <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {metrics.totalApps}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Criação sem limites</p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-medium">APKs Gerados</span>
            <Smartphone className="w-4 h-4" />
          </div>
          <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {metrics.apkCount}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Debug &amp; Release Android</p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-medium">EXEs Gerados</span>
            <Monitor className="w-4 h-4" />
          </div>
          <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {metrics.exeCount}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Instalador e Portátil Windows</p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-3">
            <span className="text-xs font-medium">AABs Gerados</span>
            <ArrowUpRight className="w-4 h-4" />
          </div>
          <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {metrics.aabCount}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Android App Bundle (Play Store)</p>
        </div>
      </div>

      {/* Account & Build Capacity Strip (Unrestricted) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900 lg:col-span-2 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Artefactos Armazenados
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
              {metrics.usedMb.toFixed(2)} MB gerados (Sem limite)
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span>
              Estado da conta:{' '}
              <strong className="text-slate-900 dark:text-white">
                {profile?.accountStatus === 'suspended' ? 'Suspensa' : 'Activa'}
              </strong>
            </span>
            <span>
              Compilações registadas:{' '}
              <strong className="font-mono text-slate-900 dark:text-white">{builds.length}</strong>
            </span>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-slate-50 dark:bg-slate-900/70 flex flex-col justify-between gap-2">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <ShieldCheck className="w-4 h-4" />
            <p className="text-xs font-semibold">Acesso Integral Activo</p>
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            Todos os formatos desbloqueados
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Android APK Debug/Release, Google Play AAB, Windows Setup EXE, Portátil EXE e modo offline sem restrições.
          </p>
        </div>
      </div>

      {/* Active Builds */}
      {metrics.activeBuilds.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Compilações em Andamento ({metrics.activeBuilds.length})
          </h2>
          <div className="space-y-3">
            {metrics.activeBuilds.map((b) => (
              <div
                key={b.id}
                onClick={() => onOpenBuild(b.id)}
                className="border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
              >
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {b.appName} — {b.currentStep}
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">{b.progress}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-700 dark:bg-blue-500" style={{ width: `${b.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest Projects & Download History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Últimos Projectos</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {projects.length} total
            </span>
          </div>
          {projects.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                Ainda não converteu nenhum website ou projecto.
              </p>
              <button
                type="button"
                onClick={onNewApp}
                className="px-4 py-2 bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                Criar Primeira Aplicação
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {projects.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  onClick={() => onEditProject(p)}
                  className="px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AppIconImage
                      src={p.visual.iconUrl}
                      appName={p.appName}
                      primaryColor={p.visual.primaryColor}
                      alt={p.appName}
                      className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {p.appName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                        {p.packageName} · v{p.versionName}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-blue-700 dark:text-blue-400 font-medium shrink-0">Abrir</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Histórico de Downloads</h2>
            <Download className="w-4 h-4 text-slate-400" />
          </div>
          {downloads.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Os artefactos descarregados aparecerão registados aqui.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {downloads.slice(0, 6).map((dl) => (
                <div key={dl.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{dl.fileName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {dl.appName} · {dl.format}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums shrink-0">
                    {(dl.sizeBytes / 1024).toFixed(1)} KB
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
