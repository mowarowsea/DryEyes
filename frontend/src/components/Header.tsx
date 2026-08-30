import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  LogOut,
  Bell,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { AuthUser, HealthStatus, NtfyInfo } from '../types';

interface HeaderProps {
  health: HealthStatus | null;
  loading: boolean;
  user: AuthUser | null;
  ntfy: NtfyInfo | null;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  loading,
  user,
  ntfy,
  onRefresh,
  onOpenCreateModal,
  onLogout,
}) => {
  const isEngineConnected = health?.changedetection?.status === 'connected';
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // メニュー外をタップしたら閉じる（スマホでの誤操作防止）
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const topic = ntfy?.topic || user?.ntfyTopic || '';

  const handleCopyTopic = async () => {
    try {
      await navigator.clipboard.writeText(topic);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* クリップボードが使えない環境では何もしない（トピックは画面に表示済み） */
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200 shadow-sm">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-100">
            <Eye className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">DryEyes</h1>
            <div className="flex items-center space-x-1.5 mt-1">
              <span className="text-[11px] text-slate-500">エンジン:</span>
              <span className={`inline-flex items-center text-[11px] font-medium ${isEngineConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
                {isEngineConnected ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-0.5 inline" />
                    接続中
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3 mr-0.5 inline" />
                    未接続
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all rounded-lg"
            title="再読み込み"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
          <button
            onClick={onOpenCreateModal}
            className="flex items-center space-x-1 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-medium text-sm rounded-lg shadow-sm shadow-indigo-200"
          >
            <Plus className="w-4 h-4" />
            <span>新規監視</span>
          </button>

          {/* アカウントメニュー */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-900 active:scale-95 transition-all text-white text-xs font-bold flex items-center justify-center uppercase"
                title={`${user.username} としてログイン中`}
              >
                {user.username.slice(0, 2)}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl shadow-slate-300/50 border border-slate-100 overflow-hidden animate-fadeIn">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-[11px] text-slate-400">ログイン中</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{user.username}</p>
                  </div>

                  {/* ユーザー専用の通知トピック */}
                  <div className="px-4 py-3 border-b border-slate-100 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600 flex items-center">
                      <Bell className="w-3.5 h-3.5 mr-1 text-indigo-500" />
                      あなた専用の通知トピック
                    </p>
                    <div className="flex items-center space-x-1.5">
                      <code className="flex-1 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 truncate" title={topic}>
                        {topic}
                      </code>
                      <button
                        onClick={handleCopyTopic}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                        title="トピック名をコピー"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {ntfy?.subscribeUrl && (
                      <a
                        href={ntfy.subscribeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        ntfy でこのトピックを購読
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    )}
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      スマホの ntfy アプリでこのトピックを登録すると、あなたの監視の通知だけが届きます。
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full px-4 py-3 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 transition flex items-center space-x-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>ログアウト</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
