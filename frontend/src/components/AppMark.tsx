import React from 'react';

// アプリのマーク。絵柄の原本は public/favicon.svg（ファビコン・PWA アイコンと同じ）。
// 画面側で SVG を書き写さず画像として読んでいるのは、アイコンを描き直したときに
// ここだけ古い絵のまま取り残されるのを防ぐため。
// 配信パスがサブパス（例: /DryEyes/）になるので、URL は BASE_URL 起点で組み立てる。
export const AppMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <img
    src={`${import.meta.env.BASE_URL}favicon.svg`}
    alt=""
    aria-hidden="true"
    draggable={false}
    className={className}
  />
);
