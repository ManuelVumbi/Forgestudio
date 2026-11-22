import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, Shield, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  apiGenerateKeystore,
  apiListKeystores,
  apiUploadKeystore,
} from '../services/apiClient';
import { writeAuditLog } from '../services/firestoreService';
import { KeystoreMetadata } from '../types/appforge';

export const KeystoresView: React.FC = () => {
  const { user } = useAuth();
  const [keystores, setKeystores] = useState<KeystoreMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [alias, setAlias] = useState('appforge_release');
  const [password, setPassword] = useState('');
  const [commonName, setCommonName] = useState('AppForge Studio Release');
  const [organization, setOrganization] = useState('AppForge Developer');
  const [country, setCountry] = useState('PT');

  const [uploadAlias, setUploadAlias] = useState('release_key');
  const [uploadPassword, setUploadPassword] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const loadKeystores = async () => {
    setLoading(true);
    try {
      const items = await apiListKeystores();
      setKeystores(items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeystores();
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const ks = await apiGenerateKeystore({
        alias,
        password: password || 'AppForge2026!',
        commonName,
        organization,
        country,
      });
      setKeystores((prev) => [ks, ...prev]);
      setSuccessMsg(`Keystore PKCS#12 "${ks.alias}" gerada e encriptada com AES-256-GCM.`);
      if (user) {
        await writeAuditLog({
          actorUid: user.uid,
          actorEmail: user.email || '',
          action: 'KEYSTORE_GENERATED',
          targetType: 'keystore',
          targetId: ks.keystoreId,
          details: `Alias ${ks.alias} (${ks.sha256Fingerprint.slice(0, 23)}...)`,
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setError('Seleccione um ficheiro .keystore, .jks ou .p12.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const ks = await apiUploadKeystore(uploadFile, uploadAlias, uploadPassword);
      setKeystores((prev) => [ks, ...prev]);
      setUploadFile(null);
      setUploadPassword('');
      setSuccessMsg(`Certificado "${ks.fileName}" armazenado de forma encriptada.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Keystores e Assinatura Digital Android
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Gere certificados RSA-2048 PKCS#12 ou carregue uma Keystore existente para assinar APK Release e AAB com identidade preservada entre actualizações.
        </p>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-xl px-4 py-3 text-sm">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleGenerate}
          className="border border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-white dark:bg-slate-900 space-y-4"
        >
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Plus className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Gerar Nova Keystore</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Alias da Chave</label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Palavra-passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mín. 8 caracteres"
                required
                minLength={6}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Nome Comum (CN)</label>
              <input
                type="text"
                value={commonName}
                onChange={(e) => setCommonName(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Organização (O)</label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="w-32">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">País (ISO 2)</label>
            <input
              type="text"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg font-mono uppercase bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-slate-900 dark:bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-60"
          >
            Gerar Keystore PKCS#12
          </button>
        </form>

        <form
          onSubmit={handleUpload}
          className="border border-slate-200 dark:border-slate-800 rounded-xl p-6 bg-white dark:bg-slate-900 space-y-4"
        >
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Upload className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Carregar Keystore Existente</h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Ficheiro (.keystore, .jks, .p12)
            </label>
            <input
              type="file"
              accept=".keystore,.jks,.p12,.pfx"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-900 dark:file:text-white hover:file:bg-slate-200 dark:hover:file:bg-slate-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Alias</label>
              <input
                type="text"
                value={uploadAlias}
                onChange={(e) => setUploadAlias(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Palavra-passe</label>
              <input
                type="password"
                value={uploadPassword}
                onChange={(e) => setUploadPassword(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-60"
          >
            Carregar e Encriptar
          </button>
        </form>
      </div>

      {/* Keystore Inventory */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Certificados Armazenados</h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {keystores.length} chaves
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500 dark:text-slate-400">A carregar keystores...</div>
        ) : keystores.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhuma Keystore criada ainda. Gere ou carregue uma acima para assinar lançamentos na Google Play.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 font-medium">Alias / Ficheiro</th>
                  <th className="py-3 px-4 font-medium">Organização</th>
                  <th className="py-3 px-4 font-medium">SHA-256 Fingerprint</th>
                  <th className="py-3 px-4 font-medium">Modo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {keystores.map((ks) => (
                  <tr key={ks.keystoreId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white font-mono">{ks.alias}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{ks.fileName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{ks.organization}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {ks.sha256Fingerprint}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                      {ks.mode === 'auto_managed' ? 'Gerada (PKCS#12)' : 'Carregada'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
