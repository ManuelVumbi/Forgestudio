import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { AppProject } from '../../src/types/appforge.ts';
import { readBundleFilesForPackaging } from '../uploadManager.ts';
import { generateWindowsIco, resolveIconToPng } from './iconHelper.ts';

function buildOfflineHtml(project: AppProject): string {
  const msg = project.advanced.offlineMessage || 'Sem ligação à Internet. Verifique a sua ligação e tente novamente.';
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <title>${project.appName}</title>
  <style>
    body{font-family:'Segoe UI',sans-serif;background:#ffffff;color:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
    .box{max-width:420px;border:1px solid #e2e8f0;border-radius:14px;padding:32px}
    button{background:${project.visual.primaryColor || '#1D4ED8'};color:#fff;border:0;border-radius:8px;padding:10px 20px;font-weight:600;cursor:pointer;margin-top:16px}
  </style>
</head>
<body>
  <div class="box">
    <h2>${project.appName}</h2>
    <p>${msg}</p>
    <button onclick="window.location.reload()">Recarregar</button>
  </div>
</body>
</html>`;
}

export async function generateWindowsProjectZip(project: AppProject): Promise<Buffer> {
  const zip = new JSZip();
  const hasBundle = Boolean(project.sourceBundleId);
  const isOfflineBundle =
    hasBundle &&
    (project.conversionType !== 'url' || project.advanced.offlineMode === 'offline_app');
  const safeSlug = project.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'appforge-desktop';

  zip.file(
    'package.json',
    JSON.stringify(
      {
        name: safeSlug,
        version: project.versionName || '1.0.0',
        description: project.description || `${project.appName} Desktop Application`,
        author: project.author || 'AppForge Studio',
        main: 'main.js',
        scripts: {
          start: 'electron .',
          'dist:exe': 'electron-builder --win nsis',
          'dist:portable': 'electron-builder --win portable',
          'dist:all': 'electron-builder --win nsis portable',
        },
        devDependencies: {
          electron: '^32.0.0',
          'electron-builder': '^25.1.8',
        },
        dependencies: {
          'electron-updater': '^6.3.9',
        },
      },
      null,
      2
    )
  );

  const targets: string[] = [];
  if (project.platforms.windowsExe) targets.push('nsis');
  if (project.platforms.windowsPortable) targets.push('portable');
  if (!targets.length) targets.push('nsis');

  zip.file(
    'electron-builder.yml',
    `appId: ${project.packageName}
productName: "${project.appName.replace(/"/g, '')}"
directories:
  output: dist
files:
  - main.js
  - preload.js
  - offline.html
  - build/icon.ico
  - build/icon.png
  - web/**/*
win:
  icon: build/icon.ico
  target:
${targets.map((t) => `    - target: ${t}\n      arch:\n        - x64`).join('\n')}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  installerHeaderIcon: build/icon.ico
  createDesktopShortcut: ${project.windowsConfig.winDesktopShortcut}
  createStartMenuShortcut: ${project.windowsConfig.winStartMenuShortcut}
  shortcutName: "${project.appName.replace(/"/g, '')}"
portable:
  artifactName: "${safeSlug}-portable-\${version}.exe"
`
  );

  zip.file(
    'preload.js',
    `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appForgeDesktop', {
  printPage: () => ipcRenderer.send('appforge:print'),
  notify: (title, body) => ipcRenderer.send('appforge:notify', { title, body }),
  platform: process.platform,
});
`
  );

  zip.file(
    'main.js',
    `const { app, BrowserWindow, Menu, Tray, shell, Notification, ipcMain, nativeTheme, session } = require('electron');
const path = require('path');

const APP_CONFIG = ${JSON.stringify(
      {
        appName: project.appName,
        sourceUrl: project.sourceUrl || 'https://example.com',
        isOfflineBundle,
        width: project.windowsConfig.winWidth || 1280,
        height: project.windowsConfig.winHeight || 800,
        resizable: project.windowsConfig.winResizable,
        maximizable: project.windowsConfig.winMaximizable,
        minimizable: project.windowsConfig.winMinimizable,
        fullscreen: project.windowsConfig.winFullscreen,
        menuBar: project.windowsConfig.winMenuBar,
        autoStart: project.windowsConfig.winAutoStart,
        systemTray: project.windowsConfig.winSystemTray,
        contextMenu: project.windowsConfig.winContextMenu,
        printSupport: project.windowsConfig.winPrintSupport,
        notifications: project.windowsConfig.winNotifications,
        enableDownloads: project.advanced.enableDownloads,
        enableCache: project.advanced.enableCache,
        enableCookies: project.advanced.enableCookies,
        enableJavaScript: project.advanced.enableJavaScript,
        userAgent: project.advanced.userAgent,
        externalLinks: project.advanced.externalLinks,
        authorizedDomains: project.advanced.authorizedDomains || [],
        darkMode: project.visual.darkMode,
      },
      null,
      2
    )};

let mainWindow = null;
let tray = null;

function createWindow() {
  if (APP_CONFIG.darkMode === 'dark') nativeTheme.themeSource = 'dark';
  else if (APP_CONFIG.darkMode === 'light') nativeTheme.themeSource = 'light';
  else nativeTheme.themeSource = 'system';

  mainWindow = new BrowserWindow({
    title: APP_CONFIG.appName,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    width: APP_CONFIG.width,
    height: APP_CONFIG.height,
    resizable: APP_CONFIG.resizable,
    maximizable: APP_CONFIG.maximizable,
    minimizable: APP_CONFIG.minimizable,
    fullscreen: APP_CONFIG.fullscreen,
    autoHideMenuBar: !APP_CONFIG.menuBar,
    backgroundColor: APP_CONFIG.darkMode === 'dark' ? '#0f172a' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      javascript: APP_CONFIG.enableJavaScript,
    },
  });

  if (!APP_CONFIG.menuBar) {
    Menu.setApplicationMenu(null);
  }

  if (APP_CONFIG.userAgent) {
    mainWindow.webContents.setUserAgent(APP_CONFIG.userAgent);
  }

  if (!APP_CONFIG.enableCache) {
    session.defaultSession.clearCache();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const isAuth =
        APP_CONFIG.authorizedDomains.length === 0 ||
        APP_CONFIG.authorizedDomains.some((d) => target.hostname.endsWith(d));
      if (APP_CONFIG.externalLinks === 'system_browser' && !isAuth) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      if (APP_CONFIG.externalLinks === 'block' && !isAuth) {
        return { action: 'deny' };
      }
    } catch {}
    return { action: 'allow' };
  });

  if (APP_CONFIG.enableDownloads) {
    session.defaultSession.on('will-download', (_event, item) => {
      item.once('done', (_e, state) => {
        if (state === 'completed' && APP_CONFIG.notifications && Notification.isSupported()) {
          new Notification({ title: APP_CONFIG.appName, body: 'Download concluído: ' + item.getFilename() }).show();
        }
      });
    });
  }

  if (APP_CONFIG.contextMenu) {
    mainWindow.webContents.on('context-menu', () => {
      const ctx = Menu.buildFromTemplate([
        { label: 'Recarregar', click: () => mainWindow.reload() },
        { label: 'Voltar', click: () => mainWindow.webContents.canGoBack() && mainWindow.webContents.goBack() },
        { type: 'separator' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        ...(APP_CONFIG.printSupport ? [{ label: 'Imprimir', click: () => mainWindow.webContents.print() }] : []),
      ]);
      ctx.popup();
    });
  }

  mainWindow.webContents.on('did-fail-load', () => {
    mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  });

  if (APP_CONFIG.isOfflineBundle) {
    mainWindow.loadFile(path.join(__dirname, 'web', 'index.html'));
  } else {
    mainWindow.loadURL(APP_CONFIG.sourceUrl);
  }
}

app.whenReady().then(() => {
  if (APP_CONFIG.autoStart) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  ipcMain.on('appforge:print', () => {
    if (APP_CONFIG.printSupport && mainWindow) mainWindow.webContents.print();
  });

  ipcMain.on('appforge:notify', (_e, payload) => {
    if (APP_CONFIG.notifications && Notification.isSupported()) {
      new Notification({ title: payload.title || APP_CONFIG.appName, body: payload.body || '' }).show();
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`
  );

  zip.file('offline.html', buildOfflineHtml(project));

  if (hasBundle && project.sourceBundleId) {
    const bundleFiles = await readBundleFilesForPackaging(project.ownerId, project.sourceBundleId);
    for (const bf of bundleFiles) {
      zip.file(`web/${bf.relativePath}`, bf.content);
    }
  }

  // Embed Visual & Icon assets (build/icon.ico & build/icon.png) into Windows Source ZIP
  const tmpWinWork = await fs.mkdtemp(path.join(os.tmpdir(), 'af-win-src-'));
  try {
    const iconPng = path.join(tmpWinWork, 'icon.png');
    const iconIco = path.join(tmpWinWork, 'icon.ico');
    await resolveIconToPng(project.visual.iconUrl, project.visual.primaryColor, project.appName, iconPng);
    await generateWindowsIco(iconPng, iconIco);
    zip.file('build/icon.png', await fs.readFile(iconPng));
    zip.file('build/icon.ico', await fs.readFile(iconIco));
  } catch (err) {
    console.warn('Falha ao empacotar ícone no ZIP Windows:', err);
  } finally {
    await fs.rm(tmpWinWork, { recursive: true, force: true }).catch(() => {});
  }

  zip.file(
    'Dockerfile.windows-worker',
    `FROM electronuserland/builder:wine
WORKDIR /workspace
COPY package.json ./
RUN npm install
COPY . .
RUN npm run dist:all
`
  );

  zip.file(
    'BUILD_INSTRUCTIONS.md',
    `# ${project.appName} — Projecto Desktop Windows (Electron + NSIS / Portable)

- App ID: \`${project.packageName}\`
- Versão: \`${project.versionName}\`
- Janela: \`${project.windowsConfig.winWidth}x${project.windowsConfig.winHeight}\`

## Compilar Instalador EXE e Versão Portátil
Em Windows 10/11 ou via Docker (\`electronuserland/builder:wine\`):
\`\`\`bash
npm install
npm run dist:all
\`\`\`
Os executáveis \`.exe\` serão gerados na pasta \`dist/\`.
`
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
