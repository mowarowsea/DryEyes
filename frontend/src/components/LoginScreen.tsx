import React, { useEffect, useState } from 'react';
import { Eye, LogIn, ShieldAlert, UserPlus, Sparkles } from 'lucide-react';
import { AuthSession } from '../types';
import { api } from '../api';

interface LoginScreenProps {
  onAuthenticated: (session: AuthSession) => void;
}

type Mode = 'login' | 'register';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('login');
  // まだ誰も登録していない場合は新規登録タブから始める
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAuthStatus()
      .then(({ hasUsers }) => {
        if (!hasUsers) {
          setIsFirstRun(true);
          setMode('register');
        }
      })
      .catch(() => {
        /* BFF 未起動などの場合はログインタブのまま表示する */
      });
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      const session =
        mode === 'register'
          ? await api.register(username.trim(), password)
          : await api.login(username.trim(), password);
      onAuthenticated(session);
    } catch (err: any) {
      setError(err.message || 'ログインに失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center px-4 py-10 font-sans">
      <div className="w-full max-w-sm">
        {/* ロゴ */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Eye className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-3">DryEyes</h1>
          <p className="text-[11px] text-slate-500 mt-1 text-center">
            見張り続けるのは、DryEyesの仕事。
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 overflow-hidden">
          {/* タブ */}
          <div className="grid grid-cols-2 border-b border-slate-100">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`py-3 text-xs font-bold transition ${
                  mode === m
                    ? 'text-indigo-700 bg-indigo-50/70 border-b-2 border-indigo-600'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {m === 'login' ? 'ログイン' : '新規登録'}
              </button>
            ))}
          </div>

          {isFirstRun && mode === 'register' && (
            <div className="mx-5 mt-4 p-3 bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-xl text-[11px] flex items-start space-x-2">
              <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5 text-indigo-500" />
              <span>
                最初のユーザーを作成します。既に登録済みの監視があれば、このユーザーが引き継ぎます。
              </span>
            </div>
          )}

          {error && (
            <div className="mx-5 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">ユーザー名</label>
              <input
                type="text"
                required
                autoFocus
                autoComplete="username"
                placeholder="例: mowa"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">パスワード</label>
              <input
                type="password"
                required
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder={mode === 'register' ? '4文字以上' : ''}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
              {mode === 'register' && (
                <p className="text-[11px] text-slate-400 mt-1.5">
                  ユーザーごとに専用の ntfy トピックが発行され、通知が混ざりません。
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !username || !password}
              className="w-full py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 transition rounded-xl shadow-md shadow-indigo-200 flex items-center justify-center space-x-1.5"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{mode === 'register' ? '登録中...' : 'ログイン中...'}</span>
                </>
              ) : mode === 'register' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>登録してはじめる</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>ログイン</span>
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-[10px] text-slate-400 text-center mt-4 leading-relaxed">
          ローカル運用向けの簡易ログインです。<br />
          一度ログインすると、このブラウザでは次回から自動でログインします。
        </p>
      </div>
    </div>
  );
};
