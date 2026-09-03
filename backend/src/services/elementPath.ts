/**
 * プレビューへ注入して、選んだ要素の XPath を組み立てるコード。
 *
 * ブラウザの中だけで動くので、BFF 側の値は参照せずこの文字列だけで完結させる
 * （BFF の tsconfig には DOM の型が無いため、TS ではなく文字列で持つ）。
 * 組み立ての当たり外れは目で見て確かめにくいので、
 * __tests__/elementPath.test.ts で jsdom に読ませて確かめている。
 */
export const ELEMENT_PATH_HELPERS = String.raw`
  // 自前で付けたハイライト用のクラスは、ページの構造とは関係ないので使わない
  var DRYEYES_CLASS_PREFIX = 'dryeyes-';

  function tagOf(el) {
    return el.tagName.toLowerCase();
  }

  // 同じタグの兄弟の中で何番目か（XPath の添字は 1 始まり）
  function nthOfSameTag(el) {
    var n = 1;
    var sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) n++;
      sib = sib.previousElementSibling;
    }
    return n;
  }

  function sameTagSiblings(el) {
    var parent = el.parentElement;
    if (!parent) return [];
    return Array.prototype.filter.call(parent.children, function(child) {
      return child.tagName === el.tagName;
    });
  }

  // XPath に埋め込めるクラス名だけを拾う。
  // className を直接見ないのは、SVG だと文字列ではなくオブジェクトが返ってきて素通りするため。
  function classListOf(el) {
    var names = [];
    var list = el && el.classList;
    if (!list) return names;
    for (var i = 0; i < list.length; i++) {
      var name = list[i];
      if (!name || name.indexOf(DRYEYES_CLASS_PREFIX) === 0) continue;
      if (name.indexOf('"') !== -1) continue;
      names.push(name);
    }
    return names;
  }

  // クラス名の単語一致。contains(@class, "post") だと "post-ad" のような別物にも当たってしまう
  function classPredicate(name) {
    return '[contains(concat(" ", normalize-space(@class), " "), " ' + name + ' ")]';
  }

  function evaluateNodes(xpath) {
    var nodes = [];
    if (!xpath) return nodes;
    try {
      var res = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < res.snapshotLength; i++) {
        var node = res.snapshotItem(i);
        if (node && node.nodeType === 1) nodes.push(node);
      }
    } catch (e) {}
    return nodes;
  }

  // id はページで一意なはずだが、そうなっていないページもある。
  // 一意でない id を頼りにすると別の要素まで拾うので、確かめてから使う。
  function uniqueIdXPath(el) {
    var id = el.getAttribute && el.getAttribute('id');
    if (!id || id.indexOf('"') !== -1) return '';
    // 親をたどる途中で何度も通るので、まず安い getElementById で振るう
    if (document.getElementById(id) !== el) return '';
    var xpath = '//*[@id="' + id + '"]';
    return evaluateNodes(xpath).length === 1 ? xpath : '';
  }

  // 厳密な単一要素の XPath
  function getExactXPath(element) {
    if (!element || element.nodeType !== 1) return '';
    var byId = uniqueIdXPath(element);
    if (byId) return byId;
    if (element === document.body) return '/html/body';
    if (element === document.documentElement) return '/html';
    var parent = element.parentElement;
    if (!parent) return '';
    var parentPath = getExactXPath(parent);
    if (!parentPath) return '';
    return parentPath + '/' + tagOf(element) + '[' + nthOfSameTag(element) + ']';
  }

  // 選んだ要素自身を含み、複数に当たる書き方だけを「類似」として認める。
  // 自分が外れている書き方は、一覧をまとめたことにならない。
  function similarCandidate(xpath, element) {
    var nodes = evaluateNodes(xpath);
    if (nodes.length < 2 || nodes.indexOf(element) === -1) return null;
    return { xpath: xpath, count: nodes.length };
  }

  // 兄弟と分け合っているクラスだけを絞り込みに使う。
  // 一覧に混ざる広告など、毛色の違う兄弟を巻き込まないため。
  function classesSharedWithSiblings(el, siblings) {
    return classListOf(el).filter(function(name) {
      return siblings.some(function(sib) {
        return sib !== el && sib.classList && sib.classList.contains(name);
      });
    });
  }

  // 同じタグの兄弟が並んでいる階層を内側から探し、その階層の添字だけ外したパターンを作る。
  // 一覧の 1 件を選んだとき、一覧全体に当たる書き方はたいていここで見つかる。
  function repeatingPatternXPath(element) {
    var node = element;
    // 繰り返している階層から、選んだ要素までの下り道
    var relative = '';
    while (node && node !== document.body && node.parentElement) {
      var siblings = sameTagSiblings(node);
      if (siblings.length > 1) {
        var base = getExactXPath(node.parentElement);
        if (base) {
          var shared = classesSharedWithSiblings(node, siblings);
          var step = '/' + tagOf(node) + shared.map(classPredicate).join('');
          var found = similarCandidate(base + step + relative, element);
          // クラスで絞ったら自分しか残らないなら、同じタグの兄弟まで戻す
          if (!found && shared.length > 0) {
            found = similarCandidate(base + '/' + tagOf(node) + relative, element);
          }
          if (found) return found;
        }
      }
      relative = '/' + tagOf(node) + '[' + nthOfSameTag(node) + ']' + relative;
      node = node.parentElement;
    }
    return null;
  }

  // 一覧やグリッドの 1 件を選んだときに、同じ並びの要素すべてに当たる XPath を探す。
  // 見つからなければ厳密パスをそのまま返す（＝まとめ選択は出さない）。
  function getSimilarXPath(element, exactPath) {
    var single = { xpath: exactPath, count: 1 };
    if (!element || element.nodeType !== 1) return single;

    var tag = tagOf(element);
    var classes = classListOf(element);

    // 1. クラスの組み合わせが、そのまま同じ役割の要素を表していることが多い。
    //    ユーティリティクラスを並べるページでも、全部揃えて当てれば別物までは拾わない。
    if (classes.length > 0) {
      var byAllClasses = similarCandidate('//' + tag + classes.map(classPredicate).join(''), element);
      if (byAllClasses) return byAllClasses;
    }

    // 2. 並んでいる兄弟から構造で探す。
    //    要素自身が id を持つページ（<a id="chapter-177"> など）は厳密パスが id で止まり、
    //    添字を落とす 4. が何もできないので、ここが受け皿になる。
    var byStructure = repeatingPatternXPath(element);
    if (byStructure) return byStructure;

    // 3. クラス単体。汎用的なクラス 1 つで画面じゅうに当たると困るので、当たりが少ない方を採る。
    if (classes.length > 1) {
      var best = null;
      for (var i = 0; i < classes.length; i++) {
        var cand = similarCandidate('//' + tag + classPredicate(classes[i]), element);
        if (cand && (!best || cand.count < best.count)) best = cand;
      }
      if (best) return best;
    }

    // 4. 最後の手段として、厳密パスから添字を全部落として一般化する
    var generalized = exactPath.replace(/\[\d+\]/g, '');
    if (generalized !== exactPath) {
      var byPath = similarCandidate(generalized, element);
      if (byPath) return byPath;
    }

    return single;
  }
`;
