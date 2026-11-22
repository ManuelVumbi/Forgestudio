export type ConversionType = 'url' | 'files' | 'web_project';

export type WebFramework =
  | 'auto'
  | 'html'
  | 'react'
  | 'vue'
  | 'angular'
  | 'laravel'
  | 'php'
  | 'static';

export interface PlatformSelection {
  androidApkDebug: boolean;
  androidApkRelease: boolean;
  androidAab: boolean;
  windowsExe: boolean;
  windowsPortable: boolean;
  exportSourceCode: boolean;
}

export interface NavMenuItem {
  label: string;
  action: 'url' | 'reload' | 'share' | 'home' | 'exit';
  url?: string;
}

export interface VisualConfig {
  iconUrl: string;
  splashUrl: string;
  loadingImageUrl: string;
  primaryColor: string;
  secondaryColor: string;
  navBarStyle: 'solid' | 'transparent' | 'hidden';
  navBarTitle: string;
  menuItems: NavMenuItem[];
  orientation: 'auto' | 'portrait' | 'landscape';
  darkMode: 'system' | 'light' | 'dark';
  brandWatermark: boolean;
}

export interface PermissionsConfig {
  camera: boolean;
  microphone: boolean;
  location: boolean;
  storage: boolean;
  notifications: boolean;
}

export interface AdvancedConfig {
  enableZoom: boolean;
  fullscreen: boolean;
  statusBarStyle: 'default' | 'light' | 'dark' | 'hidden';
  backButtonBehavior: 'history' | 'confirm_exit' | 'exit';
  autoRefresh: boolean;
  autoRefreshIntervalSec: number;
  enableCache: boolean;
  enableCookies: boolean;
  userAgent: string;
  permissions: PermissionsConfig;
  enableDownloads: boolean;
  enableFileUpload: boolean;
  externalLinks: 'in_app' | 'system_browser' | 'block';
  offlineMode: 'offline_app' | 'fallback_page' | 'cache_first' | 'disabled';
  offlineMessage: string;
  enableJavaScript: boolean;
  enablePushNotifications: boolean;
  fcmSenderId: string;
  authorizedDomains: string[];
}

export interface WindowsConfig {
  winWidth: number;
  winHeight: number;
  winResizable: boolean;
  winMaximizable: boolean;
  winMinimizable: boolean;
  winFullscreen: boolean;
  winMenuBar: boolean;
  winDesktopShortcut: boolean;
  winStartMenuShortcut: boolean;
  winAutoStart: boolean;
  winSystemTray: boolean;
  winContextMenu: boolean;
  winAutoUpdate: boolean;
  winPrintSupport: boolean;
  winNotifications: boolean;
  winPermissions: string[];
}

export interface SigningConfig {
  keystoreMode: 'auto_managed' | 'custom_uploaded';
  keystoreId?: string;
  keystoreAlias: string;
  packageSha256?: string;
}

export interface AppProject {
  id: string;
  ownerId: string;
  ownerEmail?: string;
  conversionType: ConversionType;
  framework: WebFramework;
  sourceBundleId?: string;
  appName: string;
  packageName: string;
  appIdentifier: string;
  description: string;
  versionName: string;
  versionCode: number;
  author: string;
  sourceUrl: string;
  category: string;
  platforms: PlatformSelection;
  visual: VisualConfig;
  advanced: AdvancedConfig;
  windowsConfig: WindowsConfig;
  signing: SigningConfig;
  createdAt: any;
  updatedAt: any;
}

export type BuildStatus =
  | 'queued'
  | 'processing'
  | 'compiling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BuildArtifact {
  format:
    | 'APK_DEBUG'
    | 'APK_RELEASE'
    | 'AAB'
    | 'WINDOWS_EXE'
    | 'WINDOWS_PORTABLE'
    | 'ANDROID_SOURCE_ZIP'
    | 'WINDOWS_SOURCE_ZIP';
  label: string;
  fileName: string;
  sizeBytes: number;
  downloadUrl?: string;
  sha256?: string;
  status: 'ready' | 'missing_infrastructure' | 'failed';
  missingRequirements?: string[];
}

export interface BuildJob {
  id: string;
  projectId: string;
  ownerId: string;
  appName: string;
  versionName: string;
  targetFormats: string[];
  status: BuildStatus;
  progress: number;
  currentStep: string;
  logs: string[];
  artifacts: BuildArtifact[];
  missingInfrastructure: string[];
  errorMessage?: string;
  createdAt: any;
  updatedAt: any;
  completedAt?: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'user' | 'admin';
  planId: 'free' | 'pro' | 'enterprise';
  accountStatus: 'active' | 'suspended';
  storageUsedBytes: number;
  buildsThisMonth: number;
  createdAt: any;
  updatedAt: any;
}

export interface SubscriptionPlan {
  id: 'free' | 'pro' | 'enterprise';
  name: string;
  tagline?: string;
  monthlyPriceEur: number;
  maxProjects: number;
  maxBuildsPerMonth: number;
  maxStorageMb: number;
  allowApkDebug: boolean;
  allowApkRelease: boolean;
  allowAab: boolean;
  allowWindowsExe: boolean;
  allowWindowsPortable: boolean;
  allowSourceExport: boolean;
  whiteLabel: boolean;
  priorityQueue: boolean;
  teamSeats: number;
  updatedAt: any;
}

export interface DownloadRecord {
  id: string;
  ownerId: string;
  buildId: string;
  projectId: string;
  appName: string;
  format: string;
  fileName: string;
  sizeBytes: number;
  downloadedAt: any;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  userEmail: string;
  planId: 'free' | 'pro' | 'enterprise';
  amountEur: number;
  status: 'paid' | 'pending' | 'refunded';
  method: string;
  createdAt: any;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: any;
}

export interface EngineSettings {
  androidSdkVersion: string;
  gradleVersion: string;
  electronVersion: string;
  androidWorkerUrl?: string;
  windowsWorkerUrl?: string;
  androidWorkerConfigured: boolean;
  windowsWorkerConfigured: boolean;
  maxConcurrentBuilds: number;
  maxUploadSizeMb: number;
  updatedAt: any;
}

export interface AdminEngineSecrets {
  remoteWorkerAuthToken?: string;
  githubActionsRepo?: string;
  githubActionsToken?: string;
  fcmServerProjectId?: string;
  updatedAt: any;
}

export interface UrlAnalysisResult {
  url: string;
  appName: string;
  description: string;
  packageName: string;
  iconUrl: string;
  splashUrl: string;
  primaryColor: string;
  secondaryColor: string;
  detectedFramework: WebFramework;
  detectedMarkers: string[];
  hasManifest: boolean;
  supportsIframePreview: boolean;
}

export interface InfrastructureProbe {
  hostOs: string;
  nodeVersion: string;
  localTools: {
    java: { available: boolean; version?: string };
    gradle: { available: boolean; version?: string };
    androidSdk: { available: boolean; path?: string };
    makensis: { available: boolean; version?: string };
    wine: { available: boolean; version?: string };
    electronBuilder: { available: boolean; version?: string };
    zipEngine: { available: boolean };
  };
  remoteWorkers: {
    androidWorkerUrl: string;
    androidWorkerReachable: boolean;
    windowsWorkerUrl: string;
    windowsWorkerReachable: boolean;
  };
  capabilities: {
    sourceCodeGeneration: boolean;
    keystoreGeneration: boolean;
    androidApkCompilation: boolean;
    androidAabCompilation: boolean;
    windowsExeCompilation: boolean;
    windowsPortableCompilation: boolean;
  };
  missingForAndroidBinary: string[];
  missingForWindowsBinary: string[];
}

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

export interface UploadedBundleSummary {
  bundleId: string;
  fileCount: number;
  totalBytes: number;
  hasIndexHtml: boolean;
  detectedFramework: 'html' | 'react' | 'vue' | 'angular' | 'static';
  entryPath: string;
  filesPreview: string[];
}
