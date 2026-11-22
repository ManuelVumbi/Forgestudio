import { AppProject, EngineSettings } from '../types/appforge';

export const DEFAULT_APP_ICON_URL = '/assets/appforge_default_icon.jpg';
export const DEFAULT_SPLASH_URL = '/assets/appforge_splash_backdrop.jpg';

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  androidSdkVersion: 'API 34 (Android 14)',
  gradleVersion: '8.7',
  electronVersion: '32.0.0',
  androidWorkerUrl: '',
  windowsWorkerUrl: '',
  androidWorkerConfigured: false,
  windowsWorkerConfigured: false,
  maxConcurrentBuilds: 2,
  maxUploadSizeMb: 50,
  updatedAt: null,
};

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBlankProject(ownerId: string, ownerEmail?: string): AppProject {
  const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    ownerId,
    ownerEmail: ownerEmail || '',
    conversionType: 'url',
    framework: 'auto',
    sourceBundleId: '',
    appName: 'Minha Aplicação',
    packageName: 'com.appforge.minhaapp',
    appIdentifier: generateUuid(),
    description: 'Aplicação multiplataforma criada com o AppForge Studio.',
    versionName: '1.0.0',
    versionCode: 1,
    author: 'AppForge Developer',
    sourceUrl: 'https://example.com',
    category: 'Produtividade',
    platforms: {
      androidApkDebug: true,
      androidApkRelease: false,
      androidAab: false,
      windowsExe: true,
      windowsPortable: false,
      exportSourceCode: true,
    },
    visual: {
      iconUrl: DEFAULT_APP_ICON_URL,
      splashUrl: DEFAULT_SPLASH_URL,
      loadingImageUrl: '',
      primaryColor: '#1D4ED8',
      secondaryColor: '#0F172A',
      navBarStyle: 'solid',
      navBarTitle: 'Minha Aplicação',
      menuItems: [
        { label: 'Início', action: 'home' },
        { label: 'Actualizar', action: 'reload' },
        { label: 'Partilhar', action: 'share' },
      ],
      orientation: 'auto',
      darkMode: 'system',
      brandWatermark: false,
    },
    advanced: {
      enableZoom: false,
      fullscreen: false,
      statusBarStyle: 'default',
      backButtonBehavior: 'history',
      autoRefresh: false,
      autoRefreshIntervalSec: 60,
      enableCache: true,
      enableCookies: true,
      userAgent: '',
      permissions: {
        camera: false,
        microphone: false,
        location: false,
        storage: true,
        notifications: true,
      },
      enableDownloads: true,
      enableFileUpload: true,
      externalLinks: 'system_browser',
      offlineMode: 'fallback_page',
      offlineMessage: 'Sem ligação à Internet. Verifique a sua ligação e tente novamente.',
      enableJavaScript: true,
      enablePushNotifications: false,
      fcmSenderId: '',
      authorizedDomains: [],
    },
    windowsConfig: {
      winWidth: 1280,
      winHeight: 800,
      winResizable: true,
      winMaximizable: true,
      winMinimizable: true,
      winFullscreen: false,
      winMenuBar: false,
      winDesktopShortcut: true,
      winStartMenuShortcut: true,
      winAutoStart: false,
      winSystemTray: true,
      winContextMenu: true,
      winAutoUpdate: true,
      winPrintSupport: true,
      winNotifications: true,
      winPermissions: ['downloads', 'notifications', 'printing'],
    },
    signing: {
      keystoreMode: 'auto_managed',
      keystoreId: '',
      keystoreAlias: 'appforge_release',
      packageSha256: '',
    },
    createdAt: null,
    updatedAt: null,
  };
}
