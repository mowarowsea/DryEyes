import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Layers, Loader2, Signpost, TriangleAlert } from 'lucide-react';
import { RedirectDecisionOptions, WatchModel } from '../types';
import { Modal } from './Modal';
import { cancelButtonClass, submitButtonClass } from '../ui';

interface RedirectReviewModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  // 同じ転送で確認待ちになっている他の監視の数。1 件以上あれば、答えはまとめて効く。
  similarCount?: number;
  onClose: () => void;
  onAccept: (id: string, options: RedirectDecisionOptions) => Promise<void>;
  onDismiss: (id: string, options: RedirectDecisionOptions) => Promise<void>;
}

// URL を「ホスト」と「それ以外」に割る。
// 移転で本当に効くのはホストの入れ替わりなので、そこだけは必ず単体で読めるようにする。
function splitUrl(raw: string): { host: string; rest: string } {
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.host,
      rest: `${parsed.pathname}${parsed.search}${parsed.hash}` || '/',
    };
  } catch {
    return { host: raw, rest: '' };
  }
}

// punycode のままのホスト。表示を元の文字へ戻すと、見た目がそっくりな別ドメイン
// （exampIe.com のような字面の細工）を目視で見分けられなくなるので、変換せずそのまま出す。
const isPunycode = (host: string): boolean => /(^|\.)xn--/i.test(host);

const rowClass = 'px-3 py-2 rounded-xl border text-xs break-all';

export const RedirectReviewModal: React.FC<RedirectReviewModalProps> = ({
  watch,
  isOpen,
  similarCount = 0,
  onClose,
  onAccept,
  onDismiss,
}) => {
  const [always, setAlways] = useState(false);
  const [onlyThis, setOnlyThis] = useState(false);
  const [submitting, setSubmitting] = useState<'accept' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 別の監視の確認を開いたときに、前回のチェック状態を持ち越さない
  useEffect(() => {
    if (!isOpen) return;
    setAlways(false);
    setOnlyThis(false);
    setError(null);
    setSubmitting(null);
  }, [isOpen, watch?.id]);

  const proposal = watch?.pendingRedirect;
  if (!isOpen || !watch || !proposal) return null;

  const from = splitUrl(proposal.fromUrl);
  const to = splitUrl(proposal.toUrl);
  const restChanged = from.rest !== to.rest;
  const hops = proposal.chain.length > 2 ? proposal.chain.slice(1, -1) : [];
  // まとめて処理するとき、答えが効く監視の数（この監視を含む）
  const bulk = similarCount > 0 && !onlyThis;
  const affected = bulk ? similarCount + 1 : 1;

  const run = async (action: 'accept' | 'dismiss') => {
    try {
      setSubmitting(action);
      setError(null);
      // 画面で「まとめて処理します」と見せたときだけ、他の監視にも効かせる。
      // 一覧の取り直しで同じ転送が増えていても、見せていないものを巻き込まない。
      const options: RedirectDecisionOptions = { always, onlyThis: !bulk };
      if (action === 'accept') {
        await onAccept(watch.id, options);
      } else {
        await onDismiss(watch.id, options);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || '処理に失敗しました');
      setSubmitting(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="監視先を変更しますか？"
      subtitle={watch.title}
      error={error}
      icon={<Signpost className="w-5 h-5 text-amber-500 flex-shrink-0" />}
    >
      <div className="p-5 space-y-3 overflow-y-auto">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          チェックしたところ、監視中のURLが別のURLへ転送されていました。
          変更するまで、監視先は今までのURLのままです。
        </p>

        {/* ホストの入れ替わりを最初に、独立して見せる */}
        <div>
          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
            {proposal.hostChanged ? '別のドメインへ転送されています' : '同じドメイン内での移動です'}
          </div>
          <div className="space-y-1.5">
            <div
              className={`${rowClass} bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
            >
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mr-1.5">
                現在
              </span>
              <span className="font-mono line-through decoration-slate-300 dark:decoration-slate-600">
                {from.host}
              </span>
            </div>
            <div className="flex justify-center">
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 rotate-90" />
            </div>
            <div
              className={`${rowClass} ${
                proposal.hostChanged
                  ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              <span className="text-[10px] font-medium opacity-70 mr-1.5">転送先</span>
              <span className="font-mono font-bold text-sm">{to.host}</span>
            </div>
          </div>
        </div>

        {/* パス以降は変わったときだけ出す。ホストの行を埋もれさせないため。 */}
        {restChanged && (
          <div className="text-[11px] space-y-1">
            <div className="font-semibold text-slate-700 dark:text-slate-200">ページの場所</div>
            <div className="font-mono text-slate-400 dark:text-slate-500 break-all line-through">
              {from.rest}
            </div>
            <div className="font-mono text-slate-700 dark:text-slate-200 break-all">{to.rest}</div>
          </div>
        )}

        {hops.length > 0 && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold">経由:</span>
            <span className="font-mono break-all"> {hops.join(' → ')}</span>
          </div>
        )}

        {/* 判断材料。転送の種類と、遷移先が何のページか */}
        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
            <span className="font-semibold flex-shrink-0">転送の種類:</span>
            <span>
              {proposal.permanent
                ? `恒久的な移転 (${proposal.status})`
                : `一時的な転送 (${proposal.status})。メンテナンスやログイン要求の可能性があります`}
            </span>
          </div>

          {proposal.toTitle && (
            <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="font-semibold flex-shrink-0">転送先の見出し:</span>
              <span className="break-all">{proposal.toTitle}</span>
            </div>
          )}
        </div>

        {proposal.selectorFound === false && (
          <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-1.5 leading-relaxed">
            <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              転送先には、この監視が見ている要素が見つかりませんでした。
              内容が別のページに入れ替わっているかもしれません。
            </span>
          </div>
        )}

        {proposal.selectorFound === true && (
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-[11px] text-emerald-700 dark:text-emerald-300 flex items-start gap-1.5">
            <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>転送先でも、この監視が見ている要素が見つかりました。</span>
          </div>
        )}

        {(isPunycode(to.host) || isPunycode(from.host)) && (
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5 leading-relaxed">
            <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              日本語などを含むドメイン名（punycode）です。見た目がそっくりな別ドメインのことがあるため、
              変換せずそのまま表示しています。
            </span>
          </div>
        )}

        {/* 同じ転送の確認待ちが他にもあれば、答えはまとめて効く。サイト丸ごとの移転で 1 件ずつ答えさせない。 */}
        {similarCount > 0 && (
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-[11px] text-indigo-900 dark:text-indigo-200 space-y-1.5 leading-relaxed">
            <div className="flex items-start gap-1.5">
              <Layers className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                同じ転送（
                <span className="font-mono">{from.host}</span> →{' '}
                <span className="font-mono">{to.host}</span>
                ）で確認待ちの監視が、ほかに {similarCount} 件あります。まとめて処理します。
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyThis}
                onChange={(e) => setOnlyThis(e.target.checked)}
                className="accent-indigo-600"
              />
              <span>この監視だけを処理する</span>
            </label>
          </div>
        )}

        <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => setAlways(e.target.checked)}
            className="mt-0.5 accent-indigo-600"
          />
          <span>
            この転送は今後たずねない
            <span className="block text-slate-400 dark:text-slate-500">
              あなたのほかの監視も含めて、変更するなら以後は自動で切り替え、変更しないなら以後は知らせません。
            </span>
          </span>
        </label>

        <div className="pt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => run('dismiss')}
            disabled={submitting !== null}
            className={cancelButtonClass}
          >
            {submitting === 'dismiss' ? '処理中...' : '変更しない'}
          </button>
          <button
            type="button"
            onClick={() => run('accept')}
            disabled={submitting !== null}
            className={submitButtonClass}
          >
            {submitting === 'accept' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {submitting === 'accept'
              ? '変更中...'
              : affected > 1
                ? `${affected}件の監視先を変更`
                : '監視先を変更'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
