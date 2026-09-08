import { Router } from 'express';
import { fetchProxyAsset, fetchProxyPage, getPageInfo } from '../services/proxy.js';
import { getFavicon } from '../services/favicon.js';
import { assertSafeProxyTarget } from '../services/urlSafety.js';
import { escapeHtml } from '../services/htmlMeta.js';
import { requireAuth } from '../middleware/auth.js';

export const proxyRouter = Router();

// <script> の中へ埋めるための文字列リテラル。JSON.stringify で引用符とバックスラッシュは済むが、
// 中身に </script> や <!-- が入っていると HTML の解析が切られるので、< も \u003c にしておく。
export const jsStringLiteral = (value: string): string =>
  JSON.stringify(value).replace(/</g, '\\u003c');

// ページ情報だけは画面から fetch で呼ぶ（＝ Authorization を付けられる）ので、
// ログイン必須にできる。プレビューとファビコンは iframe / <img> から読まれるため
// ヘッダーを足せず、認証の代わりに宛先チェックで守る。
proxyRouter.get('/info', requireAuth, async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'url parameter is required' });
  }
  try {
    await assertSafeProxyTarget(targetUrl);
  } catch (err: any) {
    return res.status(400).json({ error: 'Invalid url', message: err.message });
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

  try {
    await assertSafeProxyTarget(targetUrl);
  } catch {
    // 画面側は 404 と同じく代替アイコンへフォールバックする
    return res.status(400).end();
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

// プレビューのページが読む CSS とフォント。Inspector が <link rel="stylesheet"> をここへ向け直す。
// ウェブフォントは CORS 必須で、監視先サイト自身が配るフォントは別オリジンのプレビューから
// 読めない（アイコンフォントが「☒」になる）ため、BFF が代わりに取って CORS を許可して返す。
// iframe から読まれるので /page と同じく認証は付けられず、宛先チェックで守る。
proxyRouter.get('/asset', async (req, res) => {
  const targetUrl = req.query.url as string;
  const kind = req.query.kind === 'css' || req.query.kind === 'font' ? req.query.kind : null;
  if (!targetUrl || !kind) {
    return res.status(400).end();
  }

  try {
    await assertSafeProxyTarget(targetUrl);
  } catch {
    return res.status(400).end();
  }

  try {
    const asset = await fetchProxyAsset(targetUrl, kind);
    res.setHeader('Content-Type', asset.contentType);
    // 型は上で決めたものが全て。ブラウザに中身を嗅がせて HTML 扱いにさせない
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // プレビューの iframe は sandbox で独立オリジン (null) なので、フォントはこれが無いと読めない
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(asset.body);
  } catch (err: any) {
    // <link> の error イベントに落とす。Inspector が元の URL へ戻して従来どおり表示する
    console.warn(`[picker] ${kind} の代理取得に失敗しました (${targetUrl}):`, err?.message);
    res.status(502).end();
  }
});

proxyRouter.get('/page', async (req, res) => {
  const targetUrl = req.query.url as string;
  // 既定は軽い静的取得。画面側で「もうちょっと頑張って描画する」を押すと
  // render=browser が付き、クロールと同じブラウザで描画したものを返す。
  const useBrowser = req.query.render === 'browser';
  // ピッカーの枠だけ暗くてプレビューが真っ白、を避けるため画面の表示テーマを受け取る。
  // 指定が無ければ従来どおりページをそのまま出す。
  const dark = req.query.theme === 'dark';

  // エラーはこのページの中に文字として出す。URL も相手のエラーメッセージも
  // こちらで作った文字列ではないので、必ずエスケープしてから埋める。
  // 同じ理由をピッカーへも postMessage で知らせる（ピッカーは自分の枠で出し直す）。
  const errorPage = (message: string): string => `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: sans-serif; padding: 24px; color: ${dark ? '#fda4af' : '#e11d48'}; background: ${dark ? '#0f172a' : '#fff1f2'};">
          <h3>ページのプレビュー取得に失敗しました</h3>
          <p style="color: ${dark ? '#cbd5e1' : '#475569'}; font-size: 14px;">${escapeHtml(message)}</p>
          <p style="color: ${dark ? '#94a3b8' : '#64748b'}; font-size: 12px;">URLが正しいか、または外部からのアクセスが拒否されていないか確認してください。</p>
          <script>try{window.parent.postMessage({type:'DRYEYES_PREVIEW_ERROR',message:${jsStringLiteral(message)}},'*');}catch(e){}</script>
        </body>
      </html>
    `;

  if (!targetUrl) {
    return res.status(400).send('url parameter is required');
  }

  try {
    await assertSafeProxyTarget(targetUrl);
  } catch (err: any) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorPage(err.message));
  }

  try {
    const html = await fetchProxyPage(targetUrl, useBrowser, dark);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(errorPage(err.message));
  }
});
