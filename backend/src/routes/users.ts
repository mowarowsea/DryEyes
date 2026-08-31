import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listOtherUsers } from '../services/users.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

// 監視のコピー先選択（コンボボックス/ボタン）に使う、自分以外のユーザー一覧
usersRouter.get('/', (req, res) => {
  res.json(listOtherUsers(req.user!.id));
});
