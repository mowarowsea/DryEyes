import { Router } from 'express';
import {
  AuthError,
  countUsers,
  createSession,
  createUser,
  revokeSession,
  toPublicUser,
  verifyCredentials,
} from '../services/users.js';
import { claimUnowned } from '../services/ownership.js';
import { changedetectionClient } from '../services/changedetection.js';
import { extractToken, requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

export const authRouter = Router();

// フロントが「初回起動（=まだ誰も登録していない）」を判定するための公開エンドポイント
authRouter.get('/status', (_req, res) => {
  res.json({ hasUsers: countUsers() > 0 });
});

authRouter.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const isFirstUser = countUsers() === 0;
    const user = createUser(username, password);

    // ログイン機能の導入前に作られた監視は所有者が居ない。
    // 最初のユーザーがそのまま引き継ぐことで、既存の監視が見えなくなるのを防ぐ。
    if (isFirstUser) {
      try {
        const existing = await changedetectionClient.listWatches();
        const claimed = claimUnowned(existing.map((w) => w.id), user.id);

        // 引き継いだ監視は通知先も古いトピックのままなので、引き継ぎ先ユーザーの
        // トピックへ付け替える。そうしないと本人のトピックに通知が届かない。
        for (const id of claimed) {
          try {
            await changedetectionClient.updateWatch(id, { notificationTopic: '' }, user.ntfyTopic);
          } catch (err: any) {
            console.warn(`[DryEyes BFF] 監視 ${id} の通知先付け替えに失敗しました:`, err.message);
          }
        }

        if (claimed.length > 0) {
          console.log(
            `[DryEyes BFF] 既存の監視 ${claimed.length} 件を ${user.username} に引き継ぎ、` +
              `通知先を ${user.ntfyTopic} に付け替えました`
          );
        }
      } catch (err: any) {
        // 引き継ぎに失敗してもユーザー登録自体は成功させる
        console.warn('[DryEyes BFF] 既存監視の引き継ぎに失敗しました:', err.message);
      }
    }

    const session = createSession(user.id);
    res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: toPublicUser(user) });
  } catch (err: any) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({ error: 'Failed to register', message: err.message });
  }
});

authRouter.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = verifyCredentials(username, password);
    const session = createSession(user.id);
    res.json({ token: session.token, expiresAt: session.expiresAt, user: toPublicUser(user) });
  } catch (err: any) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({ error: 'Failed to login', message: err.message });
  }
});

// ブラウザに保存済みのトークンで前回のユーザーを復元する
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    user: toPublicUser(req.user!),
    ntfy: {
      baseUrl: config.ntfy.baseUrl,
      topic: req.user!.ntfyTopic,
      subscribeUrl: `${config.ntfy.baseUrl.replace(/\/$/, '')}/${req.user!.ntfyTopic}`,
    },
  });
});

authRouter.post('/logout', (req, res) => {
  revokeSession(extractToken(req));
  res.json({ success: true });
});
