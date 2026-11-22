import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const TOOLCHAINS_DIR = path.resolve(process.cwd(), '.toolchains');
export const ANDROID_SDK_DIR =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(TOOLCHAINS_DIR, 'android-sdk');
export const BUNDLETOOL_JAR = path.join(TOOLCHAINS_DIR, 'bundletool', 'bundletool.jar');
export const WEBVIEW2_NATIVE_DIR = path.join(TOOLCHAINS_DIR, 'webview2', 'build', 'native');

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function cmdExists(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

let bootstrapPromise: Promise<void> | null = null;

export async function ensureAllToolchains(): Promise<{
  androidReady: boolean;
  aabReady: boolean;
  windowsReady: boolean;
}> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().finally(() => {
      bootstrapPromise = null;
    });
  }
  await bootstrapPromise;

  const [hasJavac, hasApksigner, hasZipalign, hasMingw, hasNsis, hasConvert] =
    await Promise.all([
      cmdExists('javac', ['-version']),
      cmdExists('apksigner', ['--version']),
      fileExists('/usr/bin/zipalign').then((ok) => ok || cmdExists('which', ['zipalign'])),
      cmdExists('x86_64-w64-mingw32-g++', ['--version']),
      cmdExists('makensis', ['-VERSION']),
      cmdExists('convert', ['--version']),
    ]);

  const hasAndroidJar = await fileExists(
    path.join(ANDROID_SDK_DIR, 'platforms', 'android-34', 'android.jar')
  );
  const hasAapt2 = await fileExists(
    path.join(ANDROID_SDK_DIR, 'build-tools', '34.0.0', 'aapt2')
  );
  const hasD8 = await fileExists(
    path.join(ANDROID_SDK_DIR, 'build-tools', '34.0.0', 'd8')
  );
  const hasBundletool = await fileExists(BUNDLETOOL_JAR);
  const hasWebView2 = await fileExists(
    path.join(WEBVIEW2_NATIVE_DIR, 'x64', 'WebView2Loader.dll')
  );

  return {
    androidReady: hasJavac && hasApksigner && hasZipalign && hasAndroidJar && hasAapt2 && hasD8,
    aabReady: hasJavac && hasBundletool && hasAndroidJar && hasAapt2 && hasD8,
    windowsReady: hasMingw && hasNsis && hasConvert && hasWebView2,
  };
}

async function runBootstrap(): Promise<void> {
  const [hasJavac, hasMingw, hasNsis, hasApksigner, hasConvert] = await Promise.all([
    cmdExists('javac', ['-version']),
    cmdExists('x86_64-w64-mingw32-g++', ['--version']),
    cmdExists('makensis', ['-VERSION']),
    cmdExists('apksigner', ['--version']),
    cmdExists('convert', ['--version']),
  ]);

  if (!hasJavac || !hasMingw || !hasNsis || !hasApksigner || !hasConvert) {
    try {
      await execFileAsync(
        'sh',
        [
          '-c',
          'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -o Dpkg::Options::="--force-confold" openjdk-17-jdk-headless mingw-w64 nsis imagemagick apksigner zipalign < /dev/null',
        ],
        { timeout: 180000 }
      );
    } catch (err) {
      console.warn('Auto-instalação de pacotes apt falhou:', err);
    }
  }

  const [hasAndroidJar, hasAapt2, hasD8, hasSdkManager] = await Promise.all([
    fileExists(path.join(ANDROID_SDK_DIR, 'platforms', 'android-34', 'android.jar')),
    fileExists(path.join(ANDROID_SDK_DIR, 'build-tools', '34.0.0', 'aapt2')),
    fileExists(path.join(ANDROID_SDK_DIR, 'build-tools', '34.0.0', 'd8')),
    fileExists(path.join(ANDROID_SDK_DIR, 'cmdline-tools', 'latest', 'bin', 'sdkmanager')),
  ]);
  if (!hasAndroidJar || !hasAapt2 || !hasD8) {
    try {
      const cleanupCmds: string[] = [];
      if (!hasAndroidJar) {
        cleanupCmds.push(`rm -rf "${ANDROID_SDK_DIR}/platforms/android-34"`);
      }
      if (!hasAapt2 || !hasD8) {
        cleanupCmds.push(`rm -rf "${ANDROID_SDK_DIR}/build-tools/34.0.0"*`);
      }
      const cmdToolsInstall = hasSdkManager
        ? ''
        : `mkdir -p "${ANDROID_SDK_DIR}/cmdline-tools" && \
curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/cmdtools.zip && \
unzip -q -o /tmp/cmdtools.zip -d "${ANDROID_SDK_DIR}/cmdline-tools" && \
rm -rf "${ANDROID_SDK_DIR}/cmdline-tools/latest" && \
mv "${ANDROID_SDK_DIR}/cmdline-tools/cmdline-tools" "${ANDROID_SDK_DIR}/cmdline-tools/latest" && \
rm -f /tmp/cmdtools.zip && `;

      const packagesNeeded: string[] = [];
      if (!hasAndroidJar) packagesNeeded.push('"platforms;android-34"');
      if (!hasAapt2 || !hasD8) packagesNeeded.push('"build-tools;34.0.0"');

      await execFileAsync(
        'sh',
        [
          '-c',
          `${cleanupCmds.join(' && ')}${cleanupCmds.length ? ' && ' : ''}${cmdToolsInstall}yes | "${ANDROID_SDK_DIR}/cmdline-tools/latest/bin/sdkmanager" --sdk_root="${ANDROID_SDK_DIR}" --licenses > /dev/null && \
"${ANDROID_SDK_DIR}/cmdline-tools/latest/bin/sdkmanager" --sdk_root="${ANDROID_SDK_DIR}" ${packagesNeeded.join(' ')}`,
        ],
        { timeout: 300000 }
      );
    } catch (err) {
      console.warn('Auto-instalação do Android SDK falhou:', err);
    }
  }

  if (!(await fileExists(BUNDLETOOL_JAR))) {
    try {
      await fs.mkdir(path.dirname(BUNDLETOOL_JAR), { recursive: true });
      await execFileAsync(
        'curl',
        [
          '-fsSL',
          'https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar',
          '-o',
          BUNDLETOOL_JAR,
        ],
        { timeout: 120000 }
      );
    } catch (err) {
      console.warn('Download do bundletool falhou:', err);
    }
  }

  if (!(await fileExists(path.join(WEBVIEW2_NATIVE_DIR, 'x64', 'WebView2Loader.dll')))) {
    try {
      const wvDir = path.join(TOOLCHAINS_DIR, 'webview2');
      await fs.mkdir(wvDir, { recursive: true });
      await execFileAsync(
        'sh',
        [
          '-c',
          `curl -fsSL https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2792.45 -o /tmp/wv2.zip && unzip -q -o /tmp/wv2.zip -d "${wvDir}" && rm -f /tmp/wv2.zip`,
        ],
        { timeout: 120000 }
      );
    } catch (err) {
      console.warn('Download do WebView2 falhou:', err);
    }
  }
}
