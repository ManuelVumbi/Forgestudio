import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { AppProject } from '../../src/types/appforge.ts';
import { loadDecryptedKeystore } from '../keystoreManager.ts';
import { readBundleFilesForPackaging } from '../uploadManager.ts';
import { generateAndroidMipmaps, resolveIconToPng } from './iconHelper.ts';

function xmlEscape(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildOfflineHtml(project: AppProject): string {
  const msg = project.advanced.offlineMessage || 'Sem ligação à Internet. Verifique a sua rede e tente novamente.';
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${xmlEscape(project.appName)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ffffff;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
    .card{max-width:380px;border:1px solid #e2e8f0;border-radius:16px;padding:28px}
    h1{font-size:20px;margin:0 0 8px}
    p{font-size:14px;color:#475569;line-height:1.5;margin:0 0 20px}
    button{background:${project.visual.primaryColor || '#1D4ED8'};color:#fff;border:0;border-radius:10px;padding:12px 20px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <h1>${xmlEscape(project.appName)}</h1>
    <p>${xmlEscape(msg)}</p>
    <button onclick="window.location.reload()">Tentar novamente</button>
  </div>
</body>
</html>`;
}

export async function generateAndroidProjectZip(
  project: AppProject,
  options: { includeKeystoreInBuild?: boolean } = {}
): Promise<Buffer> {
  const zip = new JSZip();
  const pkgPath = project.packageName.replace(/\./g, '/');
  const hasBundle = Boolean(project.sourceBundleId);
  const isOfflineBundle =
    hasBundle &&
    (project.conversionType !== 'url' || project.advanced.offlineMode === 'offline_app');
  const startUrl = isOfflineBundle
    ? 'file:///android_asset/web/index.html'
    : project.sourceUrl || 'https://example.com';

  zip.file(
    'settings.gradle.kts',
    `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "${project.appName.replace(/"/g, '')}"
include(":app")
`
  );

  zip.file(
    'gradle.properties',
    `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`
  );

  const fcmPlugin = project.advanced.enablePushNotifications
    ? `    // Descomente após adicionar google-services.json em app/
    // id("com.google.gms.google-services") version "4.4.2" apply false`
    : '';

  zip.file(
    'build.gradle.kts',
    `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
${fcmPlugin}
}
`
  );

  let signingBlock = '';
  if (project.signing.keystoreId && options.includeKeystoreInBuild) {
    const ks = await loadDecryptedKeystore(project.ownerId, project.signing.keystoreId);
    if (ks) {
      zip.file(`app/keystore/${ks.metadata.fileName}`, ks.buffer);
      zip.file(
        'keystore.properties',
        `storeFile=keystore/${ks.metadata.fileName}
storePassword=${ks.password}
keyAlias=${ks.metadata.alias}
keyPassword=${ks.password}
`
      );
      signingBlock = `
    signingConfigs {
        create("release") {
            val props = java.util.Properties()
            val propFile = rootProject.file("keystore.properties")
            if (propFile.exists()) {
                props.load(propFile.inputStream())
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }`;
    }
  }

  zip.file(
    'app/build.gradle.kts',
    `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "${project.packageName}"
    compileSdk = 34

    defaultConfig {
        applicationId = "${project.packageName}"
        minSdk = 24
        targetSdk = 34
        versionCode = ${Math.max(1, Math.floor(project.versionCode || 1))}
        versionName = "${project.versionName || '1.0.0'}"
    }
${signingBlock}
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            ${signingBlock ? 'signingConfig = signingConfigs.getByName("release")' : ''}
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
${project.advanced.enablePushNotifications ? '    implementation("com.google.firebase:firebase-messaging-ktx:24.0.1")' : ''}
}
`
  );

  zip.file(
    'app/proguard-rules.pro',
    `-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
`
  );

  const permissionsXml: string[] = ['    <uses-permission android:name="android.permission.INTERNET" />', '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'];
  if (project.advanced.permissions.camera) permissionsXml.push('    <uses-permission android:name="android.permission.CAMERA" />');
  if (project.advanced.permissions.microphone) permissionsXml.push('    <uses-permission android:name="android.permission.RECORD_AUDIO" />');
  if (project.advanced.permissions.location) {
    permissionsXml.push('    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />');
    permissionsXml.push('    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />');
  }
  if (project.advanced.permissions.storage) permissionsXml.push('    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />');
  if (project.advanced.permissions.notifications || project.advanced.enablePushNotifications) {
    permissionsXml.push('    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
  }

  const orientationAttr =
    project.visual.orientation === 'portrait'
      ? 'android:screenOrientation="portrait"'
      : project.visual.orientation === 'landscape'
      ? 'android:screenOrientation="landscape"'
      : 'android:screenOrientation="unspecified"';

  zip.file(
    'app/src/main/AndroidManifest.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${permissionsXml.join('\n')}

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:usesCleartextTraffic="true"
        android:theme="@style/Theme.AppForge">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            ${orientationAttr}
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`
  );

  zip.file(
    'app/src/main/res/values/strings.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${xmlEscape(project.appName)}</string>
</resources>
`
  );

  zip.file(
    'app/src/main/res/values/colors.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">${project.visual.primaryColor || '#1D4ED8'}</color>
    <color name="colorSecondary">${project.visual.secondaryColor || '#0F172A'}</color>
    <color name="ic_launcher_background">${project.visual.primaryColor || '#1D4ED8'}</color>
</resources>
`
  );

  zip.file(
    'app/src/main/res/values/themes.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.AppForge" parent="Theme.Material3.DayNight.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorSecondary">@color/colorSecondary</item>
        <item name="android:statusBarColor">@color/colorPrimary</item>
    </style>
</resources>
`
  );

  const authorizedDomainsKotlin = JSON.stringify(project.advanced.authorizedDomains || []);

  const mainActivitySource: string = `package ${project.packageName}

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsetsController
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private val authorizedDomains = listOf(${(project.advanced.authorizedDomains || []).map((d) => `"${d.replace(/"/g, '')}"`).join(', ')})
    private val startUrl = "${startUrl.replace(/"/g, '')}"

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val results = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        fileUploadCallback?.onReceiveValue(results)
        fileUploadCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        swipeRefresh = SwipeRefreshLayout(this)
        webView = WebView(this)
        swipeRefresh.addView(webView)
        setContentView(swipeRefresh)

        if (${project.advanced.fullscreen}) {
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }

        val settings = webView.settings
        settings.javaScriptEnabled = ${project.advanced.enableJavaScript}
        settings.domStorageEnabled = ${project.advanced.enableCache}
        settings.allowFileAccess = true
        settings.setSupportZoom(${project.advanced.enableZoom})
        settings.builtInZoomControls = ${project.advanced.enableZoom}
        settings.displayZoomControls = false
        settings.cacheMode = ${project.advanced.enableCache ? 'WebSettings.LOAD_DEFAULT' : 'WebSettings.LOAD_NO_CACHE'}
        ${project.advanced.userAgent ? `settings.userAgentString = "${project.advanced.userAgent.replace(/"/g, '')}"` : ''}

        CookieManager.getInstance().setAcceptCookie(${project.advanced.enableCookies})
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, ${project.advanced.enableCookies})

        if (${project.visual.darkMode === 'dark'} && WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val targetUri = request?.url ?: return false
                val host = targetUri.host ?: return false
                if (targetUri.scheme == "file") return false
                val isAuthorized = authorizedDomains.isEmpty() || authorizedDomains.any { host.endsWith(it) }
                return when ("${project.advanced.externalLinks}") {
                    "system_browser" -> {
                        if (!isAuthorized) {
                            startActivity(Intent(Intent.ACTION_VIEW, targetUri))
                            true
                        } else false
                    }
                    "block" -> !isAuthorized
                    else -> false
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true && "${project.advanced.offlineMode}" != "disabled") {
                    view?.loadUrl("file:///android_asset/offline.html")
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                if (!${project.advanced.enableFileUpload}) return false
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                val intent = fileChooserParams?.createIntent() ?: return false
                fileChooserLauncher.launch(intent)
                return true
            }
        }

        if (${project.advanced.enableDownloads}) {
            webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
                val request = DownloadManager.Request(Uri.parse(url))
                request.setMimeType(mimetype)
                request.addRequestHeader("User-Agent", userAgent)
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "A descarregar $filename", Toast.LENGTH_SHORT).show()
            }
        }

        swipeRefresh.setOnRefreshListener {
            webView.reload()
            swipeRefresh.isRefreshing = false
        }

        if (${project.advanced.autoRefresh}) {
            val handler = Handler(Looper.getMainLooper())
            val intervalMs = ${(project.advanced.autoRefreshIntervalSec || 60) * 1000}L
            handler.postDelayed(object : Runnable {
                override fun run() {
                    webView.reload()
                    handler.postDelayed(this, intervalMs)
                }
            }, intervalMs)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when ("${project.advanced.backButtonBehavior}") {
                    "history" -> if (webView.canGoBack()) webView.goBack() else finish()
                    "confirm_exit" -> {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            AlertDialog.Builder(this@MainActivity)
                                .setTitle("${xmlEscape(project.appName)}")
                                .setMessage("Deseja sair da aplicação?")
                                .setPositiveButton("Sair") { _, _ -> finish() }
                                .setNegativeButton("Cancelar", null)
                                .show()
                        }
                    }
                    else -> finish()
                }
            }
        })

        webView.loadUrl(startUrl)
    }
}
`;
  zip.file(`app/src/main/java/${pkgPath}/MainActivity.kt`, mainActivitySource);

  zip.file('app/src/main/assets/offline.html', buildOfflineHtml(project));

  if (hasBundle && project.sourceBundleId) {
    const bundleFiles = await readBundleFilesForPackaging(project.ownerId, project.sourceBundleId);
    for (const bf of bundleFiles) {
      zip.file(`app/src/main/assets/web/${bf.relativePath}`, bf.content);
    }
  }

  // Embed real Visual & Icon resources into exported Android Studio project
  const tmpResWork = await fs.mkdtemp(path.join(os.tmpdir(), 'af-android-src-'));
  try {
    const iconPng = path.join(tmpResWork, 'icon_512.png');
    const resTempDir = path.join(tmpResWork, 'res');
    await fs.mkdir(resTempDir, { recursive: true });
    await resolveIconToPng(project.visual.iconUrl, project.visual.primaryColor, project.appName, iconPng);
    await generateAndroidMipmaps(
      iconPng,
      resTempDir,
      project.visual.primaryColor,
      project.visual.splashUrl,
      project.visual.secondaryColor
    );

    const addDirToZip = async (dirPath: string, zipPrefix: string) => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        const rel = `${zipPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await addDirToZip(full, rel);
        } else if (rel !== 'app/src/main/res/values/colors.xml') {
          zip.file(rel, await fs.readFile(full));
        }
      }
    };
    await addDirToZip(resTempDir, 'app/src/main/res');
  } catch (err) {
    console.warn('Falha ao empacotar ícones no ZIP Android:', err);
  } finally {
    await fs.rm(tmpResWork, { recursive: true, force: true }).catch(() => {});
  }

  zip.file(
    'Dockerfile.android-worker',
    `FROM eclipse-temurin:17-jdk-jammy
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
RUN apt-get update && apt-get install -y wget unzip && \\
    mkdir -p $ANDROID_HOME/cmdline-tools && \\
    wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/tools.zip && \\
    unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools && \\
    mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && \\
    yes | sdkmanager --licenses && \\
    sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
WORKDIR /workspace
COPY . .
RUN chmod +x gradlew || true
`
  );

  zip.file(
    'BUILD_INSTRUCTIONS.md',
    `# ${project.appName} — Projecto Android Gradle / Kotlin

- Pacote: \`${project.packageName}\`
- Versão: \`${project.versionName}\` (${project.versionCode})
- Domínios autorizados: \`${authorizedDomainsKotlin}\`

## Compilar localmente
1. Abra a pasta no Android Studio Hedgehog+ ou execute num ambiente com JDK 17 + Android SDK 34:
   \`\`\`bash
   gradle assembleDebug
   gradle assembleRelease
   gradle bundleRelease
   \`\`\`
2. Os ficheiros compilados serão gerados em:
   - \`app/build/outputs/apk/debug/app-debug.apk\`
   - \`app/build/outputs/apk/release/app-release.apk\`
   - \`app/build/outputs/bundle/release/app-release.aab\`
`
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
