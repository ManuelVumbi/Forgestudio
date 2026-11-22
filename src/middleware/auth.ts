import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const ADMIN_EMAIL = 'manuelumbavumbi@gmail.com';

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado: token em falta.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Erro ao verificar token Firebase:', error);
    return res.status(401).json({ error: 'Não autorizado: token inválido ou expirado.' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (
    !req.user ||
    !req.user.email_verified ||
    !req.user.email ||
    req.user.email.trim().toLowerCase() !== ADMIN_EMAIL
  ) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
};
