import React, { useEffect, useState } from 'react';
import {
  Activity,
  RefreshCw,
  Server,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiProbeInfrastructure } from '../services/apiClient';
import {
  adminFetchAllUsers,
  adminFetchAuditLogs,
  adminLoadSecrets,
  adminSaveEngineSettings,
  adminSaveSecrets,
  adminUpdateUser,
  writeAuditLog,
} from '../services/firestoreService';
import {
  AdminEngineSecrets,
  AuditLog,
  EngineSettings,
  InfrastructureProbe,
  UserProfile,
} from '../types/appforge';

type AdminTab = 'overview' | 'users' | 'engines' | 'logs';

export const AdminPanelView: React.FC = () => {
  const { user, projects, builds, engineSettings } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [engineForm, setEngineForm] = useState<EngineSettings>(engineSettings);
  const [secretsForm, setSecretsForm] = useState<AdminEngineSecrets>({
    remoteWorkerAuthToken: '',
    githubActionsRepo: '',
    githubActionsToken: '',
    fcmServerProjectId: '',
    updatedAt: null,
  });
  const [probe, setProbe] = useState<InfrastructureProbe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEngineForm(engineSettings);
  }, [engineSettings]);

  const refreshAdminData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, logs, sec, infra] = await Promise.all([
        adminFetchAllUsers(),
        adminFetchAuditLogs(),
        adminLoadSecrets().catch(() => null),
        apiProbeInfrastructure({
          androidWorkerUrl: engineSettings.androidWorkerUrl,
          windowsWorkerUrl: engineSettings.windowsWorkerUrl,
        }).catch(() => null),
      ]);
      setAllUsers(u);
      setAuditLogs(logs);
      if (sec) setSecretsForm(sec);
      if (infra) setProbe(infra);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAdminData();
  }, []);

  const handleToggleUserStatus = async (target: UserProfile) => {
    const nextStatus = target.accountStatus === 'active' ? 'suspended' : 'active';
    try {
      await adminUpdateUser(target.uid, { accountStatus: nextStatus });
      setAllUsers((prev) =>
        prev.map((u) => (u.uid === target.uid ? { ...u, accountStatus: nextStatus } : u))
      );
      if (user) {
        await writeAuditLog({
          actorUid: user.uid,
          actorEmail: user.email || '',
          action: 'ADMIN_USER_STATUS',
          targetType: 'user',
          targetId: target.uid,
          details: `${target.email} -> ${nextStatus}`,
        });
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveEngines = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updatedSettings: EngineSettings = {
        ...engineForm,
        androidWorkerConfigured: Boolean(engineForm.androidWorkerUrl?.trim()),
        windowsWorkerConfigured: Boolean(engineForm.windowsWorkerUrl?.trim()),
      };
      await adminSaveEngineSettings(updatedSettings);
      await adminSaveSecrets(secretsForm);
      const infra = await apiProbeInfrastructure({
        androidWorkerUrl: updatedSettings.androidWorkerUrl,
        windowsWorkerUrl: updatedSettings.windowsWorkerUrl,
      });
      setProbe(infra);
      if (user) {
        await writeAuditLog({
          actorUid: user.uid,
          actorEmail: user.email || '',
          action: 'ADMIN_ENGINES_UPDATED',
          targetType: 'settings',
          targetId: 'engines',
          details: `Concorrência: ${updatedSettings.maxConcurrentBuilds}, Upload: ${updatedSettings.maxUploadSizeMb}MB`,
        });
      }
      setNotice('Configuração dos motores Android e Windows guardada e testada.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const completedBuilds = builds.filter((b) => b.status === 'completed');
  const failedBuilds = builds.filter((b) => b.status === 'failed');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Painel Administrativo</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Controlo de utilizadores, motores de compilação Android/Windows e auditoria.
          </p>
        </div>

        <button
          type="button"
          onClick={refreshAdminData}
          disabled={loading}
          className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Actualizar Dados</span>
        </button>
      </div>

      {notice && (
        <div className="border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-xl px-4 py-3 text-sm">
          {notice}
        </div>
      )}
      {error && (
        <div className="border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-xl w-fit">
        {(
          [
            ['overview', 'Estatísticas', Activity],
            ['users', 'Utilizadores', Users],
            ['engines', 'Motores e Servidores', Server],
            ['logs', 'Erros e Auditoria', ShieldAlert],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              tab === id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
            <span className="text-xs text-slate-500 dark:text-slate-400">Utilizadores Registados</span>
            <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
              {allUsers.length}
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
            <span className="text-xs text-slate-500 dark:text-slate-400">Projectos na Plataforma</span>
            <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
              {projects.length}
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
            <span className="text-xs text-slate-500 dark:text-slate-400">Compilações Concluídas</span>
            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums mt-2">
              {completedBuilds.length}
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 bg-white dark:bg-slate-900">
            <span className="text-xs text-slate-500 dark:text-slate-400">Total de Builds</span>
            <p className="text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
              {builds.length}
            </p>
            {failedBuilds.length > 0 && (
              <span className="text-xs text-amber-700 dark:text-amber-400 mt-1 block">
                {failedBuilds.length} com falha
              </span>
            )}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Utilizador</th>
                  <th className="py-3 px-4 font-medium">Função</th>
                  <th className="py-3 px-4 font-medium">Estado</th>
                  <th className="py-3 px-4 font-medium text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allUsers.map((u) => (
                  <tr key={u.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <p className="font-medium text-slate-900 dark:text-white">{u.displayName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono uppercase text-slate-700 dark:text-slate-300">{u.role}</td>
                    <td className="py-3 px-4 text-xs">
                      <span
                        className={
                          u.accountStatus === 'active'
                            ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                            : 'text-red-700 dark:text-red-400 font-medium'
                        }
                      >
                        {u.accountStatus === 'active' ? 'Activa' : 'Suspensa'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleUserStatus(u)}
                        className="px-3 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        {u.accountStatus === 'active' ? 'Suspender' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Engines & Infrastructure Tab */}
      {tab === 'engines' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSaveEngines}
            className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-white dark:bg-slate-900 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Configuração dos Motores Android e Windows
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Android SDK</label>
                <input
                  type="text"
                  value={engineForm.androidSdkVersion}
                  onChange={(e) =>
                    setEngineForm((p) => ({ ...p, androidSdkVersion: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Build Tools</label>
                <input
                  type="text"
                  value={engineForm.gradleVersion}
                  onChange={(e) =>
                    setEngineForm((p) => ({ ...p, gradleVersion: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Windows Engine</label>
                <input
                  type="text"
                  value={engineForm.electronVersion}
                  onChange={(e) =>
                    setEngineForm((p) => ({ ...p, electronVersion: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Endpoint Worker Remoto Android (Opcional)
                </label>
                <input
                  type="url"
                  placeholder="https://android-worker.seudominio.com"
                  value={engineForm.androidWorkerUrl || ''}
                  onChange={(e) =>
                    setEngineForm((p) => ({ ...p, androidWorkerUrl: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Endpoint Worker Remoto Windows (Opcional)
                </label>
                <input
                  type="url"
                  placeholder="https://windows-worker.seudominio.com"
                  value={engineForm.windowsWorkerUrl || ''}
                  onChange={(e) =>
                    setEngineForm((p) => ({ ...p, windowsWorkerUrl: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Token Bearer dos Workers Remotos (Admin Only)
                </label>
                <input
                  type="password"
                  value={secretsForm.remoteWorkerAuthToken || ''}
                  onChange={(e) =>
                    setSecretsForm((p) => ({ ...p, remoteWorkerAuthToken: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Repositório GitHub Actions Runner (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="org/appforge-runners"
                  value={secretsForm.githubActionsRepo || ''}
                  onChange={(e) =>
                    setSecretsForm((p) => ({ ...p, githubActionsRepo: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Compilações Simultâneas
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={engineForm.maxConcurrentBuilds}
                  onChange={(e) =>
                    setEngineForm((p) => ({
                      ...p,
                      maxConcurrentBuilds: Number(e.target.value) || 2,
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tamanho Máx. Upload (MB)
                </label>
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={engineForm.maxUploadSizeMb}
                  onChange={(e) =>
                    setEngineForm((p) => ({
                      ...p,
                      maxUploadSizeMb: Number(e.target.value) || 50,
                    }))
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Guardar e Testar Conectividade
            </button>
          </form>

          {/* Host Telemetry Probe */}
          <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-slate-50 dark:bg-slate-900 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Monitorização Real de Ferramentas no Servidor
            </h3>
            {probe ? (
              <div className="space-y-2.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Sistema Host</span>
                  <span className="text-slate-900 dark:text-slate-200">{probe.hostOs}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">JDK 17 (java/javac)</span>
                  <span className={probe.localTools.java.available ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                    {probe.localTools.java.available ? 'Instalado' : 'Ausente'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Android SDK + Build-Tools 34</span>
                  <span className={probe.localTools.androidSdk.available ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                    {probe.localTools.androidSdk.available ? 'Pronto (APK/AAB)' : 'Ausente'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">MinGW-w64 + Edge WebView2</span>
                  <span className={probe.localTools.wine.available ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                    {probe.localTools.wine.available ? 'Pronto (.EXE x64)' : 'Ausente'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">NSIS (makensis)</span>
                  <span className={probe.localTools.makensis.available ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                    {probe.localTools.makensis.available ? 'Instalado (MUI2 Setup)' : 'Ausente'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Worker Remoto Android</span>
                  <span className={probe.remoteWorkers.androidWorkerReachable ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                    {probe.remoteWorkers.androidWorkerReachable ? 'Online' : 'Opcional (Local Activo)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Worker Remoto Windows</span>
                  <span className={probe.remoteWorkers.windowsWorkerReachable ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                    {probe.remoteWorkers.windowsWorkerReachable ? 'Online' : 'Opcional (Local Activo)'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">A sondar ambiente...</p>
            )}
          </div>
        </div>
      )}

      {/* Audit & Errors Tab */}
      {tab === 'logs' && (
        <div className="space-y-6">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Registo de Auditoria e Segurança ({auditLogs.length})
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Sem eventos registados.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                {auditLogs.map((l) => (
                  <div key={l.id} className="px-5 py-3 text-xs flex flex-wrap justify-between gap-2">
                    <div>
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">{l.action}</span>
                      <span className="text-slate-500 dark:text-slate-400 ml-2">{l.details}</span>
                    </div>
                    <span className="font-mono text-slate-500 dark:text-slate-400">{l.actorEmail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
