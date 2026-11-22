import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { DEFAULT_ENGINE_SETTINGS } from '../data/defaults';
import { auth, googleAuthProvider, testConnection } from '../lib/firebase';
import {
  ensureUserProfile,
  isAdminEmail,
  seedDefaultsIfAdmin,
  subscribeEngineSettings,
  subscribeUserBuilds,
  subscribeUserDownloads,
  subscribeUserProjects,
} from '../services/firestoreService';
import {
  AppProject,
  BuildJob,
  DownloadRecord,
  EngineSettings,
  UserProfile,
} from '../types/appforge';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  isAdmin: boolean;
  needsEmailVerification: boolean;
  engineSettings: EngineSettings;
  projects: AppProject[];
  builds: BuildJob[];
  downloads: DownloadRecord[];
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (displayName: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadUserVerification: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function translateAuthError(err: any): string {
  const code = err?.code || '';
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'O método Email/Senha ainda não está activado na Consola Firebase (Authentication → Sign-in method → Email/Password). Active-o ou entre com Conta Google.';
    case 'auth/invalid-email':
      return 'O endereço de email introduzido não é válido.';
    case 'auth/user-disabled':
      return 'Esta conta foi desactivada.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email ou senha incorrectos. Verifique os seus dados e tente novamente.';
    case 'auth/email-already-in-use':
      return 'Já existe uma conta registada com este endereço de email.';
    case 'auth/weak-password':
      return 'A senha é demasiado fraca. Utilize pelo menos 6 caracteres.';
    case 'auth/too-many-requests':
      return 'Demasiadas tentativas seguidas. Aguarde alguns minutos antes de tentar novamente.';
    case 'auth/popup-closed-by-user':
      return 'A janela de autenticação Google foi fechada antes de concluir.';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela popup de login Google. Permita popups para este site.';
    case 'auth/unauthorized-domain': {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      return `O domínio actual${host ? ` (${host})` : ''} não está autorizado na Consola Firebase (Authentication → Settings → Authorized domains). Adicione este domínio no Firebase ou inicie sessão com Email e Senha.`;
    }
    case 'auth/network-request-failed':
      return 'Sem ligação à Internet. Verifique a sua rede e tente novamente.';
    default:
      return err?.message || 'Não foi possível concluir a autenticação.';
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(DEFAULT_ENGINE_SETTINGS);
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);

  const loadVerifiedUser = async (fbUser: User) => {
    const prof = await ensureUserProfile({
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      photoURL: fbUser.photoURL,
      emailVerified: fbUser.emailVerified,
    });
    setProfile(prof);
    const adminFlag =
      prof.role === 'admin' || (fbUser.emailVerified && isAdminEmail(fbUser.email));
    await seedDefaultsIfAdmin(adminFlag);
    setAuthError(null);
  };

  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (!fbUser) {
        setProfile(null);
        setProjects([]);
        setBuilds([]);
        setDownloads([]);
        setLoading(false);
        return;
      }

      if (!fbUser.emailVerified) {
        setProfile(null);
        setProjects([]);
        setBuilds([]);
        setDownloads([]);
        setAuthError(null);
        setLoading(false);
        return;
      }

      try {
        await loadVerifiedUser(fbUser);
      } catch (err: any) {
        setAuthError(err.message || 'Erro ao carregar perfil.');
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const needsEmailVerification = Boolean(user && !user.emailVerified);

  const isAdmin = useMemo(() => {
    if (!user || !user.emailVerified) return false;
    return profile?.role === 'admin' || isAdminEmail(user.email);
  }, [user, profile]);

  useEffect(() => {
    if (!user || !user.emailVerified) return;
    const unsubEngine = subscribeEngineSettings(setEngineSettings);
    const unsubProjects = subscribeUserProjects(user.uid, isAdmin, setProjects);
    const unsubBuilds = subscribeUserBuilds(user.uid, isAdmin, setBuilds);
    const unsubDownloads = subscribeUserDownloads(user.uid, isAdmin, setDownloads);

    return () => {
      unsubEngine();
      unsubProjects();
      unsubBuilds();
      unsubDownloads();
    };
  }, [user, isAdmin]);

  const clearAuthError = () => setAuthError(null);

  const signInWithGoogle = async () => {
    setAuthError(null);
    googleAuthProvider.setCustomParameters({
      prompt: 'select_account',
    });
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: any) {
      const msg = translateAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      const msg = translateAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const registerWithEmail = async (displayName: string, email: string, password: string) => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 120) });
      }
      await sendEmailVerification(cred.user);
    } catch (err: any) {
      const msg = translateAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: any) {
      const msg = translateAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  };

  const reloadUserVerification = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    if (refreshed.emailVerified) {
      await refreshed.getIdToken(true);
      setUser({ ...refreshed } as User);
      await loadVerifiedUser(refreshed);
      return true;
    }
    return false;
  };

  const logout = async () => {
    setAuthError(null);
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (!user || !user.emailVerified) return;
    const prof = await ensureUserProfile({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified,
    });
    setProfile(prof);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        clearAuthError,
        isAdmin,
        needsEmailVerification,
        engineSettings,
        projects,
        builds,
        downloads,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resetPassword,
        resendVerificationEmail,
        reloadUserVerification,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.');
  return ctx;
}
