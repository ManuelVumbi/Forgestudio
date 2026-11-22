import React, { useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wand2,
  X,
} from 'lucide-react';
import { AdminPanelView } from './components/AdminPanelView';
import { AppWizard } from './components/AppWizard';
import { BuildEngineView } from './components/BuildEngineView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { KeystoresView } from './components/KeystoresView';
import { LandingPage } from './components/LandingPage';
import { ProjectsView } from './components/ProjectsView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, ThemeToggle } from './contexts/ThemeContext';
import { AppProject } from './types/appforge';

type NavView =
  | 'dashboard'
  | 'wizard'
  | 'projects'
  | 'builds'
  | 'keystores'
  | 'admin';

const VIEW_TITLES: Record<NavView, string> = {
  dashboard: 'Painel Geral',
  wizard: 'Criar Aplicação',
  projects: 'Os Meus Projectos',
  builds: 'Motor de Compilação',
  keystores: 'Keystores e Assinatura',
  admin: 'Painel Administrativo',
};

const EmailVerificationGate: React.FC = () => {
  const { user, resendVerificationEmail, reloadUserVerification, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const verified = await reloadUserVerification();
      if (!verified) {
        setErrorMsg(
          'O seu email ainda não foi confirmado. Clique na ligação de verificação enviada para a sua caixa de entrada e tente novamente.'
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao verificar estado da conta.');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await resendVerificationEmail();
      setStatusMsg('Novo email de verificação enviado com sucesso. Verifique também a pasta Spam.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Aguarde alguns instantes antes de reenviar o email.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-7 space-y-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center shrink-0">
            <MailCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white">
              Confirme o seu endereço de email
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[270px]">
              {user?.email}
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Para proteger a sua conta e desbloquear a compilação de aplicações Android e Windows, enviámos uma ligação de confirmação para o seu email.
        </p>

        {statusMsg && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
            {statusMsg}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            {errorMsg}
          </div>
        )}

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{checking ? 'A verificar...' : 'Já Confirmei o Email'}</span>
          </button>

          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{resending ? 'A reenviar...' : 'Reenviar Email de Verificação'}</span>
          </button>

          <button
            type="button"
            onClick={logout}
            className="w-full py-2 px-4 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Terminar Sessão / Usar outra conta</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const AppWorkspace: React.FC = () => {
  const {
    user,
    profile,
    loading,
    authError,
    clearAuthError,
    isAdmin,
    needsEmailVerification,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resetPassword,
    logout,
  } = useAuth();
  const [view, setView] = useState<NavView>('dashboard');
  const [editingProject, setEditingProject] = useState<AppProject | null>(null);
  const [focusedBuildId, setFocusedBuildId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          A carregar AppForge Studio...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LandingPage
        onSignInGoogle={signInWithGoogle}
        onSignInEmail={signInWithEmail}
        onRegisterEmail={registerWithEmail}
        onResetPassword={resetPassword}
        onClearAuthError={clearAuthError}
        authError={authError}
      />
    );
  }

  if (needsEmailVerification) {
    return <EmailVerificationGate />;
  }

  const openNewWizard = () => {
    setEditingProject(null);
    setView('wizard');
    setMobileMenuOpen(false);
  };

  const openEditWizard = (proj: AppProject) => {
    setEditingProject(proj);
    setView('wizard');
    setMobileMenuOpen(false);
  };

  const navItems: Array<{ id: NavView; label: string; icon: React.ComponentType<any>; adminOnly?: boolean }> = [
    { id: 'dashboard', label: 'Painel Geral', icon: LayoutDashboard },
    { id: 'wizard', label: 'Criar Aplicação', icon: Wand2 },
    { id: 'projects', label: 'Projectos', icon: FolderKanban },
    { id: 'builds', label: 'Compilações', icon: Cpu },
    { id: 'keystores', label: 'Keystores', icon: KeyRound },
    { id: 'admin', label: 'Administração', icon: ShieldCheck, adminOnly: true },
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full justify-between p-4 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div>
        <div className="px-2 py-3 mb-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white font-display">
            AppForge Studio
          </span>
        </div>

        <nav className="space-y-1">
          {navItems
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'wizard') setEditingProject(null);
                    setView(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 border border-slate-200 dark:border-slate-700 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
        </nav>
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="px-2">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
            {profile?.displayName || user.displayName || user.email?.split('@')[0]}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Terminar Sessão</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full bg-slate-50 dark:bg-slate-900">
            <SidebarContent />
          </div>
          <div
            className="flex-1 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Top Header Bar */}
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur sticky top-0 z-20 px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 truncate">
              <span className="font-medium text-slate-900 dark:text-white">AppForge Studio</span>
              <span aria-hidden="true">/</span>
              <span className="truncate">{VIEW_TITLES[view]}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={openNewWizard}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-blue-600 text-white rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova Aplicação</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {profile?.accountStatus === 'suspended' && (
            <div className="mb-6 border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
              A sua conta foi suspensa pela administração. Novas compilações estão bloqueadas.
            </div>
          )}

          {view === 'dashboard' && (
            <DashboardView
              onNewApp={openNewWizard}
              onEditProject={openEditWizard}
              onOpenBuild={(id) => {
                setFocusedBuildId(id);
                setView('builds');
              }}
            />
          )}

          {view === 'wizard' && (
            <AppWizard
              initialProject={editingProject}
              onSavedProject={() => setView('projects')}
              onBuildStarted={(buildId) => {
                setFocusedBuildId(buildId);
                setView('builds');
              }}
            />
          )}

          {view === 'projects' && (
            <ProjectsView
              onCreateNew={openNewWizard}
              onEdit={openEditWizard}
              onViewBuild={(buildId) => {
                setFocusedBuildId(buildId);
                setView('builds');
              }}
            />
          )}

          {view === 'builds' && (
            <BuildEngineView
              focusedBuildId={focusedBuildId}
              onGoToAdminInfra={isAdmin ? () => setView('admin') : undefined}
            />
          )}

          {view === 'keystores' && <KeystoresView />}
          {view === 'admin' && isAdmin && <AdminPanelView />}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AppWorkspace />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
