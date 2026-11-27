import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  Code2,
  Globe,
  Layers,
  Monitor,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  WifiOff,
} from 'lucide-react';
import { ThemeToggle } from '../contexts/ThemeContext';
import { LoginModal } from './LoginModal';

interface LandingPageProps {
  onSignInGoogle: () => Promise<void>;
  onSignInEmail: (email: string, password: string) => Promise<void>;
  onRegisterEmail: (displayName: string, email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
  onClearAuthError: () => void;
  authError: string | null;
  authErrorCode?: string | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onSignInGoogle,
  onSignInEmail,
  onRegisterEmail,
  onResetPassword,
  onClearAuthError,
  authError,
  authErrorCode,
}) => {
  const [previewUrl, setPreviewUrl] = useState('https://minhaloja.pt');
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar Contract: 3 zones */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 font-display"
          >
            AppForge Studio
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#conversores" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Conversores
            </a>
            <a href="#fluxo" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Fluxo de Build
            </a>
            <a href="#formatos" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Formatos Instaláveis
            </a>
            <a href="#seguranca" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Segurança
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle compact />
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Entrar
            </button>
          </div>
        </div>
      </header>

      {/* Hero Split */}
      <section id="top" className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-4 flex flex-wrap items-center gap-2">
              <span>Android APK &amp; AAB</span>
              <span aria-hidden="true">·</span>
              <span>Windows EXE &amp; Portátil</span>
              <span aria-hidden="true">·</span>
              <span>Modo Offline Completo</span>
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12] mb-6 [text-wrap:balance]">
              Converta websites e projectos web em aplicações instaláveis
            </h1>

            <p className="text-base lg:text-lg text-slate-600 dark:text-slate-300 leading-relaxed mb-8 max-w-xl">
              Transforme qualquer endereço HTTP/HTTPS, pacote HTML/ZIP ou aplicação React, Vue e Laravel em pacotes nativos para Android e executáveis Windows 10/11 com funcionamento offline e identidade visual própria.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-4 max-w-xl">
              <input
                type="url"
                value={previewUrl}
                onChange={(e) => setPreviewUrl(e.target.value)}
                placeholder="https://oseusite.com"
                aria-label="Endereço do website"
                className="flex-1 px-4 py-3 text-sm border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="px-6 py-3 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Criar Aplicação</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Acesso com email e senha ou conta Google · Conversão ilimitada sem planos nem barreiras.
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full border border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-900 p-6 lg:p-8 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Saídas Multiplataforma</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate max-w-[260px]">
                    {previewUrl || 'https://oseusite.com'}
                  </p>
                </div>
                <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Pipeline Único</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-auto">
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                  <Smartphone className="w-5 h-5 text-blue-700 dark:text-blue-400 mb-3" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Android APK &amp; AAB</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                    WebView nativa com ícones adaptativos, Splash Screen com logótipo e assinatura Keystore PKCS#12.
                  </p>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    app-release.apk · app-release.aab
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                  <Monitor className="w-5 h-5 text-blue-700 dark:text-blue-400 mb-3" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Windows EXE Moderno</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                    Instalador Modern UI 2 com marca própria, ícone no ambiente de trabalho e EXE Portátil WebView2.
                  </p>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    setup.exe · portable.exe
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <WifiOff className="w-3.5 h-3.5" /> Empacotamento Offline Automático
                </span>
                <span className="font-mono">SHA-256 Verificado</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Conversion Modes */}
      <section id="conversores" className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-10">
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white mb-3 [text-wrap:balance]">
              Três modalidades de conversão automática
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Desde websites com espelhamento offline até projectos estáticos e aplicações SPA compiladas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <Globe className="w-5 h-5 text-blue-700 dark:text-blue-400 mb-4" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">A. Conversão por URL &amp; Offline</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Detecta título, logótipo e cores e permite capturar páginas, CSS, JS, imagens e fontes para funcionar mesmo sem Internet.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <UploadCloud className="w-5 h-5 text-blue-700 dark:text-blue-400 mb-4" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">B. Ficheiros HTML / ZIP</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Carregue ficheiros HTML, CSS, JavaScript ou arquivos ZIP preservando imagens, fontes e execução 100% offline.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
              <Code2 className="w-5 h-5 text-blue-700 dark:text-blue-400 mb-4" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">C. Projectos Web Modernos</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Suporte dedicado para builds React, Vue e Angular ou aplicações Laravel e PHP com detecção automática de recursos.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow & Security */}
      <section id="fluxo" className="py-16 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Assistente visual em 4 etapas</h2>
            <div className="space-y-4">
              {[
                ['01. Informações da Aplicação', 'Nome, pacote Android (com.empresa.app), versão, autor e captura offline.'],
                ['02. Selecção de Plataforma', 'Gere Android APK/AAB, Windows EXE/Portátil e código-fonte em paralelo.'],
                ['03. Personalização Visual', 'Ícone adaptativo, Splash Screen com logótipo, cores, barra, menus e modo escuro.'],
                ['04. Configurações Avançadas', 'Permissões, User-Agent, modo offline, cache, downloads, Tray e arranque Windows.'],
              ].map(([title, desc]) => (
                <div key={title} className="border-b border-slate-100 dark:border-slate-800 pb-4">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div id="seguranca" className="border border-slate-200 dark:border-slate-800 rounded-xl p-8 bg-slate-50 dark:bg-slate-900 flex flex-col justify-between">
            <div>
              <ShieldCheck className="w-6 h-6 text-blue-700 dark:text-blue-400 mb-4" />
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                Isolamento de compilação e assinatura encriptada
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
                Todos os processos de build correm em directórios isolados sem execução directa de código de utilizador no servidor principal. Keystores e credenciais são encriptados com AES-256-GCM.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Validação Anti-SSRF</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Keystore AES-256-GCM</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Registos de Auditoria</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Ícones Nativos Garantidos</div>
            </div>
          </div>
        </div>
      </section>

      {/* Unrestricted Outputs */}
      <section id="formatos" className="py-16 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-10">
            <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Todos os formatos de instalação incluídos sem limites
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Compile projectos ilimitados para Android e Windows com acesso completo a todos os instaladores e código-fonte.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">Android APK &amp; AAB</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                  Compilação nativa APK Debug, APK Release assinado com Keystore PKCS#12 e Android App Bundle (.AAB) validado para Google Play Store.
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-medium">
                app-debug.apk · app-release.apk · release.aab
              </span>
            </div>

            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">Windows 10/11 (.EXE)</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                  Instalador Windows Modern UI 2 (.EXE) com identidade visual personalizada, atalhos com ícone e executável portátil autónomo.
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-medium">
                setup.exe · portable.exe
              </span>
            </div>

            <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">Código-Fonte &amp; Keystores</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                  Exportação integral do código-fonte Kotlin/Gradle e Electron Builder, mais gestão encriptada de Keystores e suporte offline.
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-medium">
                android-source.zip · windows-source.zip
              </span>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            <span>AppForge Studio · Plataforma de Conversão Android &amp; Windows</span>
          </div>
          <div>
            <span>© 2026 AppForge Studio</span>
          </div>
        </div>
      </footer>

      <LoginModal
        open={loginOpen}
        authError={authError}
        authErrorCode={authErrorCode}
        onClearError={onClearAuthError}
        onClose={() => setLoginOpen(false)}
        onSignInGoogle={onSignInGoogle}
        onSignInEmail={onSignInEmail}
        onRegisterEmail={onRegisterEmail}
        onResetPassword={onResetPassword}
      />
    </div>
  );
};
