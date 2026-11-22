import React, { useState } from 'react';
import {
  Battery,
  ExternalLink,
  Home,
  Menu,
  Minus,
  Monitor,
  RefreshCw,
  Share2,
  Smartphone,
  Sparkles,
  Square,
  Wifi,
  X,
} from 'lucide-react';
import { AppProject } from '../types/appforge';
import { AppIconImage, normalizeVisualAssetUrl } from './AppIconImage';

interface LiveSimulatorProps {
  project: AppProject;
  supportsIframe?: boolean;
}

type SimMode = 'android' | 'windows' | 'splash';

export const LiveSimulator: React.FC<LiveSimulatorProps> = ({
  project,
  supportsIframe = true,
}) => {
  const [mode, setMode] = useState<SimMode>('android');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState(false);

  const isDark = project.visual.darkMode === 'dark';
  const primary = project.visual.primaryColor || '#1D4ED8';
  const secondary = project.visual.secondaryColor || '#0F172A';
  const isOfflineSource =
    project.conversionType !== 'url' ||
    project.advanced.offlineMode === 'offline_app' ||
    Boolean(project.sourceBundleId);

  const renderViewportContent = () => {
    if (simulateOffline) {
      if (isOfflineSource && project.advanced.offlineMode !== 'fallback_page') {
        return (
          <div
            className={`h-full w-full flex flex-col items-center justify-center p-6 text-center ${
              isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'
            }`}
          >
            <AppIconImage
              src={project.visual.iconUrl}
              appName={project.appName}
              primaryColor={primary}
              alt={project.appName}
              className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 mb-3 bg-white"
            />
            <p className="text-sm font-semibold mb-1">{project.appName}</p>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 mb-2">
              Modo Offline Activo
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Sem rede detectada — a aplicação continua a executar normalmente a partir dos recursos empacotados.
            </p>
          </div>
        );
      }

      return (
        <div
          className={`h-full w-full flex flex-col items-center justify-center p-6 text-center ${
            isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'
          }`}
        >
          <div className="w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-3">
            <Wifi className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-semibold mb-1">{project.appName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
            {project.advanced.offlineMessage}
          </p>
          <button
            type="button"
            onClick={() => setSimulateOffline(false)}
            style={{ backgroundColor: primary }}
            className="px-3.5 py-1.5 text-xs font-medium text-white rounded-lg cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      );
    }

    if (
      project.conversionType === 'url' &&
      project.advanced.offlineMode !== 'offline_app' &&
      supportsIframe &&
      project.sourceUrl?.startsWith('http')
    ) {
      return (
        <iframe
          title={`Pré-visualização ${project.appName}`}
          src={project.sourceUrl}
          className="w-full h-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      );
    }

    return (
      <div
        className={`h-full w-full flex flex-col justify-between p-5 ${
          isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
        }`}
      >
        <div>
          <div className="flex items-center gap-3 mb-4">
            <AppIconImage
              src={project.visual.iconUrl}
              appName={project.appName}
              primaryColor={primary}
              alt={project.appName}
              className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{project.appName}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                {isOfflineSource
                  ? `Pacote Offline (${project.framework.toUpperCase()})`
                  : project.sourceUrl}
              </p>
            </div>
          </div>

          <div
            className={`rounded-xl border p-4 mb-3 ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-xs font-medium mb-1">Conteúdo WebView Activo</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isOfflineSource
                ? 'Os ficheiros HTML, CSS, JS, imagens e fontes executam localmente dentro da aplicação sem precisar de Internet.'
                : 'Alguns websites bloqueiam incorporação em iframe (X-Frame-Options). Na aplicação compilada Android/Windows abrirá integralmente.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div
              className={`p-2.5 rounded-lg border ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              <span className="text-slate-500 dark:text-slate-400 block">JavaScript</span>
              <span className="font-medium">
                {project.advanced.enableJavaScript ? 'Activo' : 'Desactivado'}
              </span>
            </div>
            <div
              className={`p-2.5 rounded-lg border ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
              }`}
            >
              <span className="text-slate-500 dark:text-slate-400 block">Modo Offline</span>
              <span className="font-medium">
                {isOfflineSource ? 'Incorporado' : 'Fallback'}
              </span>
            </div>
          </div>
        </div>

        {project.visual.brandWatermark && (
          <p className="text-[10px] text-center text-slate-400 pt-2">
            Compilado com AppForge Studio
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Pré-visualização em Tempo Real
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Actualiza instantaneamente com as suas configurações
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg border border-transparent dark:border-slate-800">
          <button
            type="button"
            onClick={() => setMode('android')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              mode === 'android'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Android</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('windows')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              mode === 'windows'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Windows</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('splash')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              mode === 'splash'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Splash &amp; Ícone</span>
          </button>
        </div>
      </div>

      {/* Android Simulator */}
      {mode === 'android' && (
        <div className="flex flex-col items-center">
          <div
            className={`relative border-[8px] border-slate-900 dark:border-slate-700 rounded-[2rem] overflow-hidden bg-white dark:bg-slate-950 shadow-sm transition-all ${
              project.visual.orientation === 'landscape'
                ? 'w-full max-w-[440px] h-[270px]'
                : 'w-[290px] h-[520px]'
            }`}
          >
            {/* Status Bar */}
            {!project.advanced.fullscreen && project.advanced.statusBarStyle !== 'hidden' && (
              <div
                style={{
                  backgroundColor:
                    project.advanced.statusBarStyle === 'dark' ? '#0F172A' : primary,
                }}
                className="px-4 py-1.5 text-[10px] font-mono text-white flex items-center justify-between"
              >
                <span>12:24</span>
                <div className="flex items-center gap-2">
                  <Wifi className="w-3 h-3" />
                  <Battery className="w-3.5 h-3.5" />
                </div>
              </div>
            )}

            {/* App Navigation Bar */}
            {project.visual.navBarStyle !== 'hidden' && (
              <div
                style={{
                  backgroundColor:
                    project.visual.navBarStyle === 'transparent' ? 'transparent' : primary,
                  color: project.visual.navBarStyle === 'transparent' ? '#0F172A' : '#FFFFFF',
                }}
                className="px-3 py-2.5 flex items-center justify-between border-b border-black/5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(!drawerOpen)}
                    className="p-1 rounded hover:bg-black/10 cursor-pointer"
                    aria-label="Abrir menu"
                  >
                    <Menu className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold truncate">
                    {project.visual.navBarTitle || project.appName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSimulateOffline(!simulateOffline)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-black/15 cursor-pointer"
                  title="Alternar simulação offline"
                >
                  {simulateOffline ? 'Online' : 'Offline'}
                </button>
              </div>
            )}

            {/* Drawer Menu Overlay */}
            {drawerOpen && (
              <div className="absolute inset-0 z-20 flex">
                <div className="w-52 bg-white dark:bg-slate-900 h-full border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
                      <AppIconImage
                        src={project.visual.iconUrl}
                        appName={project.appName}
                        primaryColor={primary}
                        className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {project.appName}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                          v{project.versionName}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {project.visual.menuItems.map((item, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setDrawerOpen(false)}
                          className="w-full text-left px-2.5 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md flex items-center gap-2 cursor-pointer"
                        >
                          {item.action === 'reload' ? (
                            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                          ) : item.action === 'share' ? (
                            <Share2 className="w-3.5 h-3.5 text-slate-500" />
                          ) : item.action === 'url' ? (
                            <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                          ) : (
                            <Home className="w-3.5 h-3.5 text-slate-500" />
                          )}
                          <span className="truncate">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white text-left cursor-pointer"
                  >
                    Fechar menu
                  </button>
                </div>
                <div
                  className="flex-1 bg-black/30"
                  onClick={() => setDrawerOpen(false)}
                />
              </div>
            )}

            {/* Main WebView Area */}
            <div className="h-[calc(100%-70px)] w-full overflow-hidden">
              {renderViewportContent()}
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 font-mono flex items-center gap-3">
            <span>{project.packageName}</span>
            <span>·</span>
            <span>{project.visual.orientation}</span>
          </div>
        </div>
      )}

      {/* Windows 11 Simulator */}
      {mode === 'windows' && (
        <div className="space-y-3">
          <div
            onContextMenu={(e) => {
              if (project.windowsConfig.winContextMenu) {
                e.preventDefault();
                setContextMenuOpen(!contextMenuOpen);
              }
            }}
            className="relative border border-slate-300 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-950 shadow-sm"
          >
            {/* Titlebar */}
            <div
              className={`px-3 py-2 flex items-center justify-between border-b ${
                isDark
                  ? 'bg-slate-900 text-slate-100 border-slate-800'
                  : 'bg-slate-100 text-slate-900 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <AppIconImage
                  src={project.visual.iconUrl}
                  appName={project.appName}
                  primaryColor={primary}
                  className="w-4 h-4 rounded object-cover bg-white"
                />
                <span className="text-xs font-medium truncate">
                  {project.visual.navBarTitle || project.appName}
                </span>
              </div>
              <div className="flex items-center gap-3 text-slate-500">
                {project.windowsConfig.winMinimizable && <Minus className="w-3.5 h-3.5" />}
                {project.windowsConfig.winMaximizable && <Square className="w-3 h-3" />}
                <X className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Optional Menu Bar */}
            {project.windowsConfig.winMenuBar && (
              <div className="px-3 py-1 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 text-[11px] text-slate-700 dark:text-slate-300">
                <span>Ficheiro</span>
                <span>Navegação</span>
                <span>Imprimir</span>
                <span>Ajuda</span>
              </div>
            )}

            {/* Desktop Viewport */}
            <div className="h-[340px] w-full overflow-hidden relative">
              {renderViewportContent()}

              {contextMenuOpen && (
                <div className="absolute top-8 right-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md py-1 w-40 z-10 text-xs text-slate-700 dark:text-slate-200">
                  <button
                    type="button"
                    onClick={() => setContextMenuOpen(false)}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Recarregar página
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimulateOffline(!simulateOffline);
                      setContextMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Simular Offline
                  </button>
                  {project.windowsConfig.winPrintSupport && (
                    <button
                      type="button"
                      onClick={() => setContextMenuOpen(false)}
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Imprimir (Ctrl+P)
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Simulated Windows Taskbar */}
            <div className="bg-slate-900 text-slate-200 px-3 py-1.5 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-400">
                  {project.windowsConfig.winWidth}×{project.windowsConfig.winHeight}px
                </span>
                {project.windowsConfig.winDesktopShortcut && (
                  <span className="text-slate-300">· Atalho Ambiente de Trabalho</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {project.windowsConfig.winSystemTray && (
                  <AppIconImage
                    src={project.visual.iconUrl}
                    appName={project.appName}
                    primaryColor={primary}
                    alt="System Tray"
                    className="w-3.5 h-3.5 rounded-sm bg-white"
                    title="System Tray Activo"
                  />
                )}
                <span className="font-mono">WIN11</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Clique com o botão direito na janela para pré-visualizar o menu de contexto desktop.
          </p>
        </div>
      )}

      {/* Splash & Icon Preview */}
      {mode === 'splash' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col items-center text-center bg-slate-50 dark:bg-slate-950">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">Ícone da Aplicação</p>
            <AppIconImage
              src={project.visual.iconUrl}
              appName={project.appName}
              primaryColor={primary}
              alt={project.appName}
              className="w-20 h-20 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 bg-white shadow-sm mb-3"
            />
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{project.appName}</p>
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">{project.packageName}</p>
          </div>

          <div
            className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 h-[280px] flex flex-col items-center justify-center p-6 text-center"
            style={{ backgroundColor: secondary }}
          >
            {project.visual.splashUrl && (
              <img
                src={normalizeVisualAssetUrl(project.visual.splashUrl, 'splash')}
                alt="Splash Screen"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover opacity-85"
              />
            )}
            <div className="relative z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col items-center">
              <AppIconImage
                src={project.visual.iconUrl}
                appName={project.appName}
                primaryColor={primary}
                className="w-12 h-12 rounded-xl object-cover mb-2 bg-white"
              />
              <p className="text-sm font-bold text-slate-900 dark:text-white">{project.appName}</p>
              <div className="w-24 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-3">
                <div
                  className="h-full w-2/3 rounded-full"
                  style={{ backgroundColor: primary }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
