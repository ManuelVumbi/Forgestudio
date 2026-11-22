import { execFile } from 'child_process';
import fs from 'fs/promises';
import JSZip from 'jszip';
import path from 'path';
import { promisify } from 'util';
import { AppProject } from '../../src/types/appforge.ts';
import { generateAndroidKeystore, loadDecryptedKeystore } from '../keystoreManager.ts';
import { ANDROID_SDK_DIR, BUNDLETOOL_JAR } from '../toolchainBootstrap.ts';
import { readBundleFilesForPackaging } from '../uploadManager.ts';
import { generateAndroidMipmaps, resolveIconToPng } from './iconHelper.ts';

const execFileAsync = promisify(execFile);

function xmlEsc(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function androidStringResEsc(str: string): string {
  const escaped = (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
  const prefixed = /^[?@]/.test(escaped) ? `\\${escaped}` : escaped;
  return prefixed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toAsciiDname(str: string | undefined, fallback: string): string {
  return (
    (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2013\u2014\u2015]/g, '-')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/[,=+<>;#\\"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64) || fallback
  );
}

function javaStr(str: string): string {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function buildOfflineHtml(project: AppProject): string {
  const msg =
    project.advanced.offlineMessage ||
    'Sem ligação à Internet. Verifique a sua rede e tente novamente.';
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${xmlEsc(project.appName)}</title>
  <style>
    body{font-family:sans-serif;background:#ffffff;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
    .card{max-width:360px;border:1px solid #e2e8f0;border-radius:14px;padding:26px}
    h1{font-size:19px;margin:0 0 8px}
    p{font-size:14px;color:#475569;line-height:1.5;margin:0 0 18px}
    button{background:${project.visual.primaryColor || '#1D4ED8'};color:#fff;border:0;border-radius:8px;padding:11px 18px;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <h1>${xmlEsc(project.appName)}</h1>
    <p>${xmlEsc(msg)}</p>
    <button onclick="window.location.reload()">Tentar novamente</button>
  </div>
</body>
</html>`;
}

function buildMainActivityJava(
  project: AppProject,
  startUrl: string,
  options: { hasOfflineBundle: boolean; hasOfflineCacheFallback: boolean }
): string {
  const authorizedArr = (project.advanced.authorizedDomains || [])
    .map((d) => `"${javaStr(d)}"`)
    .join(', ');
  const menuLabels = (project.visual.menuItems || [])
    .map((m) => `"${javaStr(m.label)}"`)
    .join(', ');
  const menuActions = (project.visual.menuItems || [])
    .map((m) => `"${javaStr(m.action)}"`)
    .join(', ');
  const menuUrls = (project.visual.menuItems || [])
    .map((m) => `"${javaStr(m.url || '')}"`)
    .join(', ');

  const primaryHex = /^#[0-9a-fA-F]{6}$/.test(project.visual.primaryColor)
    ? project.visual.primaryColor
    : '#1D4ED8';
  const secondaryHex = /^#[0-9a-fA-F]{6}$/.test(project.visual.secondaryColor)
    ? project.visual.secondaryColor
    : '#0F172A';

  return `package ${project.packageName};

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQ = 4091;
    private static final String LOCAL_HOST = "app.appforge.local";
    private WebView webView;
    private ProgressBar progressBar;
    private FrameLayout splashOverlay;
    private boolean splashDismissed = false;
    private ValueCallback<Uri[]> fileUploadCallback;
    private final String startUrl = "${javaStr(startUrl)}";
    private final boolean hasOfflineBundle = ${options.hasOfflineBundle ? 'true' : 'false'};
    private final boolean hasOfflineCacheFallback = ${options.hasOfflineCacheFallback ? 'true' : 'false'};
    private final String[] authorizedDomains = new String[] { ${authorizedArr} };
    private final String[] menuLabels = new String[] { ${menuLabels} };
    private final String[] menuActions = new String[] { ${menuActions} };
    private final String[] menuUrls = new String[] { ${menuUrls} };

    private void dismissSplash() {
        if (splashDismissed || splashOverlay == null) return;
        splashDismissed = true;
        splashOverlay.animate().alpha(0f).setDuration(280).withEndAction(new Runnable() {
            @Override public void run() {
                splashOverlay.setVisibility(View.GONE);
            }
        }).start();
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".otf")) return "font/otf";
        return "application/octet-stream";
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        int primaryColor = Color.parseColor("${primaryHex}");
        int secondaryColor = Color.parseColor("${secondaryHex}");
        boolean preferDark = "dark".equals("${project.visual.darkMode}");

        if (Build.VERSION.SDK_INT >= 21 && !"hidden".equals("${project.advanced.statusBarStyle}")) {
            getWindow().setStatusBarColor(
                "dark".equals("${project.advanced.statusBarStyle}") || preferDark
                    ? Color.parseColor("#0F172A")
                    : primaryColor
            );
        }

        if (${project.advanced.fullscreen}) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);

        if (!"hidden".equals("${project.visual.navBarStyle}")) {
            LinearLayout navBar = new LinearLayout(this);
            navBar.setOrientation(LinearLayout.HORIZONTAL);
            navBar.setGravity(Gravity.CENTER_VERTICAL);
            int barBg = "transparent".equals("${project.visual.navBarStyle}")
                ? (preferDark ? Color.parseColor("#0F172A") : Color.WHITE)
                : primaryColor;
            navBar.setBackgroundColor(barBg);
            int pad = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 12, getResources().getDisplayMetrics());
            navBar.setPadding(pad, pad, pad, pad);

            int fgColor = "transparent".equals("${project.visual.navBarStyle}") && !preferDark
                ? Color.parseColor("#0F172A")
                : Color.WHITE;

            Button menuBtn = new Button(this);
            menuBtn.setText("\\u2630");
            menuBtn.setTextColor(fgColor);
            menuBtn.setBackgroundColor(Color.TRANSPARENT);
            menuBtn.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { showNavigationMenu(); }
            });
            navBar.addView(menuBtn);

            TextView titleView = new TextView(this);
            titleView.setText("${javaStr(project.visual.navBarTitle || project.appName)}");
            titleView.setTextColor(fgColor);
            titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            titleView.setTypeface(null, Typeface.BOLD);
            LinearLayout.LayoutParams lpTitle = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lpTitle.leftMargin = pad / 2;
            navBar.addView(titleView, lpTitle);

            root.addView(navBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ));
        }

        FrameLayout contentFrame = new FrameLayout(this);
        webView = new WebView(this);
        contentFrame.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, 8
        );
        pbParams.gravity = Gravity.TOP;
        contentFrame.addView(progressBar, pbParams);

        // Native Branded Splash Overlay with Custom Splash Image & App Logo
        splashOverlay = new FrameLayout(this);
        splashOverlay.setBackgroundColor(preferDark ? secondaryColor : primaryColor);

        ImageView splashBg = new ImageView(this);
        splashBg.setScaleType(ImageView.ScaleType.CENTER_CROP);
        splashBg.setImageResource(R.drawable.app_splash_screen);
        splashOverlay.addView(splashBg, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ));

        View splashScrim = new View(this);
        int scrimBase = preferDark ? secondaryColor : primaryColor;
        splashScrim.setBackgroundColor(Color.argb(135, Color.red(scrimBase), Color.green(scrimBase), Color.blue(scrimBase)));
        splashOverlay.addView(splashScrim, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ));

        LinearLayout splashCenter = new LinearLayout(this);
        splashCenter.setOrientation(LinearLayout.VERTICAL);
        splashCenter.setGravity(Gravity.CENTER);
        int spPad = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 32, getResources().getDisplayMetrics());
        splashCenter.setPadding(spPad, spPad, spPad, spPad);

        ImageView logoView = new ImageView(this);
        logoView.setImageResource(R.drawable.app_splash_logo);
        int logoPx = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 108, getResources().getDisplayMetrics());
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(logoPx, logoPx);
        logoLp.bottomMargin = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 18, getResources().getDisplayMetrics());
        splashCenter.addView(logoView, logoLp);

        TextView splashTitle = new TextView(this);
        splashTitle.setText("${javaStr(project.appName)}");
        splashTitle.setTextColor(Color.WHITE);
        splashTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        splashTitle.setTypeface(null, Typeface.BOLD);
        splashTitle.setGravity(Gravity.CENTER);
        splashCenter.addView(splashTitle);

        ProgressBar splashSpinner = new ProgressBar(this);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        );
        spLp.topMargin = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20, getResources().getDisplayMetrics());
        splashCenter.addView(splashSpinner, spLp);

        splashOverlay.addView(splashCenter, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ));

        contentFrame.addView(splashOverlay, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ));

        root.addView(contentFrame, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ));
        setContentView(root);

        // Failsafe dismissal of splash overlay after 4.5s
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() { dismissSplash(); }
        }, 4500L);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(${project.advanced.enableJavaScript});
        settings.setDomStorageEnabled(${project.advanced.enableCache} || hasOfflineBundle);
        settings.setAllowFileAccess(true);
        settings.setSupportZoom(${project.advanced.enableZoom});
        settings.setBuiltInZoomControls(${project.advanced.enableZoom});
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(${project.advanced.enableCache ? 'WebSettings.LOAD_DEFAULT' : 'WebSettings.LOAD_NO_CACHE'});
        ${project.advanced.userAgent ? `settings.setUserAgentString("${javaStr(project.advanced.userAgent)}");` : ''}

        if (preferDark) {
            if (Build.VERSION.SDK_INT >= 33) {
                settings.setAlgorithmicDarkeningAllowed(true);
            } else if (Build.VERSION.SDK_INT >= 29) {
                settings.setForceDark(WebSettings.FORCE_DARK_ON);
            }
        }

        CookieManager.getInstance().setAcceptCookie(${project.advanced.enableCookies});
        if (Build.VERSION.SDK_INT >= 21) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, ${project.advanced.enableCookies});
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!hasOfflineBundle || request == null || request.getUrl() == null) {
                    return super.shouldInterceptRequest(view, request);
                }
                Uri uri = request.getUrl();
                if (!LOCAL_HOST.equals(uri.getHost())) {
                    return super.shouldInterceptRequest(view, request);
                }
                String reqPath = uri.getPath();
                if (reqPath == null || reqPath.isEmpty() || "/".equals(reqPath)) {
                    reqPath = "/index.html";
                }
                String rel = reqPath.startsWith("/") ? reqPath.substring(1) : reqPath;
                if (rel.contains("..")) return null;
                String assetPath = "web/" + rel;
                try {
                    InputStream is = getAssets().open(assetPath);
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    return new WebResourceResponse(guessMimeType(rel), "UTF-8", 200, "OK", headers, is);
                } catch (Exception e) {
                    if (!rel.contains(".")) {
                        try {
                            InputStream spa = getAssets().open("web/index.html");
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Access-Control-Allow-Origin", "*");
                            return new WebResourceResponse("text/html", "UTF-8", 200, "OK", headers, spa);
                        } catch (Exception ignored) {}
                    }
                    return null;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                if ("file".equals(uri.getScheme()) || LOCAL_HOST.equals(uri.getHost())) return false;
                String host = uri.getHost() != null ? uri.getHost() : "";
                boolean allowed = authorizedDomains.length == 0;
                for (String d : authorizedDomains) {
                    if (host.endsWith(d)) { allowed = true; break; }
                }
                if ("system_browser".equals("${project.advanced.externalLinks}") && !allowed) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                if ("block".equals("${project.advanced.externalLinks}") && !allowed) {
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                dismissSplash();
                super.onPageFinished(view, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    String failing = request.getUrl() != null ? request.getUrl().toString() : "";
                    if (hasOfflineCacheFallback && !failing.contains(LOCAL_HOST)) {
                        view.loadUrl("https://" + LOCAL_HOST + "/index.html");
                    } else if (!"disabled".equals("${project.advanced.offlineMode}") && !failing.startsWith("file:///android_asset/")) {
                        view.loadUrl("file:///android_asset/offline.html");
                    }
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                    dismissSplash();
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (!${project.advanced.enableFileUpload}) return false;
                if (fileUploadCallback != null) fileUploadCallback.onReceiveValue(null);
                fileUploadCallback = filePathCallback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQ);
                    return true;
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
            }
        });

        if (${project.advanced.enableDownloads}) {
            webView.setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                    try {
                        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                        req.setMimeType(mimetype);
                        req.addRequestHeader("User-Agent", userAgent);
                        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                        req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm != null) dm.enqueue(req);
                        Toast.makeText(MainActivity.this, "A descarregar " + fileName, Toast.LENGTH_SHORT).show();
                    } catch (Exception ex) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    }
                }
            });
        }

        if (${project.advanced.autoRefresh}) {
            final Handler handler = new Handler(Looper.getMainLooper());
            final long interval = ${(project.advanced.autoRefreshIntervalSec || 60) * 1000}L;
            handler.postDelayed(new Runnable() {
                @Override public void run() {
                    webView.reload();
                    handler.postDelayed(this, interval);
                }
            }, interval);
        }

        webView.loadUrl(startUrl);
    }

    private void showNavigationMenu() {
        if (menuLabels.length == 0) {
            webView.reload();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("${javaStr(project.appName)}")
            .setItems(menuLabels, new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface dialog, int which) {
                    String act = menuActions[which];
                    if ("reload".equals(act)) webView.reload();
                    else if ("home".equals(act)) webView.loadUrl(startUrl);
                    else if ("share".equals(act)) {
                        Intent s = new Intent(Intent.ACTION_SEND);
                        s.setType("text/plain");
                        s.putExtra(Intent.EXTRA_TEXT, webView.getUrl() != null ? webView.getUrl() : startUrl);
                        startActivity(Intent.createChooser(s, "Partilhar"));
                    } else if ("url".equals(act) && menuUrls[which].length() > 0) {
                        webView.loadUrl(menuUrls[which]);
                    } else if ("exit".equals(act)) {
                        finish();
                    }
                }
            })
            .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQ && fileUploadCallback != null) {
            Uri[] res = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileUploadCallback.onReceiveValue(res);
            fileUploadCallback = null;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        String mode = "${project.advanced.backButtonBehavior}";
        if ("exit".equals(mode)) {
            finish();
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if ("confirm_exit".equals(mode)) {
            new AlertDialog.Builder(this)
                .setTitle("${javaStr(project.appName)}")
                .setMessage("Deseja sair da aplicação?")
                .setPositiveButton("Sair", new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface d, int w) { finish(); }
                })
                .setNegativeButton("Cancelar", null)
                .show();
        } else {
            super.onBackPressed();
        }
    }
}
`;
}

async function isValidPkcs12Keystore(ksPath: string, password: string): Promise<boolean> {
  try {
    await execFileAsync(
      'keytool',
      ['-list', '-keystore', ksPath, '-storetype', 'PKCS12', '-storepass', password],
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function getOrCreateSigningKey(
  project: AppProject,
  isDebug: boolean,
  workDir: string
): Promise<{ ksPath: string; password: string; alias: string }> {
  if (!isDebug && project.signing.keystoreId) {
    const ks = await loadDecryptedKeystore(project.ownerId, project.signing.keystoreId);
    if (ks) {
      const ksPath = path.join(workDir, 'release-signing.p12');
      await fs.writeFile(ksPath, ks.buffer);
      if (await isValidPkcs12Keystore(ksPath, ks.password)) {
        return { ksPath, password: ks.password, alias: ks.metadata.alias };
      }
      if (ks.metadata.mode === 'custom_uploaded') {
        throw new Error('A keystore personalizada carregada não pôde ser aberta ou a palavra-passe PKCS#12 é inválida.');
      }
      // Legacy auto_managed keystore generated with non-ASCII attributes: regenerate cleanly below
    }
  }

  // Generate or reuse a real PKCS#12 keystore for signing
  const alias = isDebug ? 'androiddebugkey' : project.signing.keystoreAlias || 'appforge_release';
  const rawPassword = isDebug ? 'android' : `af_${project.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || 'rel'}_2026`;
  const password = rawPassword;
  const ksPath = path.join(workDir, isDebug ? 'debug.p12' : 'auto-release.p12');

  if (!isDebug) {
    const meta = await generateAndroidKeystore({
      ownerId: project.ownerId,
      alias,
      password,
      commonName: project.appName,
      organization: project.author || 'AppForge Studio',
      country: 'PT',
    });
    const loaded = await loadDecryptedKeystore(project.ownerId, meta.keystoreId);
    if (loaded) {
      await fs.writeFile(ksPath, loaded.buffer);
      if (await isValidPkcs12Keystore(ksPath, loaded.password)) {
        return { ksPath, password: loaded.password, alias: loaded.metadata.alias };
      }
    }
  }

  await fs.rm(ksPath, { force: true }).catch(() => {});
  const safeCn = toAsciiDname(project.appName, 'AppForge App');
  await execFileAsync(
    'keytool',
    [
      '-genkeypair',
      '-keystore',
      ksPath,
      '-storetype',
      'PKCS12',
      '-storepass',
      password,
      '-alias',
      alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-dname',
      `CN=${safeCn},O=AppForge Studio,C=PT`,
    ],
    { timeout: 15000 }
  );
  return { ksPath, password, alias };
}

async function collectFilesRecursively(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      result.push(...(await collectFilesRecursively(full)));
    } else {
      result.push(full);
    }
  }
  return result;
}

export async function compileAndroidBinaries(
  project: AppProject,
  workDir: string,
  targets: { debugApk: boolean; releaseApk: boolean; aab: boolean },
  onLog: (msg: string) => void
): Promise<{
  debugApk?: Buffer;
  releaseApk?: Buffer;
  aab?: Buffer;
  errors?: Partial<Record<'debugApk' | 'releaseApk' | 'aab', string>>;
}> {
  const androidBuildDir = path.join(workDir, 'android_build');
  const resDir = path.join(androidBuildDir, 'res');
  const assetsDir = path.join(androidBuildDir, 'assets');
  const genDir = path.join(androidBuildDir, 'gen');
  const classesDir = path.join(androidBuildDir, 'classes');
  const dexDir = path.join(androidBuildDir, 'dex');
  const pkgPath = project.packageName.replace(/\./g, '/');
  const srcPkgDir = path.join(androidBuildDir, 'src', pkgPath);

  await Promise.all([
    fs.mkdir(path.join(resDir, 'values'), { recursive: true }),
    fs.mkdir(assetsDir, { recursive: true }),
    fs.mkdir(genDir, { recursive: true }),
    fs.mkdir(classesDir, { recursive: true }),
    fs.mkdir(dexDir, { recursive: true }),
    fs.mkdir(srcPkgDir, { recursive: true }),
  ]);

  const iconPng = path.join(androidBuildDir, 'icon_512.png');
  await resolveIconToPng(
    project.visual.iconUrl,
    project.visual.primaryColor,
    project.appName,
    iconPng
  );
  await generateAndroidMipmaps(
    iconPng,
    resDir,
    project.visual.primaryColor,
    project.visual.splashUrl,
    project.visual.secondaryColor
  );

  await fs.writeFile(
    path.join(resDir, 'values', 'strings.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="app_name">${androidStringResEsc(project.appName)}</string>\n</resources>\n`,
    'utf8'
  );

  const permissionsXml = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  ];
  if (project.advanced.permissions.camera) {
    permissionsXml.push('<uses-permission android:name="android.permission.CAMERA" />');
  }
  if (project.advanced.permissions.microphone) {
    permissionsXml.push('<uses-permission android:name="android.permission.RECORD_AUDIO" />');
  }
  if (project.advanced.permissions.location) {
    permissionsXml.push('<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />');
  }
  if (project.advanced.permissions.storage) {
    permissionsXml.push('<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />');
  }
  if (project.advanced.permissions.notifications || project.advanced.enablePushNotifications) {
    permissionsXml.push('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
  }

  const orientationAttr =
    project.visual.orientation === 'portrait'
      ? 'android:screenOrientation="portrait"'
      : project.visual.orientation === 'landscape'
      ? 'android:screenOrientation="landscape"'
      : 'android:screenOrientation="unspecified"';

  const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${project.packageName}"
    android:versionCode="${Math.max(1, Math.floor(project.versionCode || 1))}"
    android:versionName="${xmlEsc(project.versionName || '1.0.0')}">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
  ${permissionsXml.join('\n  ')}
  <application
      android:allowBackup="true"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher_round"
      android:label="@string/app_name"
      android:usesCleartextTraffic="true">
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
`;
  const manifestPath = path.join(androidBuildDir, 'AndroidManifest.xml');
  await fs.writeFile(manifestPath, manifestXml, 'utf8');

  await fs.writeFile(path.join(assetsDir, 'offline.html'), buildOfflineHtml(project), 'utf8');

  const hasBundle = Boolean(project.sourceBundleId);
  const isOfflineOnly =
    hasBundle &&
    (project.conversionType !== 'url' || project.advanced.offlineMode === 'offline_app');
  const hasOfflineCacheFallback =
    hasBundle &&
    project.conversionType === 'url' &&
    project.advanced.offlineMode === 'cache_first';

  if (hasBundle && project.sourceBundleId) {
    const bundleFiles = await readBundleFilesForPackaging(project.ownerId, project.sourceBundleId);
    onLog(`A empacotar ${bundleFiles.length} ficheiro(s) web no APK/AAB para funcionamento offline...`);
    for (const bf of bundleFiles) {
      const dest = path.join(assetsDir, 'web', bf.relativePath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bf.content);
    }
  }

  const startUrl = isOfflineOnly
    ? 'https://app.appforge.local/index.html'
    : project.sourceUrl || 'https://example.com';

  await fs.writeFile(
    path.join(srcPkgDir, 'MainActivity.java'),
    buildMainActivityJava(project, startUrl, {
      hasOfflineBundle: hasBundle,
      hasOfflineCacheFallback,
    }),
    'utf8'
  );

  const aapt2 = path.join(ANDROID_SDK_DIR, 'build-tools', '34.0.0', 'aapt2');
  const d8 = path.join(ANDROID_SDK_DIR, 'build-tools', '34.0.0', 'd8');
  const androidJar = path.join(ANDROID_SDK_DIR, 'platforms', 'android-34', 'android.jar');

  onLog('A compilar recursos Android (aapt2 compile)...');
  const compiledResZip = path.join(androidBuildDir, 'compiled_res.zip');
  await execFileAsync(aapt2, ['compile', '--dir', resDir, '-o', compiledResZip], {
    timeout: 30000,
  });

  const unalignedApk = path.join(androidBuildDir, 'unaligned.apk');
  onLog('A ligar AndroidManifest e assets (aapt2 link)...');
  await execFileAsync(
    aapt2,
    [
      'link',
      '-o',
      unalignedApk,
      '-I',
      androidJar,
      '--manifest',
      manifestPath,
      '--java',
      genDir,
      '--min-sdk-version',
      '24',
      '--target-sdk-version',
      '34',
      '--version-code',
      String(Math.max(1, Math.floor(project.versionCode || 1))),
      '--version-name',
      project.versionName || '1.0.0',
      '-A',
      assetsDir,
      compiledResZip,
    ],
    { timeout: 30000 }
  );

  onLog('A compilar código Java nativo Android (javac)...');
  const rJavaPath = path.join(genDir, pkgPath, 'R.java');
  const mainJavaPath = path.join(srcPkgDir, 'MainActivity.java');
  await execFileAsync(
    'javac',
    ['-source', '1.8', '-target', '1.8', '-classpath', androidJar, '-d', classesDir, rJavaPath, mainJavaPath],
    { timeout: 30000 }
  );

  onLog('A gerar bytecode Dalvik DEX (d8)...');
  const classFiles = (await collectFilesRecursively(classesDir)).filter((f) => f.endsWith('.class'));
  await execFileAsync(
    d8,
    ['--lib', androidJar, '--min-api', '24', '--output', dexDir, ...classFiles],
    { timeout: 30000 }
  );

  // Inject classes.dex into unaligned.apk while keeping resources.arsc untouched & uncompressed
  const dexPath = path.join(dexDir, 'classes.dex');
  await execFileAsync(
    'python3',
    [
      '-c',
      `import zipfile; z=zipfile.ZipFile(${JSON.stringify(unalignedApk)},'a'); z.write(${JSON.stringify(dexPath)},'classes.dex'); z.close()`,
    ],
    { timeout: 15000 }
  );

  const alignedApk = path.join(androidBuildDir, 'aligned.apk');
  await execFileAsync('zipalign', ['-p', '-f', '4', unalignedApk, alignedApk], {
    timeout: 15000,
  });

  const out: {
    debugApk?: Buffer;
    releaseApk?: Buffer;
    aab?: Buffer;
    errors?: Partial<Record<'debugApk' | 'releaseApk' | 'aab', string>>;
  } = {};
  const errors: Partial<Record<'debugApk' | 'releaseApk' | 'aab', string>> = {};

  if (targets.debugApk) {
    try {
      onLog('A assinar Android APK Debug (apksigner)...');
      const dbgKey = await getOrCreateSigningKey(project, true, androidBuildDir);
      const dbgApkPath = path.join(androidBuildDir, 'app-debug.apk');
      await execFileAsync(
        'apksigner',
        [
          'sign',
          '--ks',
          dbgKey.ksPath,
          '--ks-pass',
          `pass:${dbgKey.password}`,
          '--ks-key-alias',
          dbgKey.alias,
          '--out',
          dbgApkPath,
          alignedApk,
        ],
        { timeout: 20000 }
      );
      await execFileAsync('apksigner', ['verify', dbgApkPath], { timeout: 10000 });
      out.debugApk = await fs.readFile(dbgApkPath);
    } catch (err: any) {
      const msg = err?.stderr || err?.message || 'Erro ao assinar APK Debug';
      errors.debugApk = String(msg).slice(0, 300);
      onLog(`Erro APK Debug: ${errors.debugApk}`);
    }
  }

  let releaseKey: { ksPath: string; password: string; alias: string } | null = null;
  if (targets.releaseApk || targets.aab) {
    try {
      releaseKey = await getOrCreateSigningKey(project, false, androidBuildDir);
    } catch (err: any) {
      const msg = String(err?.stderr || err?.message || 'Erro na keystore de Release').slice(0, 300);
      if (targets.releaseApk) errors.releaseApk = msg;
      if (targets.aab) errors.aab = msg;
      onLog(`Erro na preparação da assinatura Release: ${msg}`);
    }
  }

  if (targets.releaseApk && releaseKey) {
    try {
      onLog('A assinar Android APK Release (apksigner)...');
      const relApkPath = path.join(androidBuildDir, 'app-release.apk');
      await execFileAsync(
        'apksigner',
        [
          'sign',
          '--ks',
          releaseKey.ksPath,
          '--ks-pass',
          `pass:${releaseKey.password}`,
          '--ks-key-alias',
          releaseKey.alias,
          '--out',
          relApkPath,
          alignedApk,
        ],
        { timeout: 20000 }
      );
      await execFileAsync('apksigner', ['verify', relApkPath], { timeout: 10000 });
      out.releaseApk = await fs.readFile(relApkPath);
    } catch (err: any) {
      const msg = err?.stderr || err?.message || 'Erro ao assinar APK Release';
      errors.releaseApk = String(msg).slice(0, 300);
      onLog(`Erro APK Release: ${errors.releaseApk}`);
    }
  }

  if (targets.aab && releaseKey) {
    try {
      onLog('A empacotar Android App Bundle (AAB) para Google Play...');
      const protoApk = path.join(androidBuildDir, 'base_proto.apk');
      await execFileAsync(
        aapt2,
        [
          'link',
          '--proto-format',
          '-o',
          protoApk,
          '-I',
          androidJar,
          '--manifest',
          manifestPath,
          '--min-sdk-version',
          '24',
          '--target-sdk-version',
          '34',
          '--version-code',
          String(Math.max(1, Math.floor(project.versionCode || 1))),
          '--version-name',
          project.versionName || '1.0.0',
          '-A',
          assetsDir,
          compiledResZip,
        ],
        { timeout: 30000 }
      );

      const protoZip = await JSZip.loadAsync(await fs.readFile(protoApk));
      const baseZip = new JSZip();
      for (const [entryName, entry] of Object.entries(protoZip.files)) {
        if (entry.dir) continue;
        const buf = await entry.async('nodebuffer');
        if (entryName === 'AndroidManifest.xml') {
          baseZip.file('manifest/AndroidManifest.xml', buf);
        } else {
          baseZip.file(entryName, buf);
        }
      }
      baseZip.file('dex/classes.dex', await fs.readFile(dexPath));

      const baseZipPath = path.join(androidBuildDir, 'base.zip');
      await fs.writeFile(baseZipPath, await baseZip.generateAsync({ type: 'nodebuffer' }));

      const aabPath = path.join(androidBuildDir, 'app-release.aab');
      await execFileAsync(
        'java',
        ['-jar', BUNDLETOOL_JAR, 'build-bundle', `--modules=${baseZipPath}`, `--output=${aabPath}`],
        { timeout: 30000 }
      );

      await execFileAsync(
        'jarsigner',
        [
          '-keystore',
          releaseKey.ksPath,
          '-storetype',
          'PKCS12',
          '-storepass',
          releaseKey.password,
          aabPath,
          releaseKey.alias,
        ],
        { timeout: 20000 }
      );
      await execFileAsync('java', ['-jar', BUNDLETOOL_JAR, 'validate', `--bundle=${aabPath}`], {
        timeout: 20000,
      });
      out.aab = await fs.readFile(aabPath);
    } catch (err: any) {
      const msg = err?.stderr || err?.message || 'Erro ao gerar AAB';
      errors.aab = String(msg).slice(0, 300);
      onLog(`Erro AAB: ${errors.aab}`);
    }
  }

  if (Object.keys(errors).length > 0) {
    out.errors = errors;
  }
  return out;
}
