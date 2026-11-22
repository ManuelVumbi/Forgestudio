import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
} from 'firebase/firestore';
import { DEFAULT_ENGINE_SETTINGS } from '../data/defaults';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  AdminEngineSecrets,
  AppProject,
  AuditLog,
  BuildArtifact,
  BuildJob,
  BuildStatus,
  DownloadRecord,
  EngineSettings,
  UserProfile,
} from '../types/appforge';

export const ADMIN_EMAIL = 'manuelumbavumbi@gmail.com';

export function isAdminEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === ADMIN_EMAIL);
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureUserProfile(user: {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      // Ensure bootstrapped admin email gets admin role if upgraded
      if (user.emailVerified && isAdminEmail(user.email) && existing.role !== 'admin') {
        await updateDoc(ref, { role: 'admin', updatedAt: serverTimestamp() });
        return { ...existing, role: 'admin' };
      }
      return existing;
    }
    const isBootstrappedAdmin = user.emailVerified && isAdminEmail(user.email);
    const profile: Record<string, any> = {
      uid: user.uid,
      email: (user.email || 'utilizador@appforge.studio').slice(0, 200),
      displayName: (user.displayName || user.email?.split('@')[0] || 'Utilizador').slice(0, 120),
      role: isBootstrappedAdmin ? 'admin' : 'user',
      planId: 'free',
      accountStatus: 'active',
      storageUsedBytes: 0,
      buildsThisMonth: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (user.photoURL) {
      profile.photoURL = user.photoURL.slice(0, 500);
    }
    await setDoc(ref, profile);
    const createdSnap = await getDoc(ref);
    return createdSnap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function seedDefaultsIfAdmin(isAdmin: boolean): Promise<void> {
  if (!isAdmin) return;
  try {
    const settingsRef = doc(db, 'settings', 'engines');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      await setDoc(settingsRef, {
        ...DEFAULT_ENGINE_SETTINGS,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.warn('Seed de motores ignorado:', error);
  }
}

export function subscribeEngineSettings(onData: (settings: EngineSettings) => void) {
  const ref = doc(db, 'settings', 'engines');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_ENGINE_SETTINGS);
        return;
      }
      onData(snap.data() as EngineSettings);
    },
    (error) => handleFirestoreError(error, OperationType.GET, 'settings/engines')
  );
}

export function subscribeUserProjects(
  uid: string,
  isAdmin: boolean,
  onData: (projects: AppProject[]) => void
) {
  const q = isAdmin
    ? query(collection(db, 'projects'), orderBy('updatedAt', 'desc'), limit(100))
    : query(collection(db, 'projects'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AppProject);
      list.sort((a, b) => {
        const ta = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
        const tb = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
        return tb - ta;
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'projects')
  );
}

export function subscribeUserBuilds(
  uid: string,
  isAdmin: boolean,
  onData: (builds: BuildJob[]) => void
) {
  const q = isAdmin
    ? query(collection(db, 'builds'), orderBy('createdAt', 'desc'), limit(100))
    : query(collection(db, 'builds'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as BuildJob);
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'builds')
  );
}

export function subscribeUserDownloads(
  uid: string,
  isAdmin: boolean,
  onData: (downloads: DownloadRecord[]) => void
) {
  const q = isAdmin
    ? query(collection(db, 'downloads'), orderBy('downloadedAt', 'desc'), limit(100))
    : query(collection(db, 'downloads'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as DownloadRecord);
      list.sort((a, b) => {
        const ta = a.downloadedAt?.toMillis ? a.downloadedAt.toMillis() : 0;
        const tb = b.downloadedAt?.toMillis ? b.downloadedAt.toMillis() : 0;
        return tb - ta;
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'downloads')
  );
}

export async function saveProject(project: AppProject, isNew: boolean): Promise<void> {
  const ref = doc(db, 'projects', project.id);
  const path = `projects/${project.id}`;
  const payload: Record<string, any> = {
    id: project.id,
    ownerId: project.ownerId,
    ownerEmail: (project.ownerEmail || '').slice(0, 200),
    conversionType: project.conversionType,
    framework: project.framework,
    sourceBundleId: (project.sourceBundleId || '').slice(0, 128),
    appName: project.appName.trim().slice(0, 80),
    packageName: project.packageName.trim().toLowerCase().slice(0, 120),
    appIdentifier: project.appIdentifier.slice(0, 80),
    description: (project.description || '').slice(0, 500),
    versionName: (project.versionName || '1.0.0').slice(0, 30),
    versionCode: Math.max(1, Number(project.versionCode) || 1),
    author: (project.author || '').slice(0, 100),
    sourceUrl: (project.sourceUrl || '').slice(0, 500),
    category: (project.category || 'Geral').slice(0, 60),
    platforms: {
      androidApkDebug: Boolean(project.platforms.androidApkDebug),
      androidApkRelease: Boolean(project.platforms.androidApkRelease),
      androidAab: Boolean(project.platforms.androidAab),
      windowsExe: Boolean(project.platforms.windowsExe),
      windowsPortable: Boolean(project.platforms.windowsPortable),
      exportSourceCode: Boolean(project.platforms.exportSourceCode),
    },
    visual: project.visual,
    advanced: project.advanced,
    windowsConfig: project.windowsConfig,
    signing: {
      keystoreMode: project.signing.keystoreMode,
      keystoreId: project.signing.keystoreId || '',
      keystoreAlias: project.signing.keystoreAlias || 'appforge_release',
      packageSha256: project.signing.packageSha256 || '',
    },
    updatedAt: serverTimestamp(),
  };

  try {
    if (isNew) {
      payload.createdAt = serverTimestamp();
      await setDoc(ref, payload);
    } else {
      delete payload.ownerId;
      delete payload.ownerEmail;
      delete payload.id;
      delete payload.appIdentifier;
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function removeProject(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createBuildJobDoc(job: {
  id: string;
  projectId: string;
  ownerId: string;
  appName: string;
  versionName: string;
  targetFormats: string[];
}): Promise<void> {
  const path = `builds/${job.id}`;
  try {
    await setDoc(doc(db, 'builds', job.id), {
      id: job.id,
      projectId: job.projectId,
      ownerId: job.ownerId,
      appName: job.appName.slice(0, 80),
      versionName: job.versionName.slice(0, 30),
      targetFormats: job.targetFormats.slice(0, 10),
      status: 'queued' as BuildStatus,
      progress: 4,
      currentStep: 'Na fila de compilação isolada',
      logs: ['Aguardando disponibilidade de worker...'],
      artifacts: [],
      missingInfrastructure: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function syncBuildJobDoc(
  buildId: string,
  patch: {
    status: BuildStatus;
    progress: number;
    currentStep: string;
    logs: string[];
    artifacts: BuildArtifact[];
    missingInfrastructure: string[];
    errorMessage?: string;
    isTerminal?: boolean;
  }
): Promise<void> {
  const path = `builds/${buildId}`;
  const payload: Record<string, any> = {
    status: patch.status,
    progress: Math.min(100, Math.max(0, patch.progress)),
    currentStep: (patch.currentStep || 'Em processamento').slice(0, 200),
    logs: patch.logs.slice(-50),
    artifacts: patch.artifacts.slice(0, 10),
    missingInfrastructure: patch.missingInfrastructure.slice(0, 10),
    updatedAt: serverTimestamp(),
  };
  if (patch.errorMessage) {
    payload.errorMessage = patch.errorMessage.slice(0, 500);
  }
  if (patch.isTerminal) {
    payload.completedAt = serverTimestamp();
  }
  try {
    await updateDoc(doc(db, 'builds', buildId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordDownload(rec: {
  ownerId: string;
  buildId: string;
  projectId: string;
  appName: string;
  format: string;
  fileName: string;
  sizeBytes: number;
}): Promise<void> {
  const id = makeId('dl');
  const path = `downloads/${id}`;
  try {
    await setDoc(doc(db, 'downloads', id), {
      id,
      ownerId: rec.ownerId,
      buildId: rec.buildId,
      projectId: rec.projectId,
      appName: rec.appName.slice(0, 80),
      format: rec.format.slice(0, 40),
      fileName: rec.fileName.slice(0, 160),
      sizeBytes: Math.max(0, rec.sizeBytes),
      downloadedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function writeAuditLog(entry: {
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}): Promise<void> {
  const id = makeId('aud');
  const path = `auditLogs/${id}`;
  try {
    await setDoc(doc(db, 'auditLogs', id), {
      id,
      actorUid: entry.actorUid,
      actorEmail: entry.actorEmail.slice(0, 200),
      action: entry.action.slice(0, 100),
      targetType: entry.targetType.slice(0, 60),
      targetId: entry.targetId.slice(0, 128),
      details: entry.details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Falha ao registar auditoria:', error);
  }
}

// ---------------------------------------------------------------------------
// Admin Operations
// ---------------------------------------------------------------------------
export async function adminFetchAllUsers(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(200)));
    return snap.docs.map((d) => d.data() as UserProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function adminUpdateUser(
  uid: string,
  updates: Partial<Pick<UserProfile, 'role' | 'accountStatus'>>
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function adminFetchAuditLogs(): Promise<AuditLog[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(100))
    );
    return snap.docs.map((d) => d.data() as AuditLog);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'auditLogs');
  }
}

export async function adminSaveEngineSettings(settings: EngineSettings): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'engines'), {
      ...settings,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'settings/engines');
  }
}

export async function adminLoadSecrets(): Promise<AdminEngineSecrets | null> {
  try {
    const snap = await getDoc(doc(db, 'adminSecrets', 'engines'));
    return snap.exists() ? (snap.data() as AdminEngineSecrets) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'adminSecrets/engines');
  }
}

export async function adminSaveSecrets(secrets: AdminEngineSecrets): Promise<void> {
  try {
    await setDoc(doc(db, 'adminSecrets', 'engines'), {
      ...secrets,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'adminSecrets/engines');
  }
}
