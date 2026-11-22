import React, { useMemo, useState } from 'react';
import {
  Copy,
  Edit3,
  Eye,
  History,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { generateUuid } from '../data/defaults';
import { apiStartBuild } from '../services/apiClient';
import {
  createBuildJobDoc,
  removeProject,
  saveProject,
  writeAuditLog,
} from '../services/firestoreService';
import { AppProject } from '../types/appforge';
import { AppIconImage } from './AppIconImage';

interface ProjectsViewProps {
  onCreateNew: () => void;
  onEdit: (project: AppProject) => void;
  onViewBuild: (buildId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  onCreateNew,
  onEdit,
  onViewBuild,
}) => {
  const { user, projects, builds, engineSettings } = useAuth();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'url' | 'files' | 'web_project'>('all');
  const [inspectProject, setInspectProject] = useState<AppProject | null>(null);
  const [historyProject, setHistoryProject] = useState<AppProject | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filterType !== 'all' && p.conversionType !== filterType) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        p.appName.toLowerCase().includes(q) ||
        p.packageName.toLowerCase().includes(q) ||
        (p.sourceUrl || '').toLowerCase().includes(q)
      );
    });
  }, [projects, search, filterType]);

  const handleDuplicate = async (proj: AppProject) => {
    if (!user) return;
    setBusyId(proj.id);
    setError(null);
    try {
      const clone: AppProject = {
        ...proj,
        id: `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        appName: `${proj.appName} (Cópia)`,
        appIdentifier: generateUuid(),
        ownerId: user.uid,
        ownerEmail: user.email || '',
      };
      await saveProject(clone, true);
      await writeAuditLog({
        actorUid: user.uid,
        actorEmail: user.email || '',
        action: 'PROJECT_DUPLICATED',
        targetType: 'project',
        targetId: clone.id,
        details: `Duplicado de ${proj.appName}`,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    setBusyId(id);
    try {
      await removeProject(id);
      await writeAuditLog({
        actorUid: user.uid,
        actorEmail: user.email || '',
        action: 'PROJECT_DELETED',
        targetType: 'project',
        targetId: id,
        details: 'Projecto eliminado pelo utilizador',
      });
      setConfirmDeleteId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRecompile = async (proj: AppProject) => {
    if (!user) return;
    setBusyId(proj.id);
    setError(null);
    try {
      const formats: string[] = [];
      if (proj.platforms.androidApkDebug) formats.push('APK_DEBUG');
      if (proj.platforms.androidApkRelease) formats.push('APK_RELEASE');
      if (proj.platforms.androidAab) formats.push('AAB');
      if (proj.platforms.windowsExe) formats.push('WINDOWS_EXE');
      if (proj.platforms.windowsPortable) formats.push('WINDOWS_PORTABLE');
      if (proj.platforms.exportSourceCode || formats.length === 0) formats.push('SOURCE_CODE');

      const runtime = await apiStartBuild(proj, {
        androidWorkerUrl: engineSettings.androidWorkerUrl,
        windowsWorkerUrl: engineSettings.windowsWorkerUrl,
      });

      await createBuildJobDoc({
        id: runtime.buildId,
        projectId: proj.id,
        ownerId: user.uid,
        appName: proj.appName,
        versionName: proj.versionName,
        targetFormats: formats,
      });

      onViewBuild(runtime.buildId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Os Meus Projectos</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Edite, duplique, consulte configurações, acompanhe o histórico e recompile novas versões.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Projecto</span>
        </button>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome, pacote ou URL..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-transparent dark:border-slate-800">
          {(
            [
              ['all', 'Todos'],
              ['url', 'URL'],
              ['files', 'Ficheiros'],
              ['web_project', 'Projecto Web'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilterType(val)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                filterType === val
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhum projecto encontrado para este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Aplicação</th>
                  <th className="py-3 px-4 font-medium">Origem</th>
                  <th className="py-3 px-4 font-medium">Versão</th>
                  <th className="py-3 px-4 font-medium">Plataformas</th>
                  <th className="py-3 px-4 font-medium text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((p) => {
                  const targets: string[] = [];
                  if (p.platforms.androidApkDebug) targets.push('APK Debug');
                  if (p.platforms.androidApkRelease) targets.push('APK Release');
                  if (p.platforms.androidAab) targets.push('AAB');
                  if (p.platforms.windowsExe) targets.push('EXE');
                  if (p.platforms.windowsPortable) targets.push('Portátil');

                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <AppIconImage
                            src={p.visual.iconUrl}
                            appName={p.appName}
                            primaryColor={p.visual.primaryColor}
                            alt={p.appName}
                            className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                          />
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{p.appName}</p>
                            <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{p.packageName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate font-mono">
                        {p.conversionType === 'url' ? p.sourceUrl : `Bundle (${p.framework})`}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                        v{p.versionName} ({p.versionCode})
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                        {targets.join(' · ') || 'Código-fonte'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRecompile(p)}
                            disabled={busyId === p.id}
                            title="Recompilar"
                            className="p-2 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-lg cursor-pointer"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(p)}
                            title="Editar"
                            className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectProject(p)}
                            title="Consultar Configurações"
                            className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistoryProject(p)}
                            title="Histórico de Compilações"
                            className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(p)}
                            disabled={busyId === p.id}
                            title="Duplicar"
                            className="p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          {confirmDeleteId === p.id ? (
                            <button
                              type="button"
                              onClick={() => handleDelete(p.id)}
                              className="px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded-md cursor-pointer"
                            >
                              Confirmar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(p.id)}
                              title="Eliminar"
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/60 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspect Settings Modal */}
      {inspectProject && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Configurações: {inspectProject.appName}
              </h3>
              <button
                type="button"
                onClick={() => setInspectProject(null)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto text-xs font-mono bg-slate-50 dark:bg-slate-950">
              <pre className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">
                {JSON.stringify(inspectProject, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Build History Modal */}
      {historyProject && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Histórico de Compilações: {historyProject.appName}
              </h3>
              <button
                type="button"
                onClick={() => setHistoryProject(null)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {builds.filter((b) => b.projectId === historyProject.id).length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
                  Sem compilações registadas para este projecto.
                </p>
              ) : (
                builds
                  .filter((b) => b.projectId === historyProject.id)
                  .map((b) => (
                    <div
                      key={b.id}
                      onClick={() => {
                        setHistoryProject(null);
                        onViewBuild(b.id);
                      }}
                      className="py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 px-2 rounded cursor-pointer"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          v{b.versionName} · {b.currentStep}
                        </p>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{b.id}</p>
                      </div>
                      <span className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">
                        {b.progress}%
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
