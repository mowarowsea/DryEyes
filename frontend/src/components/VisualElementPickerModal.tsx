import React, { useState, useEffect } from 'react';
import { X, MousePointerClick, Check, AlertCircle, RefreshCw, Layers } from 'lucide-react';

interface SelectedElementData {
  xpath: string;
  similarXPath: string;
  similarCount: number;
  selector: string;
  text: string;
  tagName: string;
}

interface VisualElementPickerModalProps {
  isOpen: boolean;
  targetUrl: string;
  onClose: () => void;
  onSelectXPath: (xpath: string, extractedText: string, isExclude: boolean) => void;
}

export const VisualElementPickerModal: React.FC<VisualElementPickerModalProps> = ({
  isOpen,
  targetUrl,
  onClose,
  onSelectXPath,
}) => {
  const [selectedElement, setSelectedElement] = useState<SelectedElementData | null>(null);
  const [targetMode, setTargetMode] = useState<'single' | 'similar'>('single');
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);

  // iframeへのハイライト指示
  const sendHighlightToIframe = (xpath: string) => {
    const iframe = document.getElementById('dryeyes-preview-iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'DRYEYES_HIGHLIGHT_XPATH',
        xpath,
      }, '*');
    }
  };

  // iframeからのメッセージリスナー
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'DRYEYES_ELEMENT_SELECTED') {
        const payload: SelectedElementData = event.data.payload;
        setSelectedElement(payload);
        setTargetMode('single');
        // 最初は単一要素をハイライト
        sendHighlightToIframe(payload.xpath);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen]);

  if (!isOpen) return null;

  const proxyUrl = `/api/proxy/page?url=${encodeURIComponent(targetUrl)}`;

  // 「類似要素も監視」トグル切り替え
  const handleToggleSimilar = (toSimilar: boolean) => {
    if (!selectedElement) return;
    setTargetMode(toSimilar ? 'similar' : 'single');
    const path = toSimilar && selectedElement.similarXPath ? selectedElement.similarXPath : selectedElement.xpath;
    sendHighlightToIframe(path);
  };

  // 確定（OK）
  const handleConfirm = (isExclude: boolean = false) => {
    if (!selectedElement) return;
    const finalXPath = targetMode === 'similar' && selectedElement.similarXPath ? selectedElement.similarXPath : selectedElement.xpath;
    const extractedText = selectedElement.text || '';
    if (finalXPath) {
      onSelectXPath(finalXPath, extractedText, isExclude);
      onClose();
    }
  };

  const handleSkip = () => {
    onSelectXPath('', '', false);
    onClose();
  };

  const hasSimilarElements = (selectedElement?.similarCount ?? 0) > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-4xl h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
        {/* ヘッダー */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="p-1.5 bg-indigo-500 rounded-lg">
              <MousePointerClick className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold truncate">ステップ 2/3: 監視要素の選択</h2>
              <p className="text-[11px] text-slate-300 truncate">{targetUrl}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSkip}
              className="text-xs px-2.5 py-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
              title="ページ全体を監視して次へ"
            >
              ページ全体を監視して次へ →
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setSelectedElement(null);
                setIframeKey((k) => k + 1);
              }}
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

        {/* 操作ガイドバー */}
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 flex items-center justify-between text-xs text-indigo-900">
          <span className="flex items-center font-medium">
            <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping mr-2" />
            {targetMode === 'similar'
              ? '✨ 類似要素（全話数など）を一括ハイライト表示しています'
              : '画面上の見張りたい要素（話数・新着・価格など）をタップしてください'}
          </span>
          <span className="text-[11px] text-indigo-600 hidden sm:inline">
            ※類似要素ボタンで画面全体の対象箇所を確認できます
          </span>
        </div>

        {/* iframe プレビュー */}
        <div className="relative flex-1 bg-slate-100 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-xs text-slate-600 font-medium">ページを読み込み中...</span>
            </div>
          )}
          <iframe
            id="dryeyes-preview-iframe"
            key={iframeKey}
            src={proxyUrl}
            onLoad={() => setLoading(false)}
            className="w-full h-full border-none bg-white"
            title="Page Preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>

        {/* 選択された要素の確認 & 確定フッター */}
        <div className="p-3 sm:p-4 bg-white border-t border-slate-200 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-lg">
          <div className="flex-1 min-w-0">
            {selectedElement ? (
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 font-mono text-[10px] font-bold rounded">
                    &lt;{selectedElement.tagName}&gt;
                  </span>
                  <span className="text-xs font-semibold text-slate-800 truncate">
                    {selectedElement.text || '(テキストなし)'}
                  </span>
                  {hasSimilarElements && (
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-semibold rounded-full">
                      類似要素 {selectedElement.similarCount} 件検出
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-slate-600 truncate" title={targetMode === 'similar' ? selectedElement.similarXPath : selectedElement.xpath}>
                  対象XPath: <span className={targetMode === 'similar' ? 'text-purple-700 font-semibold' : 'text-indigo-600 font-semibold'}>
                    {targetMode === 'similar' ? selectedElement.similarXPath : selectedElement.xpath}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center text-xs text-slate-400">
                <AlertCircle className="w-4 h-4 mr-1.5 text-slate-400 flex-shrink-0" />
                <span>まだ要素が選択されていません。上のプレビュー画面でタップしてください。</span>
              </div>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* 類似要素切り替えボタン */}
            {hasSimilarElements && (
              <button
                type="button"
                onClick={() => handleToggleSimilar(targetMode !== 'similar')}
                disabled={!selectedElement}
                className={`px-3.5 py-2 text-xs font-medium rounded-xl border transition flex items-center space-x-1.5 ${
                  targetMode === 'similar'
                    ? 'bg-purple-50 text-purple-700 border-purple-300 ring-2 ring-purple-500/20'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Layers className={`w-3.5 h-3.5 ${targetMode === 'similar' ? 'text-purple-600' : 'text-slate-400'}`} />
                <span>
                  {targetMode === 'similar'
                    ? `類似要素（${selectedElement?.similarCount}件）をハイライト中`
                    : `類似要素も監視（${selectedElement?.similarCount}件をハイライト）`}
                </span>
              </button>
            )}

            <button
              onClick={() => handleConfirm(true)}
              disabled={!selectedElement}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-95 disabled:opacity-40 transition rounded-xl"
            >
              除外に設定
            </button>

            {/* OK・決定ボタン */}
            <button
              onClick={() => handleConfirm(false)}
              disabled={!selectedElement}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-40 transition rounded-xl shadow-sm shadow-indigo-200 flex items-center justify-center space-x-1.5"
            >
              <Check className="w-4 h-4" />
              <span>
                {targetMode === 'similar'
                  ? `OK（類似${selectedElement?.similarCount}件を監視）`
                  : 'OK（この要素を監視）'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
