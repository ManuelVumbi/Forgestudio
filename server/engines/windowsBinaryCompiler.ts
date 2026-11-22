import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { AppProject } from '../../src/types/appforge.ts';
import { WEBVIEW2_NATIVE_DIR } from '../toolchainBootstrap.ts';
import { readBundleFilesForPackaging } from '../uploadManager.ts';
import { generateNsisModernBitmaps, generateWindowsIco, resolveIconToPng, resolveSplashToBmp } from './iconHelper.ts';

const execFileAsync = promisify(execFile);

function cStr(str: string): string {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function nsisStr(str: string): string {
  return (str || '')
    .replace(/"/g, "'")
    .replace(/\$/g, '$$$$')
    .replace(/\r?\n/g, ' ');
}

function sanitizeWinName(name: string): string {
  const cleaned = (name || 'AppForgeApp').replace(/[<>:"/\\|?*]+/g, '').trim();
  return cleaned || 'AppForgeApp';
}

function sanitizeWinFileName(name: string): string {
  const ascii = (name || 'AppForgeApp')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return ascii || 'AppForgeApp';
}

function legacySanitizeWinFileName(name: string): string {
  const cleaned = (name || 'AppForgeApp')
    .replace(/[<>:"/\\|?*$]+/g, '')
    .trim();
  return cleaned || 'AppForgeApp';
}

function hexToWinRgbExpr(hex: string | undefined, fallback: string): string {
  const clean = hex && /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim() : fallback;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `RGB(${r}, ${g}, ${b})`;
}

function buildOfflineHtml(project: AppProject): string {
  const msg =
    project.advanced.offlineMessage ||
    'Sem ligação à Internet. Verifique a sua rede e tente novamente.';
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(project.appName)}</title>
  <style>
    body{font-family:'Segoe UI',sans-serif;background:#ffffff;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
    .card{max-width:420px;border:1px solid #e2e8f0;border-radius:14px;padding:32px;box-shadow:0 8px 24px rgba(15,23,42,.06)}
    h1{font-size:20px;margin:0 0 10px}
    p{font-size:14px;color:#475569;line-height:1.6;margin:0 0 22px}
    button{background:${project.visual.primaryColor || '#1D4ED8'};color:#fff;border:0;border-radius:8px;padding:11px 22px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <h1>${esc(project.appName)}</h1>
    <p>${esc(msg)}</p>
    <button onclick="window.location.reload()">Tentar novamente</button>
  </div>
</body>
</html>`;
}

/**
 * Packs virtual web files into AFPAK1 binary format:
 *   [6 bytes "AFPAK1"][uint32LE count]
 *   for each file: [uint32LE pathLen][utf8 relPath][uint32LE dataLen][data bytes]
 */
function packAssetsArchive(files: Array<{ relativePath: string; content: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(10);
  header.write('AFPAK1', 0, 'ascii');
  header.writeUInt32LE(files.length, 6);
  chunks.push(header);

  for (const f of files) {
    const cleanRel = f.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const pathBuf = Buffer.from(cleanRel, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(pathBuf.length, 0);
    const dataLenBuf = Buffer.alloc(4);
    dataLenBuf.writeUInt32LE(f.content.length, 0);
    chunks.push(lenBuf, pathBuf, dataLenBuf, f.content);
  }
  return Buffer.concat(chunks);
}

function buildMainCpp(
  project: AppProject,
  options: { hasBundle: boolean; isOfflineOnly: boolean; hasOfflineCacheFallback: boolean }
): string {
  const win = project.windowsConfig;
  const adv = project.advanced;
  const safeId = project.packageName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const startUrl = options.isOfflineOnly ? '' : project.sourceUrl || 'https://example.com';
  const authDomains = (adv.authorizedDomains || [])
    .map((d) => `L"${cStr(d.toLowerCase())}"`)
    .join(', ');
  const primaryRgb = hexToWinRgbExpr(project.visual.primaryColor, '#1D4ED8');
  const preferDark = project.visual.darkMode === 'dark';

  return `#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <objbase.h>
#include <commctrl.h>
#include <string>
#include <vector>
#include <cstdio>
#include <cstring>
#include <algorithm>

#ifndef __in
#define __in
#endif
#ifndef __out
#define __out
#endif
#ifndef __inout
#define __inout
#endif
#ifndef __deref_out
#define __deref_out
#endif
#include "WebView2.h"
#undef __in
#undef __out
#undef __inout
#undef __deref_out

#define IDI_APP_ICON       1
#define IDR_WEBVIEW2_DLL   201
#define IDR_WEB_ASSETS     202
#define IDB_SPLASH_BMP     203

#define WM_TRAYICON        (WM_USER + 42)
#define IDM_HOME           1001
#define IDM_RELOAD         1002
#define IDM_FULLSCREEN     1003
#define IDM_PRINT          1004
#define IDM_EXIT           1005
#define IDM_TRAY_SHOW      1006

static const wchar_t* APP_TITLE = L"${cStr(project.appName)}";
static const wchar_t* APP_ID = L"${cStr(safeId)}";
static const wchar_t* START_URL_W = L"${cStr(startUrl)}";
static const wchar_t* USER_AGENT_W = L"${cStr(adv.userAgent || '')}";
static const char* EXTERNAL_LINKS_MODE = "${cStr(adv.externalLinks)}";
static const char* OFFLINE_MODE = "${cStr(adv.offlineMode)}";
static const bool HAS_BUNDLE = ${options.hasBundle ? 'true' : 'false'};
static const bool IS_OFFLINE_ONLY = ${options.isOfflineOnly ? 'true' : 'false'};
static const bool HAS_OFFLINE_CACHE_FALLBACK = ${options.hasOfflineCacheFallback ? 'true' : 'false'};
static const bool CFG_DARK_MODE = ${preferDark ? 'true' : 'false'};
static const COLORREF CFG_PRIMARY_RGB = ${primaryRgb};
static const bool CFG_ENABLE_JS = ${adv.enableJavaScript ? 'true' : 'false'};
static const bool CFG_ENABLE_ZOOM = ${adv.enableZoom ? 'true' : 'false'};
static const bool CFG_FULLSCREEN = ${win.winFullscreen || adv.fullscreen ? 'true' : 'false'};
static const bool CFG_MENU_BAR = ${win.winMenuBar ? 'true' : 'false'};
static const bool CFG_SYSTEM_TRAY = ${win.winSystemTray ? 'true' : 'false'};
static const bool CFG_CONTEXT_MENU = ${win.winContextMenu ? 'true' : 'false'};
static const bool CFG_PRINT_SUPPORT = ${win.winPrintSupport ? 'true' : 'false'};
static const int  CFG_WIDTH = ${Math.max(360, win.winWidth || 1280)};
static const int  CFG_HEIGHT = ${Math.max(320, win.winHeight || 800)};

static const wchar_t* AUTH_DOMAINS[] = { ${authDomains}${authDomains ? ', ' : ''}nullptr };

static HWND g_hwnd = nullptr;
static HINSTANCE g_hInst = nullptr;
static HICON g_splashIcon = nullptr;
static HBITMAP g_splashBmp = nullptr;
static ICoreWebView2Controller* g_controller = nullptr;
static ICoreWebView2* g_webview = nullptr;
static bool g_webviewReady = false;
static bool g_fellBackOffline = false;
static std::wstring g_runtimeDir;
static std::wstring g_webDir;
static std::wstring g_localStartUrl;
static std::wstring g_activeStartUrl;
static bool g_isFullscreen = false;
static WINDOWPLACEMENT g_prevPlacement = { sizeof(WINDOWPLACEMENT) };
static NOTIFYICONDATAW g_nid = {};
static volatile bool g_serverRunning = false;
static SOCKET g_listenSock = INVALID_SOCKET;
static int g_localPort = 0;

typedef HRESULT (STDAPICALLTYPE *PFN_CreateCoreWebView2EnvironmentWithOptions)(
    PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);

static void EnsureDirTree(const std::wstring& dir) {
    SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
}

static bool WriteBytesToFile(const std::wstring& path, const void* data, DWORD size) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    BOOL ok = WriteFile(h, data, size, &written, nullptr);
    CloseHandle(h);
    return ok && written == size;
}

static bool ExtractResourceToMemory(int resId, const BYTE** outPtr, DWORD* outSize) {
    HRSRC hRes = FindResourceW(nullptr, MAKEINTRESOURCEW(resId), RT_RCDATA);
    if (!hRes) return false;
    HGLOBAL hMem = LoadResource(nullptr, hRes);
    if (!hMem) return false;
    *outSize = SizeofResource(nullptr, hRes);
    *outPtr = (const BYTE*)LockResource(hMem);
    return (*outPtr != nullptr && *outSize > 0);
}

static std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n);
    return w;
}

static std::string WideToUtf8(const std::wstring& w) {
    if (w.empty()) return "";
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, 0);
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
    return s;
}

static void UnpackEmbeddedAssets() {
    wchar_t localAppData[MAX_PATH] = {};
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData))) {
        GetTempPathW(MAX_PATH, localAppData);
    }
    g_runtimeDir = std::wstring(localAppData) + L"\\\\AppForge\\\\" + APP_ID;
    g_webDir = g_runtimeDir + L"\\\\web";
    EnsureDirTree(g_runtimeDir);
    EnsureDirTree(g_webDir);

    // Extract WebView2Loader.dll beside runtime cache if not present next to exe
    const BYTE* dllPtr = nullptr;
    DWORD dllSize = 0;
    if (ExtractResourceToMemory(IDR_WEBVIEW2_DLL, &dllPtr, &dllSize)) {
        std::wstring dllDest = g_runtimeDir + L"\\\\WebView2Loader.dll";
        if (GetFileAttributesW(dllDest.c_str()) == INVALID_FILE_ATTRIBUTES) {
            WriteBytesToFile(dllDest, dllPtr, dllSize);
        }
    }

    // Unpack AFPAK1 archive
    const BYTE* pakPtr = nullptr;
    DWORD pakSize = 0;
    if (!ExtractResourceToMemory(IDR_WEB_ASSETS, &pakPtr, &pakSize) || pakSize < 10) return;
    if (memcmp(pakPtr, "AFPAK1", 6) != 0) return;

    DWORD count = 0;
    memcpy(&count, pakPtr + 6, 4);
    DWORD offset = 10;
    for (DWORD i = 0; i < count && offset + 8 <= pakSize; ++i) {
        DWORD pathLen = 0;
        memcpy(&pathLen, pakPtr + offset, 4);
        offset += 4;
        if (offset + pathLen + 4 > pakSize) break;
        std::string relUtf8((const char*)(pakPtr + offset), pathLen);
        offset += pathLen;
        DWORD dataLen = 0;
        memcpy(&dataLen, pakPtr + offset, 4);
        offset += 4;
        if (offset + dataLen > pakSize) break;

        if (relUtf8.find("..") == std::string::npos) {
            std::string normalized = relUtf8;
            for (char& c : normalized) if (c == '/') c = '\\\\';
            std::wstring target = g_webDir + L"\\\\" + Utf8ToWide(normalized);
            size_t slash = target.find_last_of(L'\\\\');
            if (slash != std::wstring::npos) {
                EnsureDirTree(target.substr(0, slash));
            }
            WriteBytesToFile(target, pakPtr + offset, dataLen);
        }
        offset += dataLen;
    }
}

static const char* GuessMimeType(const std::string& p) {
    auto endsWith = [&](const char* ext) {
        size_t el = strlen(ext);
        if (p.size() < el) return false;
        return _stricmp(p.c_str() + p.size() - el, ext) == 0;
    };
    if (endsWith(".html") || endsWith(".htm")) return "text/html; charset=utf-8";
    if (endsWith(".js") || endsWith(".mjs")) return "application/javascript; charset=utf-8";
    if (endsWith(".css")) return "text/css; charset=utf-8";
    if (endsWith(".json")) return "application/json; charset=utf-8";
    if (endsWith(".svg")) return "image/svg+xml";
    if (endsWith(".png")) return "image/png";
    if (endsWith(".jpg") || endsWith(".jpeg")) return "image/jpeg";
    if (endsWith(".webp")) return "image/webp";
    if (endsWith(".ico")) return "image/x-icon";
    if (endsWith(".woff2")) return "font/woff2";
    if (endsWith(".woff")) return "font/woff";
    if (endsWith(".ttf")) return "font/ttf";
    return "application/octet-stream";
}

static void HandleHttpClient(SOCKET client) {
    char buf[4096];
    int r = recv(client, buf, sizeof(buf) - 1, 0);
    if (r <= 0) { closesocket(client); return; }
    buf[r] = 0;

    std::string reqPath = "/index.html";
    char* sp1 = strchr(buf, ' ');
    if (sp1) {
        char* sp2 = strchr(sp1 + 1, ' ');
        if (sp2) {
            reqPath.assign(sp1 + 1, sp2 - (sp1 + 1));
        }
    }
    size_t q = reqPath.find('?');
    if (q != std::string::npos) reqPath.resize(q);
    if (reqPath == "/" || reqPath.empty()) reqPath = "/index.html";

    if (reqPath.find("..") != std::string::npos) {
        const char* resp = "HTTP/1.1 403 Forbidden\\r\\nConnection: close\\r\\n\\r\\n";
        send(client, resp, (int)strlen(resp), 0);
        closesocket(client);
        return;
    }

    std::string rel = reqPath.substr(1);
    for (char& c : rel) if (c == '/') c = '\\\\';
    std::wstring filePath = g_webDir + L"\\\\" + Utf8ToWide(rel);

    HANDLE h = CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
        // SPA fallback to index.html
        rel = "index.html";
        filePath = g_webDir + L"\\\\index.html";
        h = CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    }

    if (h == INVALID_HANDLE_VALUE) {
        const char* notFound = "HTTP/1.1 404 Not Found\\r\\nConnection: close\\r\\n\\r\\nNot Found";
        send(client, notFound, (int)strlen(notFound), 0);
        closesocket(client);
        return;
    }

    DWORD fileSize = GetFileSize(h, nullptr);
    std::vector<char> body(fileSize);
    DWORD readBytes = 0;
    if (fileSize > 0) ReadFile(h, body.data(), fileSize, &readBytes, nullptr);
    CloseHandle(h);

    const char* mime = GuessMimeType(rel);
    char hdr[512];
    int hlen = snprintf(
        hdr, sizeof(hdr),
        "HTTP/1.1 200 OK\\r\\nContent-Type: %s\\r\\nContent-Length: %lu\\r\\nCache-Control: no-cache\\r\\nConnection: close\\r\\n\\r\\n",
        mime, (unsigned long)readBytes
    );
    send(client, hdr, hlen, 0);
    if (readBytes > 0) {
        send(client, body.data(), (int)readBytes, 0);
    }
    closesocket(client);
}

static DWORD WINAPI ClientThreadProc(LPVOID param) {
    SOCKET client = (SOCKET)(uintptr_t)param;
    HandleHttpClient(client);
    return 0;
}

static DWORD WINAPI AcceptLoopThreadProc(LPVOID) {
    while (g_serverRunning) {
        SOCKET client = accept(g_listenSock, nullptr, nullptr);
        if (client == INVALID_SOCKET) break;
        HANDLE hT = CreateThread(nullptr, 0, ClientThreadProc, (LPVOID)(uintptr_t)client, 0, nullptr);
        if (hT) CloseHandle(hT);
    }
    return 0;
}

static void StartLocalStaticServer() {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return;

    g_listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (g_listenSock == INVALID_SOCKET) return;

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0; // ephemeral

    if (bind(g_listenSock, (sockaddr*)&addr, sizeof(addr)) != 0) {
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
        return;
    }
    int len = sizeof(addr);
    getsockname(g_listenSock, (sockaddr*)&addr, &len);
    g_localPort = ntohs(addr.sin_port);

    if (listen(g_listenSock, 16) != 0) {
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
        return;
    }

    g_serverRunning = true;
    HANDLE hAccept = CreateThread(nullptr, 0, AcceptLoopThreadProc, nullptr, 0, nullptr);
    if (hAccept) CloseHandle(hAccept);
}

static void ToggleFullscreen(HWND hwnd) {
    DWORD style = GetWindowLongW(hwnd, GWL_STYLE);
    if (!g_isFullscreen) {
        MONITORINFO mi = { sizeof(mi) };
        if (GetWindowPlacement(hwnd, &g_prevPlacement) &&
            GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &mi)) {
            SetWindowLongW(hwnd, GWL_STYLE, style & ~WS_OVERLAPPEDWINDOW);
            SetWindowPos(hwnd, HWND_TOP,
                mi.rcMonitor.left, mi.rcMonitor.top,
                mi.rcMonitor.right - mi.rcMonitor.left,
                mi.rcMonitor.bottom - mi.rcMonitor.top,
                SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
            g_isFullscreen = true;
        }
    } else {
        SetWindowLongW(hwnd, GWL_STYLE, style | WS_OVERLAPPEDWINDOW);
        SetWindowPlacement(hwnd, &g_prevPlacement);
        SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        g_isFullscreen = false;
    }
}

static void ResizeWebViewBounds(HWND hwnd) {
    if (!g_controller) return;
    RECT rc;
    GetClientRect(hwnd, &rc);
    g_controller->put_Bounds(rc);
}

static bool IsAuthorizedDomain(const wchar_t* uriW) {
    if (!uriW) return true;
    if (wcsncmp(uriW, L"file://", 7) == 0 || wcsncmp(uriW, L"http://127.0.0.1:", 17) == 0) return true;
    if (AUTH_DOMAINS[0] == nullptr) return true;

    std::wstring u(uriW);
    std::transform(u.begin(), u.end(), u.begin(), ::towlower);
    size_t scheme = u.find(L"://");
    if (scheme == std::wstring::npos) return true;
    size_t hostStart = scheme + 3;
    size_t hostEnd = u.find_first_of(L"/:", hostStart);
    std::wstring host = u.substr(hostStart, hostEnd == std::wstring::npos ? std::wstring::npos : hostEnd - hostStart);

    for (int i = 0; AUTH_DOMAINS[i] != nullptr; ++i) {
        std::wstring d(AUTH_DOMAINS[i]);
        if (host == d) return true;
        if (host.size() > d.size() && host.compare(host.size() - d.size(), d.size(), d) == 0 && host[host.size() - d.size() - 1] == L'.') {
            return true;
        }
    }
    return false;
}

class NewWindowHandler : public ICoreWebView2NewWindowRequestedEventHandler {
    volatile LONG m_ref = 1;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown) { *ppv = static_cast<IUnknown*>(this); AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = (ULONG)InterlockedDecrement(&m_ref); if (r == 0) delete this; return r; }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) override {
        LPWSTR uri = nullptr;
        if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
            if (strcmp(EXTERNAL_LINKS_MODE, "system_browser") == 0 && !IsAuthorizedDomain(uri)) {
                args->put_Handled(TRUE);
                ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
            } else if (strcmp(EXTERNAL_LINKS_MODE, "block") == 0 && !IsAuthorizedDomain(uri)) {
                args->put_Handled(TRUE);
            } else if (g_webview) {
                args->put_Handled(TRUE);
                g_webview->Navigate(uri);
            }
            CoTaskMemFree(uri);
        }
        return S_OK;
    }
};

class NavStartingHandler : public ICoreWebView2NavigationStartingEventHandler {
    volatile LONG m_ref = 1;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown) { *ppv = static_cast<IUnknown*>(this); AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = (ULONG)InterlockedDecrement(&m_ref); if (r == 0) delete this; return r; }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) override {
        LPWSTR uri = nullptr;
        if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
            if (!IsAuthorizedDomain(uri)) {
                if (strcmp(EXTERNAL_LINKS_MODE, "system_browser") == 0) {
                    args->put_Cancel(TRUE);
                    ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
                } else if (strcmp(EXTERNAL_LINKS_MODE, "block") == 0) {
                    args->put_Cancel(TRUE);
                }
            }
            CoTaskMemFree(uri);
        }
        return S_OK;
    }
};

class NavCompletedHandler : public ICoreWebView2NavigationCompletedEventHandler {
    volatile LONG m_ref = 1;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown) { *ppv = static_cast<IUnknown*>(this); AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = (ULONG)InterlockedDecrement(&m_ref); if (r == 0) delete this; return r; }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) override {
        BOOL ok = TRUE;
        args->get_IsSuccess(&ok);
        if (!ok && !IS_OFFLINE_ONLY && !g_fellBackOffline) {
            if (HAS_OFFLINE_CACHE_FALLBACK && !g_localStartUrl.empty()) {
                g_fellBackOffline = true;
                sender->Navigate(g_localStartUrl.c_str());
            } else if (strcmp(OFFLINE_MODE, "disabled") != 0) {
                g_fellBackOffline = true;
                std::wstring offlineUri = L"file:///" + g_webDir + L"\\\\offline.html";
                for (wchar_t& c : offlineUri) if (c == L'\\\\') c = L'/';
                sender->Navigate(offlineUri.c_str());
            }
        }
        return S_OK;
    }
};

class ControllerCompletedHandler : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
    volatile LONG m_ref = 1;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown) { *ppv = static_cast<IUnknown*>(this); AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = (ULONG)InterlockedDecrement(&m_ref); if (r == 0) delete this; return r; }

    HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Controller* controller) override {
        if (FAILED(result) || !controller) {
            // Fallback to Edge --app mode if WebView2 Runtime is missing
            std::wstring arg = L"--app=\\"" + g_activeStartUrl + L"\\"";
            ShellExecuteW(g_hwnd, L"open", L"msedge.exe", arg.c_str(), nullptr, SW_SHOWNORMAL);
            return S_OK;
        }
        g_controller = controller;
        g_controller->AddRef();
        g_controller->get_CoreWebView2(&g_webview);
        if (g_webview) {
            ICoreWebView2Settings* settings = nullptr;
            if (SUCCEEDED(g_webview->get_Settings(&settings)) && settings) {
                settings->put_IsScriptEnabled(CFG_ENABLE_JS ? TRUE : FALSE);
                settings->put_IsZoomControlEnabled(CFG_ENABLE_ZOOM ? TRUE : FALSE);
                settings->put_AreDefaultContextMenusEnabled(CFG_CONTEXT_MENU ? TRUE : FALSE);
                settings->put_IsStatusBarEnabled(FALSE);

                if (USER_AGENT_W[0] != 0) {
                    ICoreWebView2Settings2* s2 = nullptr;
                    if (SUCCEEDED(settings->QueryInterface(IID_ICoreWebView2Settings2, (void**)&s2)) && s2) {
                        s2->put_UserAgent(USER_AGENT_W);
                        s2->Release();
                    }
                }
                settings->Release();
            }

            EventRegistrationToken tok = {};
            g_webview->add_NewWindowRequested(new NewWindowHandler(), &tok);
            g_webview->add_NavigationStarting(new NavStartingHandler(), &tok);
            g_webview->add_NavigationCompleted(new NavCompletedHandler(), &tok);
            g_webview->Navigate(g_activeStartUrl.c_str());
        }
        g_webviewReady = true;
        ResizeWebViewBounds(g_hwnd);
        InvalidateRect(g_hwnd, nullptr, FALSE);
        return S_OK;
    }
};

class EnvCompletedHandler : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
    volatile LONG m_ref = 1;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown) { *ppv = static_cast<IUnknown*>(this); AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = (ULONG)InterlockedDecrement(&m_ref); if (r == 0) delete this; return r; }

    HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Environment* env) override {
        if (FAILED(result) || !env) {
            std::wstring arg = L"--app=\\"" + g_activeStartUrl + L"\\"";
            ShellExecuteW(g_hwnd, L"open", L"msedge.exe", arg.c_str(), nullptr, SW_SHOWNORMAL);
            return S_OK;
        }
        env->CreateCoreWebView2Controller(g_hwnd, new ControllerCompletedHandler());
        return S_OK;
    }
};

static HMODULE LoadWebView2Loader() {
    HMODULE mod = LoadLibraryW(L"WebView2Loader.dll");
    if (mod) return mod;
    std::wstring cached = g_runtimeDir + L"\\\\WebView2Loader.dll";
    return LoadLibraryW(cached.c_str());
}

static void EnableDarkTitleBarIfRequested(HWND hwnd) {
    if (!CFG_DARK_MODE) return;
    HMODULE hDwm = LoadLibraryW(L"dwmapi.dll");
    if (!hDwm) return;
    typedef HRESULT (WINAPI *PFN_DwmSetWindowAttribute)(HWND, DWORD, LPCVOID, DWORD);
    PFN_DwmSetWindowAttribute pfn = (PFN_DwmSetWindowAttribute)GetProcAddress(hDwm, "DwmSetWindowAttribute");
    if (pfn) {
        BOOL dark = TRUE;
        pfn(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
    }
    FreeLibrary(hDwm);
}

static void PaintSplashScreen(HWND hwnd) {
    PAINTSTRUCT ps;
    HDC hdc = BeginPaint(hwnd, &ps);
    RECT rc;
    GetClientRect(hwnd, &rc);
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;

    HBRUSH bgBrush = CreateSolidBrush(CFG_DARK_MODE ? RGB(15, 23, 42) : RGB(248, 250, 252));
    FillRect(hdc, &rc, bgBrush);
    DeleteObject(bgBrush);

    if (g_splashBmp) {
        BITMAP bm = {};
        if (GetObjectW(g_splashBmp, sizeof(bm), &bm) > 0 && bm.bmWidth > 0 && bm.bmHeight > 0) {
            HDC memDc = CreateCompatibleDC(hdc);
            HBITMAP oldBmp = (HBITMAP)SelectObject(memDc, g_splashBmp);
            SetStretchBltMode(hdc, HALFTONE);
            SetBrushOrgEx(hdc, 0, 0, nullptr);
            StretchBlt(hdc, 0, 0, w, h, memDc, 0, 0, bm.bmWidth, bm.bmHeight, SRCCOPY);
            SelectObject(memDc, oldBmp);
            DeleteDC(memDc);
        }
    }

    RECT topBar = { 0, 0, w, 6 };
    HBRUSH accentBrush = CreateSolidBrush(CFG_PRIMARY_RGB);
    FillRect(hdc, &topBar, accentBrush);
    DeleteObject(accentBrush);

    // Draw clean centered badge panel so app icon & title remain crisp over any splash image
    int cardW = (w > 400) ? 340 : (w - 40);
    int cardH = 220;
    int cardX = (w - cardW) / 2;
    int cardY = (h - cardH) / 2;
    RECT cardRc = { cardX, cardY, cardX + cardW, cardY + cardH };
    HBRUSH cardBrush = CreateSolidBrush(CFG_DARK_MODE ? RGB(15, 23, 42) : RGB(255, 255, 255));
    FillRect(hdc, &cardRc, cardBrush);
    DeleteObject(cardBrush);
    HBRUSH borderBrush = CreateSolidBrush(CFG_PRIMARY_RGB);
    FrameRect(hdc, &cardRc, borderBrush);
    DeleteObject(borderBrush);

    if (g_splashIcon) {
        DrawIconEx(hdc, (w - 96) / 2, cardY + 24, g_splashIcon, 96, 96, 0, nullptr, DI_NORMAL);
    }

    SetBkMode(hdc, TRANSPARENT);
    HFONT titleFont = CreateFontW(-22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
    HFONT oldFont = (HFONT)SelectObject(hdc, titleFont);
    SetTextColor(hdc, CFG_DARK_MODE ? RGB(248, 250, 252) : RGB(15, 23, 42));
    RECT titleRc = { cardX + 16, cardY + 132, cardX + cardW - 16, cardY + 168 };
    DrawTextW(hdc, APP_TITLE, -1, &titleRc, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
    SelectObject(hdc, oldFont);
    DeleteObject(titleFont);

    HFONT subFont = CreateFontW(-14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
    oldFont = (HFONT)SelectObject(hdc, subFont);
    SetTextColor(hdc, CFG_DARK_MODE ? RGB(148, 163, 184) : RGB(100, 116, 139));
    RECT subRc = { cardX + 16, cardY + 170, cardX + cardW - 16, cardY + 198 };
    DrawTextW(hdc, IS_OFFLINE_ONLY ? L"Modo Offline • A inicializar..." : L"A inicializar aplicação...", -1, &subRc, DT_CENTER | DT_SINGLELINE);
    SelectObject(hdc, oldFont);
    DeleteObject(subFont);

    EndPaint(hwnd, &ps);
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_PAINT:
            if (!g_webviewReady) {
                PaintSplashScreen(hwnd);
                return 0;
            }
            break;
        case WM_SIZE:
            if (wParam == SIZE_MINIMIZED && CFG_SYSTEM_TRAY) {
                ShowWindow(hwnd, SW_HIDE);
            } else {
                ResizeWebViewBounds(hwnd);
                if (!g_webviewReady) InvalidateRect(hwnd, nullptr, FALSE);
            }
            return 0;
        case WM_TRAYICON:
            if (lParam == WM_LBUTTONDBLCLK || lParam == WM_LBUTTONUP) {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
            } else if (lParam == WM_RBUTTONUP) {
                POINT pt;
                GetCursorPos(&pt);
                HMENU hPop = CreatePopupMenu();
                AppendMenuW(hPop, MF_STRING, IDM_TRAY_SHOW, L"Abrir");
                AppendMenuW(hPop, MF_STRING, IDM_EXIT, L"Sair");
                SetForegroundWindow(hwnd);
                TrackPopupMenu(hPop, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, nullptr);
                DestroyMenu(hPop);
            }
            return 0;
        case WM_COMMAND:
            switch (LOWORD(wParam)) {
                case IDM_HOME:
                    g_fellBackOffline = false;
                    if (g_webview) g_webview->Navigate(g_activeStartUrl.c_str());
                    return 0;
                case IDM_RELOAD:
                    g_fellBackOffline = false;
                    if (g_webview) g_webview->Reload();
                    return 0;
                case IDM_FULLSCREEN:
                    ToggleFullscreen(hwnd);
                    return 0;
                case IDM_PRINT:
                    if (CFG_PRINT_SUPPORT && g_webview) {
                        g_webview->ExecuteScript(L"window.print();", nullptr);
                    }
                    return 0;
                case IDM_TRAY_SHOW:
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                    return 0;
                case IDM_EXIT:
                    DestroyWindow(hwnd);
                    return 0;
            }
            break;
        case WM_QUERYENDSESSION:
            return TRUE;
        case WM_ENDSESSION:
            if (wParam) {
                if (CFG_SYSTEM_TRAY) Shell_NotifyIconW(NIM_DELETE, &g_nid);
                DestroyWindow(hwnd);
            }
            return 0;
        case WM_CLOSE:
            if (CFG_SYSTEM_TRAY) {
                ShowWindow(hwnd, SW_HIDE);
                return 0;
            }
            DestroyWindow(hwnd);
            return 0;
        case WM_DESTROY:
            if (CFG_SYSTEM_TRAY) Shell_NotifyIconW(NIM_DELETE, &g_nid);
            if (g_splashBmp) { DeleteObject(g_splashBmp); g_splashBmp = nullptr; }
            g_serverRunning = false;
            if (g_listenSock != INVALID_SOCKET) closesocket(g_listenSock);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, PWSTR, int nCmdShow) {
    g_hInst = hInstance;
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    InitCommonControls();

    // Bind explicit AppUserModelID so Windows Taskbar and pinned shortcuts always display this app's icon
    HMODULE hShell32 = GetModuleHandleW(L"shell32.dll");
    if (!hShell32) hShell32 = LoadLibraryW(L"shell32.dll");
    if (hShell32) {
        typedef HRESULT (WINAPI *PFN_SetAumid)(PCWSTR);
        PFN_SetAumid pSetAumid = (PFN_SetAumid)GetProcAddress(hShell32, "SetCurrentProcessExplicitAppUserModelID");
        if (pSetAumid) {
            std::wstring aumid = std::wstring(L"AppForge.") + APP_ID;
            pSetAumid(aumid.c_str());
        }
    }

    UnpackEmbeddedAssets();

    if (HAS_BUNDLE) {
        StartLocalStaticServer();
        if (g_localPort > 0) {
            wchar_t urlBuf[128];
            swprintf(urlBuf, 128, L"http://127.0.0.1:%d/index.html", g_localPort);
            g_localStartUrl = urlBuf;
        } else {
            g_localStartUrl = L"file:///" + g_webDir + L"\\\\index.html";
            for (wchar_t& c : g_localStartUrl) if (c == L'\\\\') c = L'/';
        }
    }

    if (IS_OFFLINE_ONLY) {
        g_activeStartUrl = g_localStartUrl;
    } else {
        g_activeStartUrl = START_URL_W;
    }

    int bigCx = GetSystemMetrics(SM_CXICON);
    int bigCy = GetSystemMetrics(SM_CYICON);
    int smCx = GetSystemMetrics(SM_CXSMICON);
    int smCy = GetSystemMetrics(SM_CYSMICON);
    HICON hBigIcon = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON), IMAGE_ICON, bigCx > 0 ? bigCx : 48, bigCy > 0 ? bigCy : 48, LR_DEFAULTCOLOR | LR_SHARED);
    if (!hBigIcon) hBigIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON));
    HICON hSmallIcon = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON), IMAGE_ICON, smCx > 0 ? smCx : 16, smCy > 0 ? smCy : 16, LR_DEFAULTCOLOR | LR_SHARED);
    if (!hSmallIcon) hSmallIcon = hBigIcon;
    g_splashIcon = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON), IMAGE_ICON, 96, 96, LR_DEFAULTCOLOR | LR_SHARED);
    if (!g_splashIcon) g_splashIcon = hBigIcon;
    g_splashBmp = (HBITMAP)LoadImageW(hInstance, MAKEINTRESOURCEW(IDB_SPLASH_BMP), IMAGE_BITMAP, 0, 0, LR_DEFAULTCOLOR);

    std::wstring wndClassName = std::wstring(L"AppForgeWin_") + APP_ID;
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = wndClassName.c_str();
    wc.hIcon = hBigIcon;
    wc.hIconSm = hSmallIcon;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(CFG_DARK_MODE ? RGB(15, 23, 42) : RGB(248, 250, 252));
    RegisterClassExW(&wc);

    DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
    ${win.winResizable ? 'style |= WS_THICKFRAME;' : ''}
    ${win.winMaximizable ? 'style |= WS_MAXIMIZEBOX;' : ''}
    ${win.winMinimizable ? 'style |= WS_MINIMIZEBOX;' : ''}

    HMENU hMenuBar = nullptr;
    if (CFG_MENU_BAR) {
        hMenuBar = CreateMenu();
        HMENU hNav = CreatePopupMenu();
        AppendMenuW(hNav, MF_STRING, IDM_HOME, L"Página Inicial");
        AppendMenuW(hNav, MF_STRING, IDM_RELOAD, L"Recarregar");
        if (CFG_PRINT_SUPPORT) AppendMenuW(hNav, MF_STRING, IDM_PRINT, L"Imprimir");
        AppendMenuW(hNav, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(hNav, MF_STRING, IDM_EXIT, L"Sair");
        AppendMenuW(hMenuBar, MF_POPUP, (UINT_PTR)hNav, L"Navegação");

        HMENU hView = CreatePopupMenu();
        AppendMenuW(hView, MF_STRING, IDM_FULLSCREEN, L"Ecrã Inteiro");
        AppendMenuW(hMenuBar, MF_POPUP, (UINT_PTR)hView, L"Visualização");
    }

    g_hwnd = CreateWindowExW(
        0, wc.lpszClassName, APP_TITLE, style,
        CW_USEDEFAULT, CW_USEDEFAULT, CFG_WIDTH, CFG_HEIGHT,
        nullptr, hMenuBar, hInstance, nullptr
    );
    if (!g_hwnd) return 1;

    SendMessageW(g_hwnd, WM_SETICON, ICON_BIG, (LPARAM)hBigIcon);
    SendMessageW(g_hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hSmallIcon);
    EnableDarkTitleBarIfRequested(g_hwnd);

    if (CFG_SYSTEM_TRAY) {
        g_nid.cbSize = sizeof(g_nid);
        g_nid.hWnd = g_hwnd;
        g_nid.uID = 1;
        g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
        g_nid.uCallbackMessage = WM_TRAYICON;
        g_nid.hIcon = hSmallIcon;
        wcsncpy(g_nid.szTip, APP_TITLE, 127);
        Shell_NotifyIconW(NIM_ADD, &g_nid);
    }

    ShowWindow(g_hwnd, nCmdShow);
    UpdateWindow(g_hwnd);
    if (CFG_FULLSCREEN) ToggleFullscreen(g_hwnd);

    HMODULE hLoader = LoadWebView2Loader();
    PFN_CreateCoreWebView2EnvironmentWithOptions fnCreate = hLoader
        ? (PFN_CreateCoreWebView2EnvironmentWithOptions)GetProcAddress(hLoader, "CreateCoreWebView2EnvironmentWithOptions")
        : nullptr;

    if (fnCreate) {
        std::wstring userDataDir = g_runtimeDir + L"\\\\eb_data";
        EnsureDirTree(userDataDir);
        fnCreate(nullptr, userDataDir.c_str(), nullptr, new EnvCompletedHandler());
    } else {
        std::wstring arg = L"--app=\\"" + g_activeStartUrl + L"\\"";
        ShellExecuteW(g_hwnd, L"open", L"msedge.exe", arg.c_str(), nullptr, SW_SHOWNORMAL);
    }

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CoUninitialize();
    return (int)msg.wParam;
}
`;
}

export async function compileWindowsBinaries(
  project: AppProject,
  workDir: string,
  targets: { installerExe: boolean; portableExe: boolean },
  onLog: (msg: string) => void
): Promise<{
  installerExe?: Buffer;
  portableExe?: Buffer;
}> {
  const winBuildDir = path.join(workDir, 'windows_build');
  const includeDir = path.join(winBuildDir, 'include');
  await fs.mkdir(includeDir, { recursive: true });

  const appDisplayName = sanitizeWinName(project.appName);
  const exeBaseName = sanitizeWinFileName(project.appName);
  const versionParts = (project.versionName || '1.0.0')
    .replace(/[^0-9.]/g, '')
    .split('.')
    .filter(Boolean);
  while (versionParts.length < 4) versionParts.push('0');
  const winFileVersion = versionParts.slice(0, 4).join(',');

  onLog('A converter ícone da aplicação para formato Windows (.ICO multi-resolução)...');
  const iconPng = path.join(winBuildDir, 'icon_512.png');
  const iconIco = path.join(winBuildDir, 'app.ico');
  const splashBmp = path.join(winBuildDir, 'splash.bmp');
  await resolveIconToPng(
    project.visual.iconUrl,
    project.visual.primaryColor,
    project.appName,
    iconPng
  );
  await generateWindowsIco(iconPng, iconIco);
  await resolveSplashToBmp(
    project.visual.splashUrl,
    project.visual.primaryColor,
    project.visual.secondaryColor,
    splashBmp
  );

  // Copy WebView2Loader.dll into build directory for embedding
  const wvLoaderSrc = path.join(WEBVIEW2_NATIVE_DIR, 'x64', 'WebView2Loader.dll');
  const wvLoaderLocal = path.join(winBuildDir, 'WebView2Loader.dll');
  await fs.copyFile(wvLoaderSrc, wvLoaderLocal);

  // Prepare offline bundle / fallback archive
  const hasBundle = Boolean(project.sourceBundleId);
  const isOfflineOnly =
    hasBundle &&
    (project.conversionType !== 'url' || project.advanced.offlineMode === 'offline_app');
  const hasOfflineCacheFallback =
    hasBundle &&
    project.conversionType === 'url' &&
    project.advanced.offlineMode === 'cache_first';

  const assetsToPack: Array<{ relativePath: string; content: Buffer }> = [
    { relativePath: 'offline.html', content: Buffer.from(buildOfflineHtml(project), 'utf8') },
  ];
  if (hasBundle && project.sourceBundleId) {
    const bundleFiles = await readBundleFilesForPackaging(project.ownerId, project.sourceBundleId);
    onLog(`A empacotar ${bundleFiles.length} ficheiro(s) web no executável Windows para modo offline...`);
    for (const bf of bundleFiles) {
      assetsToPack.push(bf);
    }
  }
  const pakPath = path.join(winBuildDir, 'web_assets.pak');
  await fs.writeFile(pakPath, packAssetsArchive(assetsToPack));

  // Write EventToken.h shim required by WebView2.h under MinGW-w64
  await fs.writeFile(
    path.join(includeDir, 'EventToken.h'),
    `#pragma once
#ifndef EVENTTOKEN_H
#define EVENTTOKEN_H
typedef struct EventRegistrationToken {
    long long value;
} EventRegistrationToken;
#endif
`,
    'utf8'
  );

  // Write resource.rc (1 ICON ensures Explorer always shows this icon on .exe and shortcuts)
  const rcContent = `#include <windows.h>
1 ICON "app.ico"
201 RCDATA "WebView2Loader.dll"
202 RCDATA "web_assets.pak"
203 BITMAP "splash.bmp"

1 VERSIONINFO
FILEVERSION ${winFileVersion}
PRODUCTVERSION ${winFileVersion}
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904B0"
    BEGIN
      VALUE "CompanyName", "${cStr(project.author || 'AppForge Studio')}"
      VALUE "FileDescription", "${cStr(project.description || project.appName)}"
      VALUE "FileVersion", "${cStr(project.versionName || '1.0.0')}"
      VALUE "ProductName", "${cStr(project.appName)}"
      VALUE "ProductVersion", "${cStr(project.versionName || '1.0.0')}"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x0409, 1200
  END
END
`;
  const rcPath = path.join(winBuildDir, 'resource.rc');
  const resObjPath = path.join(winBuildDir, 'resource.o');
  await fs.writeFile(rcPath, rcContent, 'utf8');

  onLog('A compilar recursos Win32 (.ICO, VERSIONINFO e WebView2Loader)...');
  await execFileAsync(
    'x86_64-w64-mingw32-windres',
    [rcPath, '-O', 'coff', '-o', resObjPath],
    { cwd: winBuildDir, timeout: 30000 }
  );

  const mainCppPath = path.join(winBuildDir, 'main.cpp');
  await fs.writeFile(
    mainCppPath,
    buildMainCpp(project, { hasBundle, isOfflineOnly, hasOfflineCacheFallback }),
    'utf8'
  );

  const appExePath = path.join(winBuildDir, `${exeBaseName}.exe`);
  const wvInclude = path.join(WEBVIEW2_NATIVE_DIR, 'include');

  onLog('A compilar binário nativo Windows x86_64 (MinGW-w64 + Edge WebView2)...');
  await execFileAsync(
    'x86_64-w64-mingw32-g++',
    [
      '-O2',
      '-std=c++17',
      '-mwindows',
      '-municode',
      '-static-libgcc',
      '-static-libstdc++',
      `-I${includeDir}`,
      `-I${wvInclude}`,
      mainCppPath,
      resObjPath,
      '-o',
      appExePath,
      '-lole32',
      '-loleaut32',
      '-luuid',
      '-lws2_32',
      '-lshell32',
      '-lshlwapi',
      '-ladvapi32',
      '-luser32',
      '-lgdi32',
      '-lcomctl32',
    ],
    { cwd: winBuildDir, timeout: 90000 }
  );

  const out: { installerExe?: Buffer; portableExe?: Buffer } = {};

  if (targets.portableExe) {
    out.portableExe = await fs.readFile(appExePath);
    onLog(`Executável Portátil Windows gerado (${(out.portableExe.length / 1024).toFixed(1)} KB).`);
  }

  if (targets.installerExe) {
    onLog('A preparar gráficos do assistente Modern UI 2 e instalador Windows NSIS (.EXE)...');
    const headerBmpPath = path.join(winBuildDir, 'header.bmp');
    const wizardBmpPath = path.join(winBuildDir, 'wizard.bmp');
    await generateNsisModernBitmaps(
      iconPng,
      project.visual.primaryColor,
      project.visual.secondaryColor,
      headerBmpPath,
      wizardBmpPath
    );

    const setupExePath = path.join(winBuildDir, 'setup.exe');
    const win = project.windowsConfig;
    const publisher = nsisStr(project.author || 'AppForge Studio');
    const nsisName = nsisStr(appDisplayName);
    const nsisVer = nsisStr(project.versionName || '1.0.0');
    const safeId = project.packageName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const wndClassNsis = nsisStr(`AppForgeWin_${safeId}`);
    const legacyExeBase = nsisStr(legacySanitizeWinFileName(project.appName));

    const nsiScript = `Unicode True
!include "MUI2.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

Name "${nsisName}"
OutFile "setup.exe"
Icon "app.ico"
UninstallIcon "app.ico"
InstallDir "$LOCALAPPDATA\\Programs\\${exeBaseName}"
InstallDirRegKey HKCU "Software\\${exeBaseName}" "Install_Dir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetOverwrite on

!define MUI_ABORTWARNING
!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_FINISHPAGE_RUN "$INSTDIR\\${exeBaseName}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Iniciar ${nsisName} agora"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Portuguese"

!macro StopRunningApp
  FindWindow $0 "${wndClassNsis}" ""
  \${If} $0 != 0
    SendMessage $0 \${WM_ENDSESSION} 1 0 /TIMEOUT=1000
    Sleep 300
  \${EndIf}
  FindWindow $0 "AppForgeWebViewWindow" "${nsisName}"
  \${If} $0 != 0
    SendMessage $0 \${WM_ENDSESSION} 1 0 /TIMEOUT=1000
    Sleep 300
  \${EndIf}
  nsExec::ExecToStack 'taskkill.exe /F /T /IM "${exeBaseName}.exe"'
  Pop $0
  Pop $1
  ${legacyExeBase !== exeBaseName ? `nsExec::ExecToStack 'taskkill.exe /F /T /IM "${legacyExeBase}.exe"'\n  Pop $0\n  Pop $1` : ''}
  Sleep 500
!macroend

Section "Instalar"
  !insertmacro StopRunningApp
  SetOutPath "$INSTDIR"
  File "${exeBaseName}.exe"
  File "WebView2Loader.dll"
  File "app.ico"

  WriteRegStr HKCU "Software\\${exeBaseName}" "Install_Dir" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exeBaseName}" "DisplayName" "${nsisName}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exeBaseName}" "DisplayVersion" "${nsisVer}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exeBaseName}" "Publisher" "${publisher}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exeBaseName}" "DisplayIcon" "$INSTDIR\\${exeBaseName}.exe,0"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exeBaseName}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
  WriteUninstaller "$INSTDIR\\Uninstall.exe"

  ${win.winDesktopShortcut ? `CreateShortcut "$DESKTOP\\${nsisName}.lnk" "$INSTDIR\\${exeBaseName}.exe" "" "$INSTDIR\\app.ico" 0` : ''}
  ${win.winStartMenuShortcut ? `CreateDirectory "$SMPROGRAMS\\${nsisName}"\n  CreateShortcut "$SMPROGRAMS\\${nsisName}\\${nsisName}.lnk" "$INSTDIR\\${exeBaseName}.exe" "" "$INSTDIR\\app.ico" 0\n  CreateShortcut "$SMPROGRAMS\\${nsisName}\\Desinstalar ${nsisName}.lnk" "$INSTDIR\\Uninstall.exe" "" "$INSTDIR\\app.ico" 0` : ''}
  ${win.winAutoStart ? `WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${exeBaseName}" '"$INSTDIR\\${exeBaseName}.exe"'` : ''}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "Uninstall"
  !insertmacro StopRunningApp
  Delete "$INSTDIR\\${exeBaseName}.exe"
  Delete "$INSTDIR\\WebView2Loader.dll"
  Delete "$INSTDIR\\app.ico"
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"

  ${win.winDesktopShortcut ? `Delete "$DESKTOP\\${nsisName}.lnk"` : ''}
  ${win.winStartMenuShortcut ? `Delete "$SMPROGRAMS\\${nsisName}\\${nsisName}.lnk"\n  Delete "$SMPROGRAMS\\${nsisName}\\Desinstalar ${nsisName}.lnk"\n  RMDir "$SMPROGRAMS\\${nsisName}"` : ''}
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${exeBaseName}"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${exeBaseName}"
  DeleteRegKey HKCU "Software\\${exeBaseName}"
SectionEnd
`;
    const nsiPath = path.join(winBuildDir, 'installer.nsi');
    await fs.writeFile(nsiPath, nsiScript, 'utf8');
    await execFileAsync('makensis', ['-V2', nsiPath], { cwd: winBuildDir, timeout: 60000 });
    out.installerExe = await fs.readFile(setupExePath);
    onLog(`Instalador Windows Modern Setup (.EXE) gerado (${(out.installerExe.length / 1024).toFixed(1)} KB).`);
  }

  return out;
}
