import { describe, it, expect } from 'vitest';
import { jsStringLiteral } from '../../routes/proxy.js';

// プレビュー取得に失敗したときのエラーページは、理由を <script> の中からピッカーへ postMessage する。
// 理由の文字列は相手サイトのエラーメッセージなど外から来たものなので、
// HTML の解析を壊さずに埋められることを確かめる。
describe('jsStringLiteral', () => {
  it('引用符や改行を含む文字列を JS の文字列リテラルにする', () => {
    const literal = jsStringLiteral('取得に失敗: "timeout"\n(details)');
    expect(new Function(`return ${literal}`)()).toBe('取得に失敗: "timeout"\n(details)');
  });

  it('</script> を含んでいても script 要素を閉じられない', () => {
    const literal = jsStringLiteral('</script><img src=x onerror=alert(1)>');
    expect(literal).not.toContain('<');
    expect(new Function(`return ${literal}`)()).toBe('</script><img src=x onerror=alert(1)>');
  });
});
