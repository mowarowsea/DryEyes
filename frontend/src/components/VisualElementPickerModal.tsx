import React, { useState, useEffect } from 'react';
import { X, MousePointerClick, Check, AlertCircle, RefreshCw, Layers } from 'lucide-react';

interface SelectedElementData {
  xpath: string;
  similarXPath: string;
  similarCount: number;
  similarTexts?: string[];
  selector: string;
  text: string;
  tagName: string;
}

interface VisualElementPickerModalProps {
  isOpen: boolean;
  targetUrl: string;
  onClose: () => void;
  onSelectXPath: (xpath: string, extractedTexts: string[], isExclude: boolean) => void;
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

  const sendHighlightToIframe = (xpath: string) => {
    const iframe = document.getElementById('dryeyes-preview-iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'DRYEYES_HIGHLIGHT_XPATH', xpath }, '*');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'DRYEYES_ELEMENT_SELECTED') {
        const payload: SelectedElementData = event.data.payload;
        setSelectedElement(payload);
        setTargetMode('single');
        sendHighlightToIframe(payload.xpath);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen]);

  if (!isOpen) return null;

  const proxyUrl = `/api/proxy/page?url=${encodeURIComponent(targetUrl)}`;

  const handleToggleSimilar = (toSimilar: boolean) => {
    if (!selectedElement) return;
    setTargetMode(toSimilar ? 'similar' : 'single');
    const path = toSimilar && selectedElement.similarXPath ? selectedElement.similarXPath : selectedElement.xpath;
    sendHighlightToIframe(path);
  };

  const handleConfirm = (isExclude: boolean = false) => {
    if (!selectedElement) return;
    const isSimilar = targetMode === 'similar';
    const finalXPath = isSimilar && selectedElement.similarXPath ? selectedElement.similarXPath : selectedElement.xpath;
    const texts = isSimilar && selectedElement.similarTexts && selectedElement.similarTexts.length > 0
      ? selectedElement.similarTexts
      : (selectedElement.text ? [selectedElement.text] : []);
    if (finalXPath) {
      onSelectXPath(finalXPath, texts, isExclude);
      onClose();
    }
  };

  const hasSimilarElements = (selectedElement?.similarCount ?? 0) > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full flex flex-col shadow-2xl overflow-hidden">

        {/* ヘッダー（最小化） */}
        <div className="px-3 py-2 bg-slate-900 text-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <MousePointerClick className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <span className="text-xs font-bold truncate">要素を選択</span>
            <span className="text-[11px] text-slate-400 truncate hidden sm:inline">{targetUrl}</span>
          </div>
          <div className="flex items-center space-x-1 flex-shrink-0">
            <button
              onClick={() => { setLoading(true); setSelectedElement(null); setIframeKey((k) => k + 1); }}
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

        {/* フッター（ボタンのみ、コンパクト） */}
        <div className="px-3 py-2 bg-white border-t border-slate-200 flex items-center justify-between gap-2 flex-shrink-0">
          {/* 類似要素切り替えボタン（要素選択後のみ） */}
          <div className="flex-1 min-w-0">
            {hasSimilarElements && (
              <button
                type="button"
                onClick={() => handleToggleSimilar(targetMode !== 'similar')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition flex items-center space-x-1.5 ${
                  targetMode === 'similar'
                    ? 'bg-purple-50 text-purple-700 border-purple-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Layers className={`w-3.5 h-3.5 flex-shrink-0 ${targetMode === 'similar' ? 'text-purple-600' : 'text-slate-400'}`} />
                <span>
                  {targetMode === 'similar'
                    ? `類似 ${selectedElement?.similarCount}件 ハイライト中`
                    : `類似要素も監視（${selectedElement?.similarCount}件）`}
                </span>
              </button>
            )}
            {!selectedElement && (
              <span className="text-xs text-slate-400 flex items-center">
                <AlertCircle className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
                見張りたい要素をタップ
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => handleConfirm(true)}
              disabled={!selectedElement}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-95 disabled:opacity-40 transition rounded-lg"
            >
              除外
            </button>
            <button
              onClick={() => handleConfirm(false)}
              disabled={!selectedElement}
              className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-40 transition rounded-lg shadow-sm flex items-center space-x-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {targetMode === 'similar'
                  ? `OK（${selectedElement?.similarCount}件）`
                  : 'OK'}
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
