import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  User as UserIcon,
  X,
} from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';

const DEFAULT_AUTHORIZED_APP_URL =
  'https://ais-pre-vt2flm7k2y7q4l7f7gdamg-464361906289.europe-west2.run.app';

function toSafeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

interface LoginModalProps {
  open: boolean;
  authError: string | null;
  authErrorCode?: string | null;
  onClearError?: () => void;
  onClose: () => void;
  onSignInGoogle: () => Promise<void>;
  onSignInEmail: (email: string, password: string) => Promise<void>;
  onRegisterEmail: (displayName: string, email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
}

type AuthTab = 'login' | 'register' | 'reset';

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  authError,
  authErrorCode,
  onClearError,
  onClose,
  onSignInGoogle,
  onSignInEmail,
  onRegisterEmail,
  onResetPassword,
}) => {
  const [tab, setTab] = useState<AuthTab>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  useEffect(() => {
    if (open) {
      setLocalError(null);
      setSuccessMsg(null);
      setCopiedDomain(false);
      onClearError?.();
    }
  }, [open]);

  if (!open) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const isDomainError = authErrorCode === 'auth/unauthorized-domain';
  const isPasswordDisabledError = authErrorCode === 'auth/operation-not-allowed';
  const firebaseConsoleUrl = toSafeHttpUrl(
    `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/${
      isPasswordDisabledError ? 'providers' : 'settings'
    }`
  );
  const authorizedAppUrl = toSafeHttpUrl(
    (import.meta.env.VITE_AUTHORIZED_APP_URL || '').trim() || DEFAULT_AUTHORIZED_APP_URL
  );
  const showAuthorizedAppShortcut =
    Boolean(authorizedAppUrl) &&
    Boolean(currentHost) &&
    !authorizedAppUrl!.includes(currentHost);

  const handleCopyDomain = async () => {
    if (!currentHost || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(currentHost);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      // Clipboard unavailable
    }
  };

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setLocalError(null);
    setSuccessMsg(null);
    onClearError?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMsg(null);
    onClearError?.();

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setLocalError('Introduza um endereço de email válido.');
      return;
    }

    if (tab !== 'reset' && password.length < 6) {
      setLocalError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (tab === 'register' && !displayName.trim()) {
      setLocalError('Introduza o seu nome completo.');
      return;
    }

    setSubmitting(true);
    try {
      if (tab === 'login') {
        await onSignInEmail(cleanEmail, password);
      } else if (tab === 'register') {
        await onRegisterEmail(displayName.trim(), cleanEmail, password);
      } else {
        await onResetPassword(cleanEmail);
        setSuccessMsg(
          'Enviámos uma ligação de reposição de senha para o seu email. Verifique a caixa de entrada e spam.'
        );
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Não foi possível concluir a autenticação.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setLocalError(null);
    setSuccessMsg(null);
    onClearError?.();
    setSubmitting(true);
    try {
      await onSignInGoogle();
    } catch (err: any) {
      setLocalError(err?.message || 'Falha ao iniciar sessão com Google.');
    } finally {
      setSubmitting(false);
    }
  };

  const displayedError = localError || authError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="login-modal-title"
                className="text-sm font-bold text-slate-900 dark:text-white"
              >
                Aceder ao AppForge Studio
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Entre com email e senha ou com a sua conta Google
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de login"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Clean Login / Register Switcher */}
          {tab !== 'reset' ? (
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">
              <button
                type="button"
                onClick={() => switchTab('login')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  tab === 'login'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Iniciar Sessão
              </button>
              <button
                type="button"
                onClick={() => switchTab('register')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  tab === 'register'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Criar Conta
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                Recuperar Senha
              </span>
              <button
                type="button"
                onClick={() => switchTab('login')}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Voltar ao login
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {tab === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="O seu nome"
                    autoComplete="name"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Endereço de Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="utilizador@exemplo.com"
                  autoComplete="email"
                  required
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                />
              </div>
            </div>

            {tab !== 'reset' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Senha
                  </label>
                  {tab === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchTab('reset')}
                      className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Esqueceu-se da senha?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={tab === 'register' ? 'Mínimo 6 caracteres' : 'Introduza a sua senha'}
                    autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                    required
                    className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {displayedError && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 leading-relaxed space-y-2.5">
                <p>{displayedError}</p>

                {(isDomainError || isPasswordDisabledError) && (
                  <div className="pt-2 border-t border-red-200/80 dark:border-red-900/60 space-y-2">
                    {isDomainError && currentHost && (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-red-200/70 dark:border-red-900/50 px-2.5 py-1.5">
                        <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate">
                          {currentHost}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyDomain}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-900 text-white dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 shrink-0 cursor-pointer"
                        >
                          {copiedDomain ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copiar domínio</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {firebaseConsoleUrl && (
                        <a
                          href={firebaseConsoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-red-200 dark:border-red-900/60 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <span>
                            {isPasswordDisabledError
                              ? 'Activar Email/Senha no Firebase'
                              : 'Autorizar domínio no Firebase'}
                          </span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}

                      {showAuthorizedAppShortcut && authorizedAppUrl && (
                        <a
                          href={authorizedAppUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-700 text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                        >
                          <span>Abrir App Autorizada (Login Google + Build)</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {successMsg && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            >
              <span>
                {submitting
                  ? 'A processar...'
                  : tab === 'login'
                  ? 'Entrar com Email e Senha'
                  : tab === 'register'
                  ? 'Criar Conta'
                  : 'Enviar Link de Recuperação'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Divider + Google Sign-In */}
          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            <span className="shrink mx-3 text-[11px] uppercase tracking-wider text-slate-400 font-medium">
              ou
            </span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2.5 transition-colors cursor-pointer disabled:opacity-60"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>Continuar com Conta Google</span>
          </button>

          <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
            Acesso ilimitado a compilações Android e Windows · Sem planos nem limites.
          </p>
        </div>
      </div>
    </div>
  );
};
