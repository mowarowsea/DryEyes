import { Router } from 'express';
import { fetchProxyPage, getPageInfo } from '../services/proxy.js';
import { getFavicon } from '../services/favicon.js';

export const proxyRouter = Router();

proxyRouter.get('/info', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'url parameter is required' });
  }
  const info = await getPageInfo(targetUrl);
  res.json(info);
});

// 監視対象サイトのファビコン。ブラウザから直接読むと落とすサイトが多いので BFF が代理で取る。
proxyRouter.get('/favicon', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  const icon = await getFavicon(targetUrl);
  if (!icon) {
    // 取得できないサイトは画面側で代替アイコンにフォールバックする
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(404).end();
  }

  res.setHeader('Content-Type', icon.contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(icon.data);
});

proxyRouter.get('/page', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send('url parameter is required');
  }

  // 既定は軽い静的取得。画面側で「もうちょっと頑張って描画する」を押すと
  // render=browser が付き、クロールと同じブラウザで描画したものを返す。
  const useBrowser = req.query.render === 'browser';
  // ピッカーの枠だけ暗くてプレビューが真っ白、を避けるため画面の表示テーマを受け取る。
  // 指定が無ければ従来どおりページをそのまま出す。
  const dark = req.query.theme === 'dark';

  try {
    const html = await fetchProxyPage(targetUrl, useBrowser, dark);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: sans-serif; padding: 24px; color: ${dark ? '#fda4af' : '#e11d48'}; background: ${dark ? '#0f172a' : '#fff1f2'};">
          <h3>ページのプレビュー取得に失敗しました</h3>
          <p style="color: ${dark ? '#cbd5e1' : '#475569'}; font-size: 14px;">${err.message}</p>
          <p style="color: ${dark ? '#94a3b8' : '#64748b'}; font-size: 12px;">URLが正しいか、または外部からのアクセスが拒否されていないか確認してください。</p>
        </body>
      </html>
    `);
  }
});
