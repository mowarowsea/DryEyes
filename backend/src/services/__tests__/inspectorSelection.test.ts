// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProxyPage } from '../proxy.js';
import axios from 'axios';

vi.mock('axios');
vi.mock('../browserRender.js', async () => {
  const actual = await vi.importActual<typeof import('../browserRender.js')>('../browserRender.js');
  return { ...actual, renderPageHtml: vi.fn().mockRejectedValue(new Error('browser unavailable')) };
});

const dom: any = globalThis as any;

// 注入したスクリプトをプレビューと同じ形で動かし、要素をタップしたときに
// 親ウィンドウへ渡す中身を見る。組み立ての中身は elementPath.test.ts で確かめているので、
// ここは注入から postMessage までが繋がっていることの確認に絞る。
const runInspectorOn = async (bodyHtml: string) => {
  const raw = `<html><head></head><body>${bodyHtml}</body></html>`;
  (axios.get as any).mockResolvedValueOnce({ data: raw });

  const html = await fetchProxyPage('https://example.com/');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  dom.document.documentElement.innerHTML = raw;
  const messages: any[] = [];
  dom.window.parent = { postMessage: (message: any) => messages.push(message) };

  // 構文が壊れていればここで落ちる
  for (const script of scripts) new Function(script)();

  return {
    messages,
    click: (id: string) =>
      dom.document
        .getElementById(id)
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    selected: () => messages.filter((m) => m.type === 'DRYEYES_ELEMENT_SELECTED'),
  };
};

describe('プレビューで要素を選んだときに親へ渡す中身', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1件ずつ id が振られた一覧でも、まとめ選択の件数とテキストを返す', async () => {
    const inspector = await runInspectorOn(
      '<div id="chapterlist"><ul>' +
        '<li><a id="c177" href="/177">177話</a></li>' +
        '<li><a id="c176" href="/176">176話</a></li>' +
        '<li><a id="c175" href="/175">175話</a></li>' +
        '</ul></div>'
    );

    inspector.click('c177');

    const selected = inspector.selected();
    expect(selected).toHaveLength(1);
    expect(selected[0].payload.xpath).toBe('//*[@id="c177"]');
    expect(selected[0].payload.similarCount).toBe(3);
    expect(selected[0].payload.similarTexts).toEqual(['177話', '176話', '175話']);
  });

  it('並びが無い要素なら、まとめ選択は 1 件のまま', async () => {
    const inspector = await runInspectorOn('<div><h1 id="head">単品の見出し</h1><p>本文</p></div>');

    inspector.click('head');

    const payload = inspector.selected()[0].payload;
    expect(payload.similarCount).toBe(1);
    expect(payload.similarXPath).toBe(payload.xpath);
  });
});

// 同じサイトの他の監視から監視場所を引き継ぐとき、親はセレクタを渡して
// 「このページでも当たるか」を調べさせる。
describe('引き継ぎ候補の監視場所をこのページで調べる', () => {
  beforeEach(() => vi.clearAllMocks());

  const probe = (selectors: string[], requestId: number) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { type: 'DRYEYES_PROBE_SELECTORS', selectors, requestId },
      })
    );

  // 同じ window で前のテストの Inspector も生きていて同じ返事を重ねて返すので、
  // 件数ではなく通し番号で拾って中身を見る
  const resultFor = (inspector: { messages: any[] }, requestId: number) =>
    inspector.messages.find((m) => m.type === 'DRYEYES_PROBE_RESULT' && m.requestId === requestId);

  it('XPath でも CSS セレクタでも、件数と文字列を返して当たった要素を目立たせる', async () => {
    const inspector = await runInspectorOn(
      '<ul id="list"><li><a href="/1">第1話</a></li><li><a href="/2">第2話</a></li></ul>' +
        '<p id="other">本文</p>'
    );

    probe(['//*[@id="list"]/li/a'], 3);

    expect(resultFor(inspector, 3)).toMatchObject({ count: 2, texts: ['第1話', '第2話'] });
    expect(dom.document.querySelectorAll('.dryeyes-inspect-batch-highlight')).toHaveLength(2);

    probe(['#list li a'], 4);
    expect(resultFor(inspector, 4)).toMatchObject({ count: 2, texts: ['第1話', '第2話'] });
  });

  it('当たらなければ 0 件を返し、前のハイライトは消す', async () => {
    const inspector = await runInspectorOn('<ul id="list"><li><a href="/1">第1話</a></li></ul>');

    probe(['#list li a'], 11);
    expect(resultFor(inspector, 11)).toMatchObject({ count: 1 });

    probe(['//*[@id="nothing"]/a'], 12);
    expect(resultFor(inspector, 12)).toMatchObject({ count: 0, texts: [] });
    expect(dom.document.querySelectorAll('.dryeyes-inspect-batch-highlight')).toHaveLength(0);
  });
});
