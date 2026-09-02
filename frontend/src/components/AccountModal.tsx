import React, { useState } from 'react';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { AuthUser, HealthStatus, NtfyInfo } from '../types';
import { copyTextToClipboard } from '../clipboard';
import { ThemeMode } from '../theme';
import { Modal } from './Modal';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser;
  ntfy: NtfyInfo | null;
  health: HealthStatus | null;
  theme: ThemeMode;
  onChangeTheme: (mode: ThemeMode) => void;
  onLogout: () => void;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'ライト', Icon: Sun },
  { mode: 'dark', label: 'ダーク', Icon: Moon },
  { mode: 'system', label: '端末に合わせる', Icon: Monitor },
];

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  user,
  ntfy,
  health,
  theme,
  onChangeTheme,
  onLogout,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const isEngineConnected = health?.changedetection?.status === 'connected';
  const topic = ntfy?.topic || user.ntfyTopic || '';

  const handleCopyTopic = async () => {
    const ok = await copyTextToClipboard(topic);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), ok ? 1500 : 4000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={user.username}
      subtitle="ログイン中"
      size="sm"
      icon={
        <div className="w-9 h-9 rounded-full bg-slate-800 dark:bg-slate-700 text-white text-xs font-bold flex items-center justify-center uppercase flex-shrink-0">
          {user.username.slice(0, 2)}
        </div>
      }
    >
      <div className="p-5 space-y-4 overflow-y-auto">
        {/* 監視エンジンの状態。普段は見えなくてよいが、動いていないときの原因調べに要る。 */}
        <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            監視エンジン
          </span>
          <span
            className={`inline-flex items-center text-[11px] font-medium ${
              isEngineConnected
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {isEngineConnected ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                接続中
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 mr-1" />
                未接続
              </>
            )}
          </span>
        </div>

        {/* 表示テーマ */}
        <div className="space-y-2">
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
        <div className="space-y-2">
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
            onClose();
            onLogout();
          }}
          className="w-full px-4 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition flex items-center justify-center space-x-2"
        >
          <LogOut className="w-4 h-4" />
          <span>ログアウト</span>
        </button>
      </div>
    </Modal>
  );
};
