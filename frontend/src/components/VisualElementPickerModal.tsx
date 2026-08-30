import React, { useState, useEffect } from 'react';
import { X, MousePointerClick, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface SelectedElementData {
  xpath: string;
  selector: string;
  text: string;
  tagName: string;
}

interface VisualElementPickerModalProps {
  isOpen: boolean;
  targetUrl: string;
  onClose: () => void;
  onSelectXPath: (xpath: string, isExclude: boolean) => void;
}

export const VisualElementPickerModal: React.FC<VisualElementPickerModalProps> = ({
  isOpen,
  targetUrl,
  onClose,
  onSelectXPath,
}) => {
  const [selectedElement, setSelectedElement] = useState<SelectedElementData | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);

  // iframeからのメッセージリスナー
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'DRYEYES_ELEMENT_SELECTED') {
        setSelectedElement(event.data.payload);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen]);

  if (!isOpen) return null;

  const proxyUrl = `/api/proxy/page?url=${encodeURIComponent(targetUrl)}`;

  const handleApply = (isExclude: boolean) => {
    if (selectedElement?.xpath) {
      onSelectXPath(selectedElement.xpath, isExclude);
      onClose();
    }
  };

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
              <h2 className="text-sm font-bold truncate">ビジュアル要素ピッカー (Element Picker)</h2>
              <p className="text-[11px] text-slate-300 truncate">{targetUrl}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setLoading(true);
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
            画面上の見張りたい要素（価格・在庫状況・テキストなど）をタップしてください
          </span>
          <span className="text-[11px] text-indigo-600 hidden sm:inline">
            ※ホバーすると青枠が表示されます
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
            key={iframeKey}
            src={proxyUrl}
            onLoad={() => setLoading(false)}
            className="w-full h-full border-none bg-white"
            title="Page Preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>

        {/* 選択された要素の確認 & 確定フッター */}
        <div className="p-3 sm:p-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-lg">
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
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate" title={selectedElement.xpath}>
                  XPath: <span className="text-indigo-600 font-medium">{selectedElement.xpath}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center text-xs text-slate-400">
                <AlertCircle className="w-4 h-4 mr-1.5 text-slate-400 flex-shrink-0" />
                <span>まだ要素が選択されていません。上のプレビュー画面でタップしてください。</span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleApply(true)}
              disabled={!selectedElement}
              className="flex-1 sm:flex-none px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-95 disabled:opacity-40 transition rounded-xl"
            >
              除外対象に設定
            </button>
            <button
              onClick={() => handleApply(false)}
              disabled={!selectedElement}
              className="flex-1 sm:flex-none px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-40 transition rounded-xl shadow-sm shadow-indigo-200 flex items-center justify-center space-x-1"
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              <span>この要素を監視する</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
