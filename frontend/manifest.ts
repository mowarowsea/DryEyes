// PWA マニフェスト。配信パス (base) が /DryEyes/ のようにサブパスになるため、
// URL はすべて base 込みの絶対パスで書き出す。
//
// 相対 URL（"./" など）でも仕様上は manifest の URL 基準で解決されるが、
// share_target の登録は Chrome / WebAPK 側の解釈に委ねる部分が大きいので、
// 曖昧さが残らないよう配信時に埋め込んでしまう。
export function buildManifest(base: string): Record<string, unknown> {
  return {
    name: 'DryEyes — Web Watcher',
    short_name: 'DryEyes',
    description: '見張り続けるとドライアイになるWebページを、代わりに見張る。',
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    // 新しめの Chrome は、インストールしたアプリ下部のナビバーをマニフェストの色で塗る。
    // マニフェストにはダーク用の色を書けないため、端末がダークモードでも薄い色の帯になり、
    // その上に白いボタンが乗って見えなくなっていた（Pixel 8a、2026-10-15）。
    // 日常利用の端末に合わせて暗い色に寄せる（起動時のスプラッシュも暗くなる）。
    background_color: '#020617',
    theme_color: '#4f46e5',
    lang: 'ja',
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: `${base}icons/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // ブラウザの共有シートから URL を受け取る口。
    // Vite の開発サーバーが `?url` を内部用クエリとして横取りするため、受け皿は `shared`。
    //
    // 受け口を start_url と分けて専用パスにしているのは、パラメータが落ちた場合でも
    // 「共有から開かれた」ことをパスだけで判別できるようにするため
    // （そのときは URL 空の登録モーダルを開いて、貼り付けから続けられる）。
    share_target: {
      action: `${base}share`,
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'shared' },
    },
    shortcuts: [
      {
        name: '監視を追加',
        short_name: '追加',
        url: `${base}?add=1`,
        icons: [{ src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
