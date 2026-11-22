import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  cancelBuildJob,
  enqueueBuildJob,
  getBuildJobStatus,
  probeInfrastructure,
  resolveArtifactFile,
} from './server/buildEngine.ts';
import {
  generateAndroidKeystore,
  listUserKeystores,
  saveUploadedKeystore,
} from './server/keystoreManager.ts';
import { captureWebsiteOfflineBundle } from './server/offlineCrawler.ts';
import { processUploadedProjectFiles } from './server/uploadManager.ts';
import { ensureAllToolchains } from './server/toolchainBootstrap.ts';
import { analyzeTargetUrl } from './server/urlAnalyzer.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { AuthRequest, requireAuth } from './src/middleware/auth.ts';
import { AppProject } from './src/types/appforge.ts';

const PORT = 3000;
const app = express();

app.use(express.json({ limit: '5mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 40,
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'appforge-studio', timestamp: new Date().toISOString() });
});

app.post('/api/analyze-url', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Informe um URL válido.' });
    }
    const result = await analyzeTargetUrl(url);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Não foi possível analisar o website.' });
  }
});

app.post('/api/capture-offline', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Informe um URL válido para captura offline.' });
    }
    const summary = await captureWebsiteOfflineBundle(req.user!.uid, url);
    res.json(summary);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Falha ao converter website para modo offline.' });
  }
});

app.post(
  '/api/upload-project',
  requireAuth,
  upload.array('files', 40),
  async (req: AuthRequest, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || !files.length) {
        return res.status(400).json({ error: 'Nenhum ficheiro foi enviado.' });
      }
      const summary = await processUploadedProjectFiles(
        req.user!.uid,
        files.map((f) => ({
          originalname: f.originalname,
          buffer: f.buffer,
          mimetype: f.mimetype,
        }))
      );
      res.json(summary);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Falha ao processar ficheiros.' });
    }
  }
);

app.get('/api/keystores', requireAuth, async (req: AuthRequest, res) => {
  try {
    const items = await listUserKeystores(req.user!.uid);
    res.json({ keystores: items });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao listar keystores.' });
  }
});

app.post('/api/keystores/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { alias, password, commonName, organization, country } = req.body || {};
    const metadata = await generateAndroidKeystore({
      ownerId: req.user!.uid,
      alias: alias || 'appforge_release',
      password: password || '',
      commonName: commonName || 'AppForge Studio App',
      organization: organization || 'AppForge Developer',
      country: country || 'PT',
    });
    res.json({ keystore: metadata });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao gerar Keystore.' });
  }
});

app.post(
  '/api/keystores/upload',
  requireAuth,
  upload.single('keystore'),
  async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'Selecione um ficheiro .keystore, .jks ou .p12.' });
      }
      const { alias, password } = req.body || {};
      const metadata = await saveUploadedKeystore({
        ownerId: req.user!.uid,
        alias: alias || 'custom_key',
        password: password || '',
        fileName: file.originalname,
        buffer: file.buffer,
      });
      res.json({ keystore: metadata });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Erro ao carregar Keystore.' });
    }
  }
);

app.get('/api/infrastructure/probe', requireAuth, async (req: AuthRequest, res) => {
  try {
    const androidWorkerUrl =
      typeof req.query.androidWorkerUrl === 'string' ? req.query.androidWorkerUrl : undefined;
    const windowsWorkerUrl =
      typeof req.query.windowsWorkerUrl === 'string' ? req.query.windowsWorkerUrl : undefined;
    const probe = await probeInfrastructure({ androidWorkerUrl, windowsWorkerUrl });
    res.json(probe);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Falha ao verificar infraestrutura.' });
  }
});

app.post('/api/builds/start', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { project, workerConfig } = req.body as {
      project?: AppProject;
      workerConfig?: { androidWorkerUrl?: string; windowsWorkerUrl?: string; workerToken?: string };
    };
    if (!project || !project.id || !project.appName || !project.packageName) {
      return res.status(400).json({ error: 'Configuração de projecto inválida.' });
    }

    const sanitizedProject: AppProject = {
      ...project,
      ownerId: req.user!.uid,
      ownerEmail: req.user!.email || project.ownerEmail,
    };

    const runtime = enqueueBuildJob(sanitizedProject, workerConfig);
    res.json({ build: runtime });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Erro ao iniciar compilação.' });
  }
});

app.get('/api/builds/:buildId/status', requireAuth, (req: AuthRequest, res) => {
  const buildId = String(req.params.buildId);
  const job = getBuildJobStatus(buildId, req.user!.uid);
  if (!job) {
    return res.status(404).json({ error: 'Compilação não encontrada.' });
  }
  res.json({ build: job });
});

app.post('/api/builds/:buildId/cancel', requireAuth, (req: AuthRequest, res) => {
  const buildId = String(req.params.buildId);
  const cancelled = cancelBuildJob(buildId, req.user!.uid);
  if (!cancelled) {
    return res.status(404).json({ error: 'Compilação não encontrada.' });
  }
  res.json({ ok: true });
});

app.get('/api/artifacts/:buildId/:fileName', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split('Bearer ')[1]
        : queryToken;

    if (!token) {
      return res.status(401).json({ error: 'Autenticação necessária para descarregar o ficheiro.' });
    }
    const decoded = await adminAuth.verifyIdToken(token);
    const buildId = String(req.params.buildId);
    const fileName = String(req.params.fileName);

    const filePath = await resolveArtifactFile(decoded.uid, buildId, fileName);
    if (!filePath) {
      return res.status(404).json({ error: 'Ficheiro não encontrado ou expirado.' });
    }
    res.download(filePath, path.basename(filePath));
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Token inválido.' });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distDir)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AppForge Studio server listening on http://0.0.0.0:${PORT}`);
    ensureAllToolchains().catch((err) => console.warn('Toolchain warmup warning:', err));
  });
}

startServer();
