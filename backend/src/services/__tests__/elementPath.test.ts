// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ELEMENT_PATH_HELPERS } from '../elementPath.js';

// 注入先はブラウザなので、jsdom に読ませて中の関数を取り出す。
// BFF の tsconfig には DOM の型が無いため、DOM まわりは any で扱う。
type El = any;

const helpers = new Function(
  ELEMENT_PATH_HELPERS + '\n  return { getExactXPath: getExactXPath, getSimilarXPath: getSimilarXPath };'
)() as {
  getExactXPath: (el: El) => string;
  getSimilarXPath: (el: El, exactPath: string) => { xpath: string; count: number };
};

const dom: any = globalThis as any;

const setBody = (html: string) => {
  dom.document.body.innerHTML = html;
};

const pick = (selector: string): El => {
  const el = dom.document.querySelector(selector);
  if (!el) throw new Error('テスト用の要素が見つかりません: ' + selector);
  return el;
};

const nodesOf = (xpath: string): El[] => {
  const res = dom.document.evaluate(
    xpath,
    dom.document,
    null,
    dom.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );
  const nodes: El[] = [];
  for (let i = 0; i < res.snapshotLength; i++) nodes.push(res.snapshotItem(i));
  return nodes;
};

// プレビューで要素をタップしたときと同じ手順で、まとめ選択用の XPath を求める
const similarFor = (selector: string) => {
  const element = pick(selector);
  const similar = helpers.getSimilarXPath(element, helpers.getExactXPath(element));
  return { ...similar, element, nodes: nodesOf(similar.xpath) };
};

const textsOf = (nodes: El[]) => nodes.map((n) => n.textContent.trim());

describe('getSimilarXPath', () => {
  it('1件ずつ id が振られた一覧でも、並び全体をまとめて選べる', () => {
    // 要素自身が id を持つと厳密パスが id で止まるので、添字を落とす手が効かない。
    // 話数一覧でまとめ選択が出ないのはこの形が多い。
    setBody(`
      <div id="chapterlist">
        <ul>
          <li><a id="c177" href="#">月刊少女野崎くん 177</a></li>
          <li><a id="c176" href="#">月刊少女野崎くん 176</a></li>
          <li><a id="c175" href="#">月刊少女野崎くん 175</a></li>
        </ul>
      </div>
    `);

    const similar = similarFor('#c177');

    expect(similar.count).toBe(3);
    expect(similar.nodes).toContain(similar.element);
    expect(textsOf(similar.nodes)).toEqual([
      '月刊少女野崎くん 177',
      '月刊少女野崎くん 176',
      '月刊少女野崎くん 175',
    ]);
  });

  it('クラスが無い素の一覧でも、繰り返している親から見つける', () => {
    setBody(`
      <div>
        <ul>
          <li><a href="#">第1話</a></li>
          <li><a href="#">第2話</a></li>
          <li><a href="#">第3話</a></li>
        </ul>
      </div>
    `);

    const similar = similarFor('li a');

    expect(similar.count).toBe(3);
    expect(textsOf(similar.nodes)).toEqual(['第1話', '第2話', '第3話']);
  });

  it('同じ行に並ぶ日付までは巻き込まない', () => {
    setBody(`
      <ul>
        <li><a href="#"><span class="chapternum">177</span><span class="chapterdate">09/2026</span></a></li>
        <li><a href="#"><span class="chapternum">176</span><span class="chapterdate">09/2026</span></a></li>
      </ul>
    `);

    const similar = similarFor('.chapternum');

    expect(similar.count).toBe(2);
    expect(textsOf(similar.nodes)).toEqual(['177', '176']);
  });

  it('クラス名の部分一致で別物を拾わない', () => {
    setBody(`
      <div>
        <a class="post" href="#">記事1</a>
        <a class="post" href="#">記事2</a>
        <a class="post-ad" href="#">広告</a>
      </div>
    `);

    const similar = similarFor('.post');

    expect(similar.count).toBe(2);
    expect(textsOf(similar.nodes)).toEqual(['記事1', '記事2']);
  });

  it('一覧に混ざった毛色の違う兄弟は外す', () => {
    setBody(`
      <div id="list">
        <div class="row"><a href="#">1話</a></div>
        <div class="row"><a href="#">2話</a></div>
        <div class="ad"><a href="#">広告</a></div>
      </div>
    `);

    const similar = similarFor('.row a');

    expect(similar.count).toBe(2);
    expect(textsOf(similar.nodes)).toEqual(['1話', '2話']);
  });

  it('ユーティリティクラスを並べたページでは、組み合わせを揃えて当てる', () => {
    setBody(`
      <div>
        <a class="text-sm font-bold card" href="#">A</a>
        <a class="text-sm font-bold card" href="#">B</a>
        <a class="text-sm" href="#">別物</a>
      </div>
    `);

    const similar = similarFor('.card');

    expect(similar.count).toBe(2);
    expect(textsOf(similar.nodes)).toEqual(['A', 'B']);
  });

  it('自分だけが持つクラスで絞り込みすぎない', () => {
    // 選択中の行にだけ付くクラス（active など）で絞ると自分しか残らないので、兄弟まで戻す
    setBody(`
      <ul>
        <li class="item active"><a href="#">1話</a></li>
        <li class="item"><a href="#">2話</a></li>
        <li class="item"><a href="#">3話</a></li>
      </ul>
    `);

    const similar = similarFor('.active');

    expect(similar.count).toBe(3);
    expect(textsOf(similar.nodes)).toEqual(['1話', '2話', '3話']);
  });

  it('並びが無い要素はまとめない', () => {
    setBody(`
      <div>
        <h1 class="title">単品の見出し</h1>
        <p>本文</p>
      </div>
    `);

    const element = pick('.title');
    const exact = helpers.getExactXPath(element);
    const similar = helpers.getSimilarXPath(element, exact);

    expect(similar.count).toBe(1);
    expect(similar.xpath).toBe(exact);
  });

  it('ハイライト用に付けた自前のクラスは目印にしない', () => {
    setBody(`
      <div>
        <a class="dryeyes-inspect-hover" href="#">1話</a>
        <a href="#">2話</a>
      </div>
    `);

    const similar = similarFor('.dryeyes-inspect-hover');

    expect(similar.xpath).not.toContain('dryeyes-');
    expect(similar.count).toBe(2);
  });
});

describe('getExactXPath', () => {
  it('一意な id があればそれで指す', () => {
    setBody('<div><p id="only">本文</p></div>');

    expect(helpers.getExactXPath(pick('#only'))).toBe('//*[@id="only"]');
  });

  it('id が重複しているページでは id を頼りにしない', () => {
    // 同じ id が複数あると、その要素だけを指したつもりが別の要素まで拾ってしまう
    setBody('<div><p id="dup">1つめ</p><p id="dup">2つめ</p></div>');

    const second = dom.document.querySelectorAll('#dup')[1];
    const xpath = helpers.getExactXPath(second);

    expect(nodesOf(xpath)).toEqual([second]);
  });
});
