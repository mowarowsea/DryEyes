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
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { AuthUser, HealthStatus, NtfyInfo } from '../types';
import { copyTextToClipboard } from '../clipboard';
import { ThemeMode } from '../theme';

interface HeaderProps {
  health: HealthStatus | null;
  loading: boolean;
  user: AuthUser | null;
  ntfy: NtfyInfo | null;
  theme: ThemeMode;
  onChangeTheme: (mode: ThemeMode) => void;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
  onLogout: () => void;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'ライト', Icon: Sun },
  { mode: 'dark', label: 'ダーク', Icon: Moon },
  { mode: 'system', label: '端末に合わせる', Icon: Monitor },
];

export const Header: React.FC<HeaderProps> = ({
  health,
  loading,
  user,
  ntfy,
  theme,
  onChangeTheme,
  onRefresh,
  onOpenCreateModal,
  onLogout,
}) => {
  const isEngineConnected = health?.changedetection?.status === 'connected';
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
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
    const ok = await copyTextToClipboard(topic);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), ok ? 1500 : 4000);
  };

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-100 dark:shadow-none">
            <Eye className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-none">DryEyes</h1>
            <div className="flex items-center space-x-1.5 mt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">エンジン:</span>
              <span
                className={`inline-flex items-center text-[11px] font-medium ${
                  isEngineConnected
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
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
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all rounded-lg"
            title="再読み込み"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600 dark:text-indigo-400' : ''}`} />
          </button>
          <button
            onClick={onOpenCreateModal}
            className="flex items-center space-x-1 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-medium text-sm rounded-lg shadow-sm shadow-indigo-200 dark:shadow-none"
          >
            <Plus className="w-4 h-4" />
            <span>新規監視</span>
          </button>

          {/* アカウントメニュー */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="w-9 h-9 rounded-full bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 active:scale-95 transition-all text-white text-xs font-bold flex items-center justify-center uppercase"
                title={`${user.username} としてログイン中`}
              >
                {user.username.slice(0, 2)}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-900 rounded-2xl shadow-xl shadow-slate-300/50 dark:shadow-black/50 border border-slate-100 dark:border-slate-700 overflow-hidden animate-fadeIn">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">ログイン中</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{user.username}</p>
                  </div>

                  {/* 表示テーマ */}
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">表示テーマ</p>
                    <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                      {THEME_OPTIONS.map(({ mode, label, Icon }) => (
                        <button
                          key={mode}
                          onClick={() => onChangeTheme(mode)}
                          title={label}
                          className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-medium transition ${
                            theme === mode
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ユーザー専用の通知トピック */}
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center">
                      <Bell className="w-3.5 h-3.5 mr-1 text-indigo-500" />
                      あなた専用の通知トピック
                    </p>
                    <div className="flex items-center space-x-1.5">
                      <code
                        className="flex-1 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg px-2 py-1.5 truncate select-all"
                        title={topic}
                      >
                        {topic}
                      </code>
                      <button
                        onClick={handleCopyTopic}
                        className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition"
                        title="トピック名をコピー"
                      >
                        {copyState === 'copied' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    {copyState === 'copied' && (
                      <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        コピーしました
                      </p>
                    )}
                    {copyState === 'failed' && (
                      <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        コピーできませんでした。上のトピック名を長押しして選択してください。
                      </p>
                    )}
                    {ntfy?.subscribeUrl && (
                      <a
                        href={ntfy.subscribeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                      >
                        ntfy でこのトピックを購読
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    )}
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                      スマホの ntfy アプリでこのトピックを登録すると、あなたの監視の通知だけが届きます。
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full px-4 py-3 text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition flex items-center space-x-2"
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
