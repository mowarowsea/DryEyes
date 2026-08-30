import { NextFunction, Request, Response } from 'express';
import { resolveSession } from '../services/users.js';
import { UserRecord } from '../types/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRecord;
    }
  }
}

export function extractToken(req: Request): string {
  const header = req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

// ログイン済みでなければ 401。フロントは 401 を受け取ったらトークンを捨ててログイン画面へ戻す。
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = resolveSession(extractToken(req));
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'ログインが必要です' });
  }
  req.user = user;
  next();
}
