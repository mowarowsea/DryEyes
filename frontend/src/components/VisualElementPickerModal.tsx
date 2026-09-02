import React, { useState, useEffect } from 'react';
import {
  X,
  MousePointerClick,
  Check,
  AlertCircle,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
  Settings2,
  ShieldAlert,
  Sparkles,
  Expand,
} from 'lucide-react';
import { useEscapeToClose } from './Modal';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { apiUrl } from '../api';

// プレビューする iframe に与える権限。
//
// allow-same-origin は付けない。付けるとこのフレームが DryEyes 自身と同じオリジンになり、
// プレビュー中のページの JS から localStorage のログイントークンが読めてしまう。
// 外してもフレームは独立したオリジンになるだけで、Inspector とのやり取り
// （どちらも postMessage の宛先が '*'）はそのまま通る。
//
// 遷移まわりは「書いていないフラグ」が効いている。allow-top-navigation が無いので
// 画面ごとの遷移は、allow-popups が無いので別タブは、allow-forms が無いので
// フォーム送信は、どれもブラウザ側で止まる。残るのは「フレーム内で自分自身が
// 別ページに変わる」経路だけで、そこは注入した Inspector が受け持つ。
const PREVIEW_SANDBOX = 'allow-scripts';

interface SelectedElementData {
  xpath: string;
  similarXPath: string;
  similarCount: number;
  similarTexts?: string[];
  selector: string;
  text: string;
  tagName: string;
  /** まだ外側の親要素へ広げられるか */
  canExpand?: boolean;
}

interface VisualElementPickerModalProps {
  isOpen: boolean;
  targetUrl: string;
  /** 見出しの左に出す小さなラベル。登録ウィザードから開いたときの「Step 2/2」など。 */
  badge?: string;
  /** 確定ボタンのラベル。登録ウィザードでは「監視を登録する」になる。 */
  confirmLabel?: string;
  /** 要素を選ばずに確定できるか。登録時は「ページ全体を見張る」の意味になる。 */
  allowEmptySelection?: boolean;
  /** 確定処理の実行中はボタンを止める */
  submitting?: boolean;
  /** 確定に失敗したときのメッセージ */
  error?: string | null;
  /** 折りたたんで置く追加設定。登録ウィザードでは表示名やチェック間隔が入る。 */
  options?: React.ReactNode;
  onClose: () => void;
  /**
   * 選択した要素を親へ渡す。閉じるかどうかは親が決める
   * （除外の追加では開いたまま選び続けたいため）。
   */
  onSelectXPath: (xpath: string, extractedTexts: string[], isExclude: boolean) => void;
}

export const VisualElementPickerModal: React.FC<VisualElementPickerModalProps> = ({
  isOpen,
  targetUrl,
  badge,
  confirmLabel = 'OK',
  allowEmptySelection = false,
  submitting = false,
  error,
  options,
  onClose,
  onSelectXPath,
}) => {
  const [selectedElement, setSelectedElement] = useState<SelectedElementData | null>(null);
  const [targetMode, setTargetMode] = useState<'single' | 'similar'>('single');
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showOptions, setShowOptions] = useState(false);
  // 既定は素の HTML を出すだけの軽い描画。JS で後から出てくる部分（話数一覧など）が
  // 必要なときだけ、ボタンでクロールと同じブラウザに切り替える。
  const [renderMode, setRenderMode] = useState<'static' | 'browser'>('static');
  // ブラウザ描画を頼んだのに素の HTML が返ってきた（ブラウザに繋げなかった）
  const [browserRenderFailed, setBrowserRenderFailed] = useState(false);
  // プレビューするページも画面と同じテーマで出す。枠だけ暗くて中身が真っ白だと目に痛い。
  const isDark = useIsDarkTheme();

  // 登録／設定変更モーダルの上に重なるが、Esc では手前のこのピッカーだけが閉じる
  useEscapeToClose(isOpen, onClose);

  const sendHighlightToIframe = (xpath: string) => {
    const iframe = document.getElementById('dryeyes-preview-iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'DRYEYES_HIGHLIGHT_XPATH', xpath }, '*');
    }
  };

  // 開き直したときや対象が変わったときは、また軽い描画から始める
  useEffect(() => {
    if (!isOpen) return;
    setRenderMode('static');
    setBrowserRenderFailed(false);
  }, [isOpen, targetUrl]);

  // テーマを切り替えるとプレビューの URL が変わり iframe を読み込み直すので、その間は待たせる
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
  }, [isOpen, isDark]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;
      if (event.data.type === 'DRYEYES_ELEMENT_SELECTED') {
        const payload: SelectedElementData = event.data.payload;
        setSelectedElement(payload);
        setTargetMode('single');
        sendHighlightToIframe(payload.xpath);
      } else if (event.data.type === 'DRYEYES_RENDER_MODE') {
        // 頼んだ描画と返ってきた描画が食い違ったら、押しても変わらない理由を出す
        setBrowserRenderFailed(event.data.mode === 'static' && renderMode === 'browser');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, renderMode]);

  if (!isOpen) return null;

  const proxyUrl = apiUrl(
    `/proxy/page?url=${encodeURIComponent(targetUrl)}` +
      `&theme=${isDark ? 'dark' : 'light'}` +
      (renderMode === 'browser' ? '&render=browser' : '')
  );

  const reloadPreview = () => {
    setLoading(true);
    setSelectedElement(null);
    setIframeKey((k) => k + 1);
  };

  const handleRenderWithBrowser = () => {
    setBrowserRenderFailed(false);
    setRenderMode('browser');
    reloadPreview();
  };

  // 狙いより内側の要素（リンクの中の span など）を掴んでしまったときの逃げ道。
  // 選び直さずに一段ずつ外側へ広げる。結果は DRYEYES_ELEMENT_SELECTED で返ってくる。
  const handleExpandSelection = () => {
    const iframe = document.getElementById('dryeyes-preview-iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.postMessage({ type: 'DRYEYES_EXPAND_SELECTION' }, '*');
  };

  const handleToggleSimilar = (toSimilar: boolean) => {
    if (!selectedElement) return;
    setTargetMode(toSimilar ? 'similar' : 'single');
    const path = toSimilar && selectedElement.similarXPath ? selectedElement.similarXPath : selectedElement.xpath;
    sendHighlightToIframe(path);
  };

  const handleConfirm = (isExclude: boolean = false) => {
    if (!selectedElement) {
      // 要素を選ばずに確定できるのは登録時だけ。その場合はページ全体が対象になる。
      if (!isExclude && allowEmptySelection) onSelectXPath('', [], false);
      return;
    }

    const isSimilar = targetMode === 'similar';
    const finalXPath = isSimilar && selectedElement.similarXPath ? selectedElement.similarXPath : selectedElement.xpath;
    const texts = isSimilar && selectedElement.similarTexts && selectedElement.similarTexts.length > 0
      ? selectedElement.similarTexts
      : (selectedElement.text ? [selectedElement.text] : []);
    if (!finalXPath) return;

    onSelectXPath(finalXPath, texts, isExclude);

    // 除外はいくつも足せるようにしたいので、選択だけ解除して画面は開いたままにする
    if (isExclude) setSelectedElement(null);
  };

  const hasSimilarElements = (selectedElement?.similarCount ?? 0) > 1;
  // canExpand を返さない古いプレビューでも拡大を試せるようにしておく
  const canExpandSelection = !!selectedElement && selectedElement.canExpand !== false;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 w-full flex flex-col shadow-2xl overflow-hidden">

        {/* ヘッダー（最小化） */}
        <div className="px-3 py-2 bg-slate-900 text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            {badge && (
              <span className="px-2 py-0.5 bg-indigo-500/25 text-indigo-200 text-xs font-bold rounded-full flex-shrink-0">
                {badge}
              </span>
            )}
            <MousePointerClick className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <span className="text-xs font-bold truncate">要素を選択</span>
            <span className="text-[11px] text-slate-400 truncate hidden sm:inline">{targetUrl}</span>
          </div>
          <div className="flex items-center space-x-1 flex-shrink-0">
            <button
              onClick={reloadPreview}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="リロード"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* iframe プレビュー（残りの高さを全部使う） */}
        <div className="relative flex-1 bg-slate-100 dark:bg-slate-800 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">ページを読み込み中...</span>
              {/* ブラウザで開いて描画し終えるまで待つので、10 秒ほどかかる */}
              {renderMode === 'browser' && (
                <span className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  実際に表示される内容に合わせるため、少し時間がかかります
                </span>
              )}
            </div>
          )}

          {/* 素の HTML では出ない部分に気づいたとき用の逃げ道。
              重い描画は毎回やると 10 秒待たされるので、押されたときだけにする。 */}
          {!loading && renderMode === 'static' && (
            <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
              <button
                type="button"
                onClick={handleRenderWithBrowser}
                title="ページを実際のブラウザで開いて、JS で後から出てくる部分まで描画します"
                className="px-4 py-2.5 bg-slate-900/90 dark:bg-slate-800/95 text-white text-xs font-medium rounded-full shadow-lg backdrop-blur-sm border border-white/10 hover:bg-slate-900 transition flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-indigo-300 flex-shrink-0" />
                <span>表示されない部分がある？ もうちょっと頑張って描画する</span>
              </button>
            </div>
          )}

          {!loading && browserRenderFailed && (
            <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
              <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 text-xs rounded-xl shadow-lg border border-amber-200 dark:border-amber-500/30 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>ブラウザに繋げませんでした。Docker が動いているか確認してください</span>
              </div>
            </div>
          )}
          {/* 選ぶだけの画面なので、フォーム送信で遷移しないよう allow-forms は付けない */}
          <iframe
            id="dryeyes-preview-iframe"
            key={iframeKey}
            src={proxyUrl}
            onLoad={() => {
              setLoading(false);
              // テーマ切り替えなどで読み込み直したときに、選んでいた要素のハイライトを戻す
              if (selectedElement) {
                const path =
                  targetMode === 'similar' && selectedElement.similarXPath
                    ? selectedElement.similarXPath
                    : selectedElement.xpath;
                sendHighlightToIframe(path);
              }
            }}
            className="w-full h-full border-none bg-white dark:bg-slate-900"
            title="Page Preview"
            sandbox={PREVIEW_SANDBOX}
          />
        </div>

        {/* フッター（スマホの親指で押せるよう、選択の切り替え・設定・確定を縦に積む） */}
        <div className="px-3 py-2.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-2 flex-shrink-0">
          {error && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 選択後の操作。選び直さずに済むよう、拡大と類似まとめをその場に並べる。 */}
          {selectedElement && (canExpandSelection || hasSimilarElements) && (
            <div className="flex items-stretch gap-2">
              {canExpandSelection && (
                <button
                  type="button"
                  onClick={handleExpandSelection}
                  title="ひとつ外側の要素まで選択範囲を広げます"
                  className={`px-3 py-2.5 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition flex items-center justify-center gap-1.5 ${
                    hasSimilarElements ? 'flex-shrink-0' : 'flex-1'
                  }`}
                >
                  <Expand className="w-4 h-4 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="whitespace-nowrap">選択範囲を拡大</span>
                </button>
              )}

              {/* 一覧ものはここを押すかどうかで結果が大きく変わるので、はっきり見せる */}
              {hasSimilarElements && (
                <button
                  type="button"
                  onClick={() => handleToggleSimilar(targetMode !== 'similar')}
                  className={`flex-1 min-w-0 px-2.5 py-2.5 text-sm font-bold rounded-xl border-2 active:scale-95 transition flex items-center justify-center gap-2 ${
                    targetMode === 'similar'
                      ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-200 dark:shadow-none'
                      : 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-200 border-purple-300 dark:border-purple-500/50 hover:bg-purple-100 dark:hover:bg-purple-500/20'
                  }`}
                >
                  {targetMode === 'similar' ? (
                    <Check className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Layers className="w-4 h-4 flex-shrink-0 text-purple-500 dark:text-purple-300" />
                  )}
                  <span className="whitespace-nowrap">類似要素も選択</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[11px] font-bold ${
                      targetMode === 'similar'
                        ? 'bg-white/25 text-white'
                        : 'bg-purple-600 text-white'
                    }`}
                  >
                    {selectedElement?.similarCount}件
                  </span>
                </button>
              )}
            </div>
          )}

          {!selectedElement && (
            <span className="py-1 text-xs text-slate-400 dark:text-slate-500 flex items-center justify-center text-center">
              <AlertCircle className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
              {allowEmptySelection
                ? '見張りたい要素をタップ（選ばずに登録するとページ全体）'
                : '見張りたい要素をタップ'}
            </span>
          )}

          {/* 登録オプション（表示名・チェック間隔など）。既定では畳んでおく。 */}
          {options && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
              <button
                type="button"
                onClick={() => setShowOptions(!showOptions)}
                className="flex items-center justify-between w-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 py-1"
              >
                <span className="flex items-center">
                  <Settings2 className="w-3.5 h-3.5 mr-1 text-slate-400 dark:text-slate-500" />
                  オプション（表示名・チェック間隔・通知先）
                </span>
                {showOptions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showOptions && (
                <div className="mt-2 max-h-[45vh] overflow-y-auto p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-xl space-y-3 animate-fadeIn">
                  {options}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleConfirm(true)}
              disabled={!selectedElement || submitting}
              className="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 disabled:opacity-40 transition rounded-xl flex-shrink-0"
            >
              除外
            </button>
            <button
              onClick={() => handleConfirm(false)}
              disabled={(!selectedElement && !allowEmptySelection) || submitting}
              className="flex-1 px-4 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-40 transition rounded-xl shadow-sm flex items-center justify-center gap-1.5"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>登録中...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>
                    {targetMode === 'similar'
                      ? `${confirmLabel}（${selectedElement?.similarCount}件）`
                      : confirmLabel}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
