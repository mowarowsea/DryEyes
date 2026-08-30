import { Router } from 'express';
import { fetchProxyPage, getPageInfo } from '../services/proxy.js';

export const proxyRouter = Router();

proxyRouter.get('/info', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'url parameter is required' });
  }
  const info = await getPageInfo(targetUrl);
  res.json(info);
});

proxyRouter.get('/page', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send('url parameter is required');
  }

  try {
    const html = await fetchProxyPage(targetUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: sans-serif; padding: 24px; color: #e11d48; background: #fff1f2;">
          <h3>ページのプレビュー取得に失敗しました</h3>
          <p style="color: #475569; font-size: 14px;">${err.message}</p>
          <p style="color: #64748b; font-size: 12px;">URLが正しいか、または外部からのアクセスが拒否されていないか確認してください。</p>
        </body>
      </html>
    `);
  }
});
