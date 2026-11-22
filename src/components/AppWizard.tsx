import React, { useEffect, useState } from 'react';
import {
  Check,
  Code2,
  FolderArchive,
  Globe,
  HardDriveDownload,
  Monitor,
  Palette,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createBlankProject,
  DEFAULT_APP_ICON_URL,
  DEFAULT_SPLASH_URL,
  generateUuid,
} from '../data/defaults';
import {
  apiAnalyzeUrl,
  apiCaptureOffline,
  apiListKeystores,
  apiStartBuild,
  apiUploadProjectFiles,
} from '../services/apiClient';
import {
  createBuildJobDoc,
  saveProject,
  writeAuditLog,
} from '../services/firestoreService';
import {
  AppProject,
  ConversionType,
  KeystoreMetadata,
  UploadedBundleSummary,
  WebFramework,
} from '../types/appforge';
import { AppIconImage, normalizeVisualAssetUrl } from './AppIconImage';
import { LiveSimulator } from './LiveSimulator';

interface AppWizardProps {
  initialProject?: AppProject | null;
  onBuildStarted: (buildId: string) => void;
  onSavedProject: () => void;
}

type WizardStep = 1 | 2 | 3 | 4;

const CATEGORIES = [
  'Produtividade',
  'Comércio Electrónico',
  'Educação',
  'Finanças',
  'Saúde',
  'Comunicação',
  'Entretenimento',
  'Empresarial',
];

const OFFLINE_MODES = [
  {
    id: 'offline_app' as const,
    title: '100% Offline Incorporado',
    desc: 'Captura HTML, CSS, JS, imagens e fontes para dentro do APK/EXE. Funciona sem Internet.',
  },
  {
    id: 'cache_first' as const,
    title: 'Online + Reserva Offline',
    desc: 'Usa o site ao vivo quando há rede e alterna para o pacote local incorporado se ficar offline.',
  },
  {
    id: 'fallback_page' as const,
    title: 'Ecrã Offline Personalizado',
    desc: 'Exibe aviso nativo elegante com botão de tentar novamente quando não houver ligação.',
  },
  {
    id: 'disabled' as const,
    title: 'Apenas Online',
    desc: 'Carregamento directo padrão sempre que o dispositivo tiver ligação à Internet.',
  },
];

export const AppWizard: React.FC<AppWizardProps> = ({
  initialProject,
  onBuildStarted,
  onSavedProject,
}) => {
  const { user, profile, engineSettings } = useAuth();
  const [project, setProject] = useState<AppProject>(() =>
    initialProject
      ? { ...initialProject }
      : createBlankProject(user?.uid || '', user?.email || '')
  );
  const isEditingExisting = Boolean(initialProject);

  const [step, setStep] = useState<WizardStep>(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [capturingOffline, setCapturingOffline] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [supportsIframe, setSupportsIframe] = useState(true);
  const [bundleSummary, setBundleSummary] = useState<UploadedBundleSummary | null>(null);
  const [keystores, setKeystores] = useState<KeystoreMetadata[]>([]);
  const [domainInput, setDomainInput] = useState('');

  useEffect(() => {
    if (initialProject) {
      setProject({ ...initialProject });
    }
  }, [initialProject]);

  useEffect(() => {
    apiListKeystores().then(setKeystores).catch(() => {});
  }, []);

  const updateField = <K extends keyof AppProject>(key: K, value: AppProject[K]) => {
    setProject((prev) => ({ ...prev, [key]: value }));
  };

  const handleAnalyzeUrl = async () => {
    if (!project.sourceUrl?.trim()) {
      setError('Introduza o endereço URL do website.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiAnalyzeUrl(project.sourceUrl);
      setSupportsIframe(res.supportsIframePreview);
      setProject((prev) => ({
        ...prev,
        sourceUrl: res.url,
        appName: res.appName,
        packageName: res.packageName,
        description: res.description,
        framework: res.detectedFramework,
        visual: {
          ...prev.visual,
          iconUrl: res.iconUrl || prev.visual.iconUrl,
          splashUrl: res.splashUrl || prev.visual.splashUrl,
          primaryColor: res.primaryColor,
          secondaryColor: res.secondaryColor,
          navBarTitle: res.appName,
        },
        advanced: {
          ...prev.advanced,
          authorizedDomains: [new URL(res.url).hostname],
        },
      }));
      setNotice(
        `Website analisado: "${res.appName}" · Tecnologia detectada: ${res.detectedFramework.toUpperCase()}`
      );
    } catch (err: any) {
      setError(err.message || 'Falha ao analisar website.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCaptureOffline = async () => {
    if (!project.sourceUrl?.trim()) {
      setError('Introduza o endereço URL do website antes de capturar o pacote offline.');
      return;
    }
    setCapturingOffline(true);
    setError(null);
    setNotice(null);
    try {
      const summary = await apiCaptureOffline(project.sourceUrl);
      setBundleSummary(summary);
      setProject((prev) => ({
        ...prev,
        sourceBundleId: summary.bundleId,
        advanced: {
          ...prev.advanced,
          offlineMode:
            prev.advanced.offlineMode === 'cache_first' ? 'cache_first' : 'offline_app',
        },
      }));
      setNotice(
        `Pacote offline capturado com sucesso: ${summary.fileCount} ficheiro(s) (${(
          summary.totalBytes / 1024
        ).toFixed(1)} KB). Pronto para funcionar sem Internet.`
      );
    } catch (err: any) {
      setError(err.message || 'Falha ao capturar website para modo offline.');
    } finally {
      setCapturingOffline(false);
    }
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || !fileList.length) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const summary = await apiUploadProjectFiles(Array.from(fileList));
      setBundleSummary(summary);
      setProject((prev) => ({
        ...prev,
        sourceBundleId: summary.bundleId,
        framework:
          prev.conversionType === 'files'
            ? summary.detectedFramework
            : prev.framework === 'auto'
            ? summary.detectedFramework
            : prev.framework,
        advanced: {
          ...prev.advanced,
          offlineMode: 'offline_app',
        },
      }));
      setNotice(
        `${summary.fileCount} ficheiro(s) processado(s) (${(summary.totalBytes / 1024).toFixed(
          1
        )} KB). Pronto para execução offline.`
      );
    } catch (err: any) {
      setError(err.message || 'Erro no carregamento.');
    } finally {
      setUploading(false);
    }
  };

  const handleLocalImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'iconUrl' | 'splashUrl' | 'loadingImageUrl'
  ) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('A imagem visual deve ter no máximo 5 MB.');
      inputEl.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = typeof reader.result === 'string' ? reader.result : '';
      inputEl.value = '';
      if (!rawDataUrl) return;

      // Compress & normalize icons/splashes so Firestore (<1MB) and Android/Windows compilers always receive crisp assets
      const img = new Image();
      img.onload = () => {
        try {
          const isIcon = target === 'iconUrl';
          const targetW = img.naturalWidth > 0 ? img.naturalWidth : 512;
          const targetH = img.naturalHeight > 0 ? img.naturalHeight : 512;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (isIcon && ctx) {
            for (const dim of [512, 384, 256]) {
              canvas.width = dim;
              canvas.height = dim;
              ctx.clearRect(0, 0, dim, dim);
              const scale = Math.min(dim / targetW, dim / targetH);
              const dw = Math.max(1, Math.round(targetW * scale));
              const dh = Math.max(1, Math.round(targetH * scale));
              const dx = Math.round((dim - dw) / 2);
              const dy = Math.round((dim - dh) / 2);
              ctx.drawImage(img, dx, dy, dw, dh);
              const pngData = canvas.toDataURL('image/png');
              if (pngData.length <= 240_000 || dim === 256) {
                const finalIcon =
                  pngData.length <= 260_000 ? pngData : canvas.toDataURL('image/webp', 0.9);
                setProject((prev) => ({
                  ...prev,
                  visual: { ...prev.visual, [target]: finalIcon },
                }));
                setError(null);
                return;
              }
            }
          } else if (ctx) {
            for (const [maxDim, quality] of [
              [960, 0.84],
              [960, 0.72],
              [720, 0.68],
            ] as const) {
              const scale = Math.min(1, maxDim / Math.max(targetW, targetH));
              canvas.width = Math.max(1, Math.round(targetW * scale));
              canvas.height = Math.max(1, Math.round(targetH * scale));
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const jpgData = canvas.toDataURL('image/jpeg', quality);
              if (jpgData.length <= 260_000 || maxDim === 720) {
                setProject((prev) => ({
                  ...prev,
                  visual: { ...prev.visual, [target]: jpgData },
                }));
                setError(null);
                return;
              }
            }
          }
        } catch {
          // Fall through to raw Data URL
        }
        if (rawDataUrl.length > 420_000) {
          setError('Imagem demasiado pesada para guardar. Utilize PNG, JPG ou SVG até 400 KB.');
          return;
        }
        setProject((prev) => ({
          ...prev,
          visual: { ...prev.visual, [target]: rawDataUrl },
        }));
      };
      img.onerror = () => {
        if (rawDataUrl.length > 420_000) {
          setError('Ficheiro visual demasiado grande. Converta para PNG ou JPG compacto.');
          return;
        }
        setProject((prev) => ({
          ...prev,
          visual: { ...prev.visual, [target]: rawDataUrl },
        }));
        setError(null);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const validateProjectBeforeAction = (): string | null => {
    if (!project.appName.trim()) return 'Informe o nome da aplicação.';
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(project.packageName.trim())) {
      return 'O pacote Android deve seguir o formato com.empresa.app (apenas minúsculas e números).';
    }
    if (project.conversionType === 'url' && !project.sourceUrl.trim()) {
      return 'Informe o URL de origem do website.';
    }
    if (project.conversionType === 'files' && !project.sourceBundleId) {
      return 'Carregue os ficheiros HTML/CSS/JS ou o arquivo ZIP do projecto.';
    }
    const anyTarget = Object.values(project.platforms).some(Boolean);
    if (!anyTarget) {
      return 'Seleccione pelo menos um formato de saída na Etapa 2.';
    }
    return null;
  };

  const handleSaveDraft = async () => {
    const validationErr = validateProjectBeforeAction();
    if (validationErr) {
      setError(validationErr);
      return;
    }
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const toSave: AppProject = {
        ...project,
        ownerId: user.uid,
        ownerEmail: user.email || '',
      };
      await saveProject(toSave, !isEditingExisting);
      await writeAuditLog({
        actorUid: user.uid,
        actorEmail: user.email || '',
        action: isEditingExisting ? 'PROJECT_UPDATED' : 'PROJECT_CREATED',
        targetType: 'project',
        targetId: toSave.id,
        details: `${toSave.appName} (${toSave.packageName})`,
      });
      setNotice('Projecto guardado com sucesso.');
      onSavedProject();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLaunchBuild = async () => {
    const validationErr = validateProjectBeforeAction();
    if (validationErr) {
      setError(validationErr);
      return;
    }
    if (!user) return;
    if (profile?.accountStatus === 'suspended') {
      setError('A sua conta encontra-se suspensa. Contacte o administrador.');
      return;
    }

    setBuilding(true);
    setError(null);
    try {
      const toSave: AppProject = {
        ...project,
        ownerId: user.uid,
        ownerEmail: user.email || '',
      };
      await saveProject(toSave, !isEditingExisting);

      const targetFormats: string[] = [];
      if (toSave.platforms.androidApkDebug) targetFormats.push('APK_DEBUG');
      if (toSave.platforms.androidApkRelease) targetFormats.push('APK_RELEASE');
      if (toSave.platforms.androidAab) targetFormats.push('AAB');
      if (toSave.platforms.windowsExe) targetFormats.push('WINDOWS_EXE');
      if (toSave.platforms.windowsPortable) targetFormats.push('WINDOWS_PORTABLE');
      if (toSave.platforms.exportSourceCode) targetFormats.push('SOURCE_CODE');

      const runtime = await apiStartBuild(toSave, {
        androidWorkerUrl: engineSettings.androidWorkerUrl,
        windowsWorkerUrl: engineSettings.windowsWorkerUrl,
      });

      await createBuildJobDoc({
        id: runtime.buildId,
        projectId: toSave.id,
        ownerId: user.uid,
        appName: toSave.appName,
        versionName: toSave.versionName,
        targetFormats,
      });

      await writeAuditLog({
        actorUid: user.uid,
        actorEmail: user.email || '',
        action: 'BUILD_STARTED',
        targetType: 'build',
        targetId: runtime.buildId,
        details: `${toSave.appName} -> ${targetFormats.join(', ')}`,
      });

      onBuildStarted(runtime.buildId);
    } catch (err: any) {
      setError(err.message || 'Falha ao iniciar compilação.');
    } finally {
      setBuilding(false);
    }
  };

  const addAuthorizedDomain = () => {
    const clean = domainInput.trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!clean) return;
    if (!project.advanced.authorizedDomains.includes(clean)) {
      setProject((prev) => ({
        ...prev,
        advanced: {
          ...prev.advanced,
          authorizedDomains: [...prev.advanced.authorizedDomains, clean].slice(0, 20),
        },
      }));
    }
    setDomainInput('');
  };

  const isUrlDrivenSource =
    project.conversionType === 'url' ||
    (project.conversionType === 'web_project' &&
      (project.framework === 'laravel' || project.framework === 'php'));

  const inputClass =
    'w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600';

  const selectClass =
    'w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {isEditingExisting ? `Editar: ${project.appName}` : 'Criar Nova Aplicação'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Configure a origem, modo offline, plataformas Android/Windows e identidade visual instalada.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving || building}
            className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'A guardar...' : 'Guardar Projecto'}</span>
          </button>
          <button
            type="button"
            onClick={handleLaunchBuild}
            disabled={building || saving}
            className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Play className="w-4 h-4" />
            <span>{building ? 'A iniciar...' : 'Iniciar Compilação'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 rounded-xl px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      {/* Source Conversion Mode Selector */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              {
                id: 'url' as ConversionType,
                title: 'A. Website por URL',
                desc: 'HTTP/HTTPS com análise automática e captura offline',
                icon: Globe,
              },
              {
                id: 'files' as ConversionType,
                title: 'B. Ficheiros HTML / ZIP',
                desc: 'Aplicação estática 100% offline',
                icon: FolderArchive,
              },
              {
                id: 'web_project' as ConversionType,
                title: 'C. Projecto Web / Framework',
                desc: 'React, Vue, Angular, Laravel ou PHP',
                icon: Code2,
              },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = project.conversionType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => updateField('conversionType', item.id)}
                className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 dark:border-blue-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-1">
                  <Icon
                    className={`w-4 h-4 ${
                      active ? 'text-blue-700 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {item.title}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{item.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Dynamic Source Input */}
        {project.conversionType === 'url' && (
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <input
              type="url"
              value={project.sourceUrl}
              onChange={(e) => updateField('sourceUrl', e.target.value)}
              placeholder="https://oseuwebsite.com"
              className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={handleAnalyzeUrl}
              disabled={analyzing}
              className="px-4 py-2.5 bg-slate-900 dark:bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-slate-700 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Search className="w-4 h-4" />
              <span>{analyzing ? 'A analisar...' : 'Analisar Website'}</span>
            </button>
          </div>
        )}

        {project.conversionType === 'files' && (
          <div className="pt-2 space-y-3">
            <label className="block border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-5 text-center hover:border-blue-500 cursor-pointer bg-slate-50/50 dark:bg-slate-950/60">
              <Upload className="w-5 h-5 text-slate-500 dark:text-slate-400 mx-auto mb-2" />
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200 block">
                {uploading
                  ? 'A processar ficheiros...'
                  : 'Carregar ficheiros HTML, CSS, JS, imagens ou arquivo .ZIP'}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">
                Preserva recursos locais para funcionamento sem Internet
              </span>
              <input
                type="file"
                multiple
                accept=".html,.htm,.css,.js,.json,.png,.jpg,.jpeg,.svg,.woff,.woff2,.zip"
                onChange={handleUploadFiles}
                className="hidden"
              />
            </label>
            {bundleSummary && (
              <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                Bundle: {bundleSummary.bundleId} · {bundleSummary.fileCount} ficheiros · Entrada:{' '}
                {bundleSummary.entryPath}
              </p>
            )}
          </div>
        )}

        {project.conversionType === 'web_project' && (
          <div className="pt-2 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Framework / Stack
              </label>
              <select
                value={project.framework}
                onChange={(e) => updateField('framework', e.target.value as WebFramework)}
                className={selectClass}
              >
                <option value="react">React / Next.js</option>
                <option value="vue">Vue / Nuxt</option>
                <option value="angular">Angular</option>
                <option value="laravel">Laravel (URL)</option>
                <option value="php">PHP (URL)</option>
                <option value="static">Build Estático (dist/)</option>
              </select>
            </div>
            {project.framework === 'laravel' || project.framework === 'php' ? (
              <div className="md:col-span-9 flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={project.sourceUrl}
                  onChange={(e) => updateField('sourceUrl', e.target.value)}
                  placeholder="https://app-laravel.empresa.com"
                  className="flex-1 px-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleAnalyzeUrl}
                  disabled={analyzing}
                  className="px-4 py-2.5 bg-slate-900 dark:bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-slate-700 whitespace-nowrap cursor-pointer"
                >
                  {analyzing ? 'A verificar...' : 'Detectar Recursos'}
                </button>
              </div>
            ) : (
              <div className="md:col-span-9">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Carregar Build de Produção (ZIP da pasta dist/ ou build/)
                </label>
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleUploadFiles}
                  className="w-full text-sm text-slate-600 dark:text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-900 dark:file:text-slate-100 hover:file:bg-slate-200 dark:hover:file:bg-slate-700"
                />
              </div>
            )}
          </div>
        )}

        {/* Offline Capture Bar for URL-based Systems */}
        {isUrlDrivenSource && (
          <div className="mt-2 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <WifiOff className="w-4 h-4 text-blue-700 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Conversão para Funcionamento Offline
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Capture páginas, CSS, scripts, fontes e imagens para que a aplicação funcione sem Internet após a instalação.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Modo de funcionamento offline"
                value={project.advanced.offlineMode}
                onChange={(e) =>
                  setProject((prev) => ({
                    ...prev,
                    advanced: {
                      ...prev.advanced,
                      offlineMode: e.target.value as AppProject['advanced']['offlineMode'],
                    },
                  }))
                }
                className="px-3 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="offline_app">100% Offline Incorporado</option>
                <option value="cache_first">Online + Reserva Offline</option>
                <option value="fallback_page">Ecrã Offline Personalizado</option>
                <option value="disabled">Apenas Online</option>
              </select>

              <button
                type="button"
                onClick={handleCaptureOffline}
                disabled={capturingOffline || !project.sourceUrl.trim()}
                className="px-3.5 py-2 text-xs font-semibold border border-blue-700 dark:border-blue-500 text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/40 rounded-lg hover:bg-blue-100/70 dark:hover:bg-blue-900/50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <HardDriveDownload className="w-3.5 h-3.5" />
                <span>
                  {capturingOffline ? 'A capturar recursos...' : 'Capturar Versão Offline Agora'}
                </span>
              </button>
            </div>
          </div>
        )}

        {project.sourceBundleId && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              Pacote offline incorporado pronto para compilação{' '}
              {bundleSummary
                ? `(${bundleSummary.fileCount} ficheiros · ${(bundleSummary.totalBytes / 1024).toFixed(
                    1
                  )} KB)`
                : `(ID: ${project.sourceBundleId})`}
            </span>
          </div>
        )}
      </div>

      {/* Main Split: 4-Step Wizard + Real-Time Simulator */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
          {/* Modern Stepper Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
            {(
              [
                { num: 1 as const, badge: '01', label: 'Informações', icon: Sparkles },
                { num: 2 as const, badge: '02', label: 'Plataformas', icon: Smartphone },
                { num: 3 as const, badge: '03', label: 'Visual & Ícone', icon: Palette },
                { num: 4 as const, badge: '04', label: 'Offline & Avançado', icon: Settings2 },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = step === tab.num;
              return (
                <button
                  key={tab.num}
                  type="button"
                  onClick={() => setStep(tab.num)}
                  className={`py-3.5 px-3 text-left border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                    active
                      ? 'border-blue-700 dark:border-blue-500 text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-900'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-md text-[10px] font-mono font-bold inline-flex items-center justify-center shrink-0 ${
                      active
                        ? 'bg-blue-700 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                  <Icon className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                  <span className="text-xs font-semibold truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-6 space-y-5">
            {/* STEP 1: App Info */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nome da Aplicação
                    </label>
                    <input
                      type="text"
                      value={project.appName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProject((prev) => ({
                          ...prev,
                          appName: val,
                          visual: { ...prev.visual, navBarTitle: val },
                        }));
                      }}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Pacote Android (ex: com.empresa.app)
                    </label>
                    <input
                      type="text"
                      value={project.packageName}
                      onChange={(e) => updateField('packageName', e.target.value.toLowerCase())}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Versão (Exibição)
                    </label>
                    <input
                      type="text"
                      value={project.versionName}
                      onChange={(e) => updateField('versionName', e.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Código da Versão
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={project.versionCode}
                      onChange={(e) => updateField('versionCode', Number(e.target.value) || 1)}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Categoria
                    </label>
                    <select
                      value={project.category}
                      onChange={(e) => updateField('category', e.target.value)}
                      className={selectClass}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Autor ou Empresa
                    </label>
                    <input
                      type="text"
                      value={project.author}
                      onChange={(e) => updateField('author', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Identificador Único (UUID)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={project.appIdentifier}
                        className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 font-mono text-slate-600 dark:text-slate-400"
                      />
                      <button
                        type="button"
                        onClick={() => updateField('appIdentifier', generateUuid())}
                        className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                      >
                        Novo
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Descrição da Aplicação
                  </label>
                  <textarea
                    rows={3}
                    value={project.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {/* STEP 2: Platforms */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Smartphone className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Plataforma Android
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        key: 'androidApkDebug' as const,
                        label: 'Android APK (Debug)',
                        desc: 'Testes directos em dispositivos',
                      },
                      {
                        key: 'androidApkRelease' as const,
                        label: 'Android APK (Release)',
                        desc: 'Distribuição directa assinada',
                      },
                      {
                        key: 'androidAab' as const,
                        label: 'Android AAB',
                        desc: 'Submissão Google Play Store',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.key}
                        className={`border rounded-xl p-4 flex items-start gap-3 cursor-pointer transition-colors ${
                          project.platforms[opt.key]
                            ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/40 dark:border-blue-500'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={project.platforms[opt.key]}
                          onChange={(e) =>
                            setProject((prev) => ({
                              ...prev,
                              platforms: { ...prev.platforms, [opt.key]: e.target.checked },
                            }))
                          }
                          className="mt-0.5 accent-blue-700"
                        />
                        <div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
                            {opt.label}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {opt.desc}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Monitor className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Plataforma Windows 10/11
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      {
                        key: 'windowsExe' as const,
                        label: 'Instalador Moderno Windows (.EXE)',
                        desc: 'Assistente MUI2 com logótipo, atalhos com ícone e desinstalador',
                      },
                      {
                        key: 'windowsPortable' as const,
                        label: 'Windows Portátil (.EXE)',
                        desc: 'Executável autónomo sem instalação com ícone nativo',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.key}
                        className={`border rounded-xl p-4 flex items-start gap-3 cursor-pointer transition-colors ${
                          project.platforms[opt.key]
                            ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/40 dark:border-blue-500'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={project.platforms[opt.key]}
                          onChange={(e) =>
                            setProject((prev) => ({
                              ...prev,
                              platforms: { ...prev.platforms, [opt.key]: e.target.checked },
                            }))
                          }
                          className="mt-0.5 accent-blue-700"
                        />
                        <div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
                            {opt.label}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {opt.desc}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Source Code Export & Keystore */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={project.platforms.exportSourceCode}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          platforms: {
                            ...prev.platforms,
                            exportSourceCode: e.target.checked,
                          },
                        }))
                      }
                      className="mt-0.5 accent-blue-700"
                    />
                    <div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
                        Exportar Código-Fonte (.ZIP)
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Projecto completo Android Studio (Gradle/Kotlin) e Electron Builder
                      </span>
                    </div>
                  </label>

                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                    <label className="block text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                      Keystore de Assinatura Android
                    </label>
                    <select
                      value={project.signing.keystoreId || ''}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          signing: {
                            ...prev.signing,
                            keystoreMode: e.target.value ? 'custom_uploaded' : 'auto_managed',
                            keystoreId: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="">Gerida automaticamente (Debug / Padrão)</option>
                      {keystores.map((ks) => (
                        <option key={ks.keystoreId} value={ks.keystoreId}>
                          {ks.alias} ({ks.fileName})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Visual Customization */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Ícone / Logótipo da Aplicação
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setProject((prev) => ({
                            ...prev,
                            visual: { ...prev.visual, iconUrl: DEFAULT_APP_ICON_URL },
                          }))
                        }
                        className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Restaurar padrão
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <AppIconImage
                        src={project.visual.iconUrl}
                        appName={project.appName}
                        primaryColor={project.visual.primaryColor}
                        alt="Ícone"
                        className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                      />
                      <input
                        type="file"
                        accept="image/*,.ico,.svg"
                        onChange={(e) => handleLocalImageUpload(e, 'iconUrl')}
                        className="text-xs text-slate-600 dark:text-slate-400 w-full"
                      />
                    </div>
                    <input
                      type="text"
                      value={project.visual.iconUrl.startsWith('data:') ? '' : project.visual.iconUrl}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          visual: { ...prev.visual, iconUrl: e.target.value },
                        }))
                      }
                      placeholder={
                        project.visual.iconUrl.startsWith('data:')
                          ? 'Imagem personalizada carregada (PNG/SVG incorporado)'
                          : 'Ou cole o URL do ícone (https://...)'
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Imagem de Splash Screen
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setProject((prev) => ({
                            ...prev,
                            visual: { ...prev.visual, splashUrl: DEFAULT_SPLASH_URL },
                          }))
                        }
                        className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Restaurar padrão
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <img
                        src={normalizeVisualAssetUrl(project.visual.splashUrl, 'splash')}
                        alt="Splash"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = DEFAULT_SPLASH_URL;
                        }}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                      />
                      <input
                        type="file"
                        accept="image/*,.svg"
                        onChange={(e) => handleLocalImageUpload(e, 'splashUrl')}
                        className="text-xs text-slate-600 dark:text-slate-400 w-full"
                      />
                    </div>
                    <input
                      type="text"
                      value={project.visual.splashUrl.startsWith('data:') ? '' : project.visual.splashUrl}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          visual: { ...prev.visual, splashUrl: e.target.value },
                        }))
                      }
                      placeholder={
                        project.visual.splashUrl.startsWith('data:')
                          ? 'Imagem personalizada carregada (incorporada no APK/EXE)'
                          : 'Ou cole o URL da splash screen (https://...)'
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* Installed App Icon Preview Card */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Pré-visualização do Ícone Após Instalação (Android &amp; Windows)
                    </span>
                    <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                      Adaptive + Multi-ICO
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex flex-col items-center gap-1.5">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden shadow-xs"
                        style={{ backgroundColor: project.visual.primaryColor }}
                      >
                        <AppIconImage
                          src={project.visual.iconUrl}
                          appName={project.appName}
                          primaryColor={project.visual.primaryColor}
                          alt="Android Launcher"
                          className="w-9 h-9 rounded-lg object-cover bg-white"
                        />
                      </div>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate max-w-full">
                        {project.appName || 'App'}
                      </span>
                      <span className="text-[10px] text-slate-400">Android Padrão</span>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex flex-col items-center gap-1.5">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center overflow-hidden shadow-xs p-1"
                        style={{ backgroundColor: project.visual.primaryColor }}
                      >
                        <AppIconImage
                          src={project.visual.iconUrl}
                          appName={project.appName}
                          primaryColor={project.visual.primaryColor}
                          alt="Android Round"
                          className="w-full h-full rounded-full object-cover bg-white"
                        />
                      </div>
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate max-w-full">
                        {project.appName || 'App'}
                      </span>
                      <span className="text-[10px] text-slate-400">Android Redondo</span>
                    </div>

                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex flex-col items-center gap-1.5">
                      <AppIconImage
                        src={project.visual.iconUrl}
                        appName={project.appName}
                        primaryColor={project.visual.primaryColor}
                        alt="Windows Shortcut"
                        className="w-11 h-11 rounded-md object-cover bg-white p-0.5 shadow-xs"
                      />
                      <span className="text-[11px] font-medium text-slate-100 truncate max-w-full">
                        {project.appName || 'App'}.exe
                      </span>
                      <span className="text-[10px] text-slate-400">Atalho Windows</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Cor Principal
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={project.visual.primaryColor}
                        onChange={(e) =>
                          setProject((prev) => ({
                            ...prev,
                            visual: { ...prev.visual, primaryColor: e.target.value },
                          }))
                        }
                        className="h-9 w-12 rounded border border-slate-300 dark:border-slate-700 cursor-pointer bg-transparent"
                      />
                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                        {project.visual.primaryColor}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Cor Secundária
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={project.visual.secondaryColor}
                        onChange={(e) =>
                          setProject((prev) => ({
                            ...prev,
                            visual: { ...prev.visual, secondaryColor: e.target.value },
                          }))
                        }
                        className="h-9 w-12 rounded border border-slate-300 dark:border-slate-700 cursor-pointer bg-transparent"
                      />
                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                        {project.visual.secondaryColor}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Orientação do Ecrã
                    </label>
                    <select
                      value={project.visual.orientation}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          visual: { ...prev.visual, orientation: e.target.value as any },
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="auto">Automática</option>
                      <option value="portrait">Retrato</option>
                      <option value="landscape">Paisagem</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Modo Escuro da App
                    </label>
                    <select
                      value={project.visual.darkMode}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          visual: { ...prev.visual, darkMode: e.target.value as any },
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="system">Sistema</option>
                      <option value="light">Claro</option>
                      <option value="dark">Escuro</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Barra de Navegação
                    </label>
                    <select
                      value={project.visual.navBarStyle}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          visual: { ...prev.visual, navBarStyle: e.target.value as any },
                        }))
                      }
                      className={selectClass}
                    >
                      <option value="solid">Sólida (Com Cor Principal)</option>
                      <option value="transparent">Transparente</option>
                      <option value="hidden">Oculta</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Título da Barra / Janela
                    </label>
                    <input
                      type="text"
                      value={project.visual.navBarTitle}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          visual: { ...prev.visual, navBarTitle: e.target.value },
                        }))
                      }
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Custom Menu Items */}
                <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Itens do Menu Lateral
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setProject((prev) => ({
                          ...prev,
                          visual: {
                            ...prev.visual,
                            menuItems: [
                              ...prev.visual.menuItems,
                              { label: 'Novo Atalho', action: 'home' as const },
                            ].slice(0, 8),
                          },
                        }))
                      }
                      className="text-xs text-blue-700 dark:text-blue-400 font-medium inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Adicionar item
                    </button>
                  </div>
                  <div className="space-y-2">
                    {project.visual.menuItems.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) => {
                            const next = [...project.visual.menuItems];
                            next[idx] = { ...next[idx], label: e.target.value };
                            setProject((prev) => ({
                              ...prev,
                              visual: { ...prev.visual, menuItems: next },
                            }));
                          }}
                          className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        />
                        <select
                          value={item.action}
                          onChange={(e) => {
                            const next = [...project.visual.menuItems];
                            next[idx] = { ...next[idx], action: e.target.value as any };
                            setProject((prev) => ({
                              ...prev,
                              visual: { ...prev.visual, menuItems: next },
                            }));
                          }}
                          className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        >
                          <option value="home">Início</option>
                          <option value="reload">Actualizar</option>
                          <option value="share">Partilhar</option>
                          <option value="url">Abrir URL</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const next = project.visual.menuItems.filter((_, i) => i !== idx);
                            setProject((prev) => ({
                              ...prev,
                              visual: { ...prev.visual, menuItems: next },
                            }));
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          aria-label="Remover item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 pt-2">
                  <input
                    type="checkbox"
                    checked={!project.visual.brandWatermark}
                    onChange={(e) =>
                      setProject((prev) => ({
                        ...prev,
                        visual: { ...prev.visual, brandWatermark: !e.target.checked },
                      }))
                    }
                    className="accent-blue-700"
                  />
                  <span>Remover marca AppForge Studio (White-label)</span>
                </label>
              </div>
            )}

            {/* STEP 4: Advanced, Offline & Windows Desktop */}
            {step === 4 && (
              <div className="space-y-6">
                {/* Offline Behavior Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <WifiOff className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Modo de Funcionamento Offline
                      </h3>
                    </div>
                    {isUrlDrivenSource && (
                      <button
                        type="button"
                        onClick={handleCaptureOffline}
                        disabled={capturingOffline || !project.sourceUrl.trim()}
                        className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <HardDriveDownload className="w-3.5 h-3.5" />
                        <span>{capturingOffline ? 'A capturar...' : 'Capturar Site Agora'}</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {OFFLINE_MODES.map((m) => {
                      const active = project.advanced.offlineMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setProject((prev) => ({
                              ...prev,
                              advanced: { ...prev.advanced, offlineMode: m.id },
                            }))
                          }
                          className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                            active
                              ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/40 dark:border-blue-500'
                              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
                            {m.title}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block mt-0.5">
                            {m.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {project.advanced.offlineMode === 'fallback_page' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Mensagem do Ecrã Offline
                      </label>
                      <input
                        type="text"
                        value={project.advanced.offlineMessage}
                        onChange={(e) =>
                          setProject((prev) => ({
                            ...prev,
                            advanced: { ...prev.advanced, offlineMessage: e.target.value },
                          }))
                        }
                        className={inputClass}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                    Comportamento WebView &amp; Navegação
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {[
                      ['enableZoom', 'Permitir Zoom'],
                      ['fullscreen', 'Modo Ecrã Inteiro'],
                      ['enableJavaScript', 'Activar JavaScript'],
                      ['enableCache', 'Activar Cache'],
                      ['enableCookies', 'Activar Cookies'],
                      ['enableDownloads', 'Permitir Downloads'],
                      ['enableFileUpload', 'Upload de Ficheiros'],
                      ['autoRefresh', 'Actualização Automática'],
                      ['enablePushNotifications', 'Push Notifications (FCM)'],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean((project.advanced as any)[key])}
                          onChange={(e) =>
                            setProject((prev) => ({
                              ...prev,
                              advanced: { ...prev.advanced, [key]: e.target.checked },
                            }))
                          }
                          className="accent-blue-700"
                        />
                        <span className="text-slate-700 dark:text-slate-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Barra de Estado
                    </label>
                    <select
                      value={project.advanced.statusBarStyle}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          advanced: { ...prev.advanced, statusBarStyle: e.target.value as any },
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="default">Padrão</option>
                      <option value="light">Clara</option>
                      <option value="dark">Escura</option>
                      <option value="hidden">Oculta</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Botão Voltar
                    </label>
                    <select
                      value={project.advanced.backButtonBehavior}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          advanced: {
                            ...prev.advanced,
                            backButtonBehavior: e.target.value as any,
                          },
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="history">Navegar Histórico</option>
                      <option value="confirm_exit">Confirmar Saída</option>
                      <option value="exit">Sair Imediatamente</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Links Externos
                    </label>
                    <select
                      value={project.advanced.externalLinks}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          advanced: { ...prev.advanced, externalLinks: e.target.value as any },
                        }))
                      }
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    >
                      <option value="system_browser">Abrir no Navegador</option>
                      <option value="in_app">Abrir na Aplicação</option>
                      <option value="block">Bloquear Externos</option>
                    </select>
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                    Permissões do Sistema
                  </label>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {(
                      [
                        ['camera', 'Câmara'],
                        ['microphone', 'Microfone'],
                        ['location', 'Localização GPS'],
                        ['storage', 'Armazenamento'],
                        ['notifications', 'Notificações'],
                      ] as const
                    ).map(([permKey, permLabel]) => (
                      <label
                        key={permKey}
                        className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 cursor-pointer text-slate-700 dark:text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={project.advanced.permissions[permKey]}
                          onChange={(e) =>
                            setProject((prev) => ({
                              ...prev,
                              advanced: {
                                ...prev.advanced,
                                permissions: {
                                  ...prev.advanced.permissions,
                                  [permKey]: e.target.checked,
                                },
                              },
                            }))
                          }
                          className="accent-blue-700"
                        />
                        <span>{permLabel}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      User-Agent Personalizado
                    </label>
                    <input
                      type="text"
                      value={project.advanced.userAgent}
                      onChange={(e) =>
                        setProject((prev) => ({
                          ...prev,
                          advanced: { ...prev.advanced, userAgent: e.target.value },
                        }))
                      }
                      placeholder="Padrão do WebView / WebView2"
                      className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Domínios Autorizados
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="exemplo.com"
                        className="flex-1 px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={addAuthorizedDomain}
                        className="px-3 py-2 text-xs bg-slate-900 dark:bg-slate-800 text-white rounded-lg cursor-pointer hover:bg-slate-800 dark:hover:bg-slate-700"
                      >
                        Adicionar
                      </button>
                    </div>
                    {project.advanced.authorizedDomains.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-2 text-xs font-mono text-slate-600 dark:text-slate-400">
                        {project.advanced.authorizedDomains.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() =>
                              setProject((prev) => ({
                                ...prev,
                                advanced: {
                                  ...prev.advanced,
                                  authorizedDomains: prev.advanced.authorizedDomains.filter(
                                    (x) => x !== d
                                  ),
                                },
                              }))
                            }
                            className="underline hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                          >
                            {d} ×
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Windows Desktop Specific Config */}
                <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Configurações Desktop Windows (.EXE)
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Largura Inicial (px)
                      </label>
                      <input
                        type="number"
                        value={project.windowsConfig.winWidth}
                        onChange={(e) =>
                          setProject((prev) => ({
                            ...prev,
                            windowsConfig: {
                              ...prev.windowsConfig,
                              winWidth: Number(e.target.value) || 1280,
                            },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Altura Inicial (px)
                      </label>
                      <input
                        type="number"
                        value={project.windowsConfig.winHeight}
                        onChange={(e) =>
                          setProject((prev) => ({
                            ...prev,
                            windowsConfig: {
                              ...prev.windowsConfig,
                              winHeight: Number(e.target.value) || 800,
                            },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    {[
                      ['winResizable', 'Permitir Redimensionar'],
                      ['winMaximizable', 'Permitir Maximizar'],
                      ['winMinimizable', 'Permitir Minimizar'],
                      ['winFullscreen', 'Iniciar em Ecrã Inteiro'],
                      ['winMenuBar', 'Barra de Menus'],
                      ['winDesktopShortcut', 'Atalho Ambiente de Trabalho'],
                      ['winStartMenuShortcut', 'Atalho Menu Iniciar'],
                      ['winAutoStart', 'Arranque Automático'],
                      ['winSystemTray', 'Ícone System Tray'],
                      ['winContextMenu', 'Menu de Contexto'],
                      ['winPrintSupport', 'Suporte de Impressão'],
                      ['winNotifications', 'Notificações Desktop'],
                      ['winAutoUpdate', 'Actualizações Automáticas'],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 rounded-lg p-2 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean((project.windowsConfig as any)[key])}
                          onChange={(e) =>
                            setProject((prev) => ({
                              ...prev,
                              windowsConfig: {
                                ...prev.windowsConfig,
                                [key]: e.target.checked,
                              },
                            }))
                          }
                          className="accent-blue-700"
                        />
                        <span className="text-slate-700 dark:text-slate-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step Footer Navigation */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                disabled={step === 1}
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))}
                className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                Etapa Anterior
              </button>
              {step < 4 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s))}
                  className="px-4 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-800 text-white rounded-lg hover:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Próxima Etapa
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLaunchBuild}
                  disabled={building}
                  className="px-5 py-2 text-xs font-semibold bg-blue-700 text-white rounded-lg hover:bg-blue-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{building ? 'A compilar...' : 'Compilar Agora'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sticky Live Simulator */}
        <div className="xl:col-span-5 xl:sticky xl:top-20">
          <LiveSimulator project={project} supportsIframe={supportsIframe} />
        </div>
      </div>
    </div>
  );
};
