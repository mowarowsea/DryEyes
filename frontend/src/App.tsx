import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { WatchList } from './components/WatchList';
import { CreateWatchModal } from './components/CreateWatchModal';
import { EditWatchModal, EditWatchOptions } from './components/EditWatchModal';
import { CopyWatchModal } from './components/CopyWatchModal';
import { DiffModal } from './components/DiffModal';
import { LoginScreen } from './components/LoginScreen';
import { WatchModel, HealthStatus, CreateWatchDto, AuthUser, NtfyInfo, AuthSession } from './types';
import { api, authToken, setUnauthorizedHandler } from './api';
import { takePendingWatchId } from './deepLink';
import { ThemeMode, applyTheme, getStoredTheme, storeTheme, watchSystemTheme } from './theme';

// booting: 保存済みトークンの検証中 / anon: 未ログイン / ready: ログイン済み
type AuthState = 'booting' | 'anon' | 'ready';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('booting');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ntfy, setNtfy] = useState<NtfyInfo | null>(null);

  const [watches, setWatches] = useState<WatchModel[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editTargetWatch, setEditTargetWatch] = useState<WatchModel | null>(null);
  const [copyTargetWatch, setCopyTargetWatch] = useState<WatchModel | null>(null);
  const [diffTargetWatch, setDiffTargetWatch] = useState<WatchModel | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [watchesLoaded, setWatchesLoaded] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  // 設定変更でURLを差し替えたときにファビコンを取り直すためのキャッシュ破棄キー（監視ID -> 保存時刻）
  const [faviconVersions, setFaviconVersions] = useState<Record<string, number>>({});
  // ntfy 通知から開かれたときに、その監視の差分を出すための ID
  const [pendingWatchId, setPendingWatchId] = useState<string | null>(() => takePendingWatchId());

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // テーマの反映。'system' のときは端末側の設定変更にも追従する。
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);

  const handleChangeTheme = useCallback((mode: ThemeMode) => {
    setTheme(mode);
    storeTheme(mode);
  }, []);

  const resetToAnonymous = useCallback(() => {
    setUser(null);
    setNtfy(null);
    setWatches([]);
    setWatchesLoaded(false);
    setAuthState('anon');
  }, []);

  // 起動時: ブラウザに残っているトークンで前回のユーザーを復元する
  useEffect(() => {
    // トークン失効時（有効期限切れなど）はログイン画面へ戻す
    setUnauthorizedHandler(resetToAnonymous);

    if (!authToken.get()) {
      setAuthState('anon');
    } else {
      api
        .getMe()
        .then((me) => {
          setUser(me.user);
          setNtfy(me.ntfy);
          setAuthState('ready');
        })
        .catch(() => {
          authToken.clear();
          setAuthState('anon');
        });
    }

    return () => setUnauthorizedHandler(null);
  }, [resetToAnonymous]);

  // データ取得
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [healthData, watchesData] = await Promise.all([
        api.getHealth().catch(() => null),
        api.getWatches().catch(() => []),
      ]);
      setHealth(healthData);
      setWatches(watchesData);
      setWatchesLoaded(true);
    } catch (err: any) {
      console.error(err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  // 通知タップで開かれた場合は、一覧が揃った時点でその監視の差分を開く
  useEffect(() => {
    if (!pendingWatchId || authState !== 'ready' || !watchesLoaded) return;

    const target = watches.find((w) => w.id === pendingWatchId);
    if (target) {
      setDiffTargetWatch(target);
    } else {
      // 既に削除された、または別ユーザーの監視だった場合
      showToast('通知の監視対象が見つかりませんでした');
    }
    setPendingWatchId(null);
  }, [pendingWatchId, authState, watchesLoaded, watches, showToast]);

  useEffect(() => {
    if (authState !== 'ready') return;
    fetchData();
    // 30秒ごとに自動ポーリング
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [authState, fetchData]);

  // 認証ハンドラー
  const handleAuthenticated = async (session: AuthSession) => {
    setUser(session.user);
    setAuthState('ready');
    // 購読用 URL などの通知情報を取得（失敗してもログイン自体は継続）
    try {
      const me = await api.getMe();
      setNtfy(me.ntfy);
    } catch {
      setNtfy(null);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    resetToAnonymous();
  };

  // アクションハンドラー
  const handleCreateWatch = async (data: CreateWatchDto) => {
    await api.createWatch(data);
    showToast('新しい監視対象を登録しました！');
    fetchData();
  };

  const handleUpdateWatch = async (
    id: string,
    data: Partial<WatchModel>,
    { recheck }: EditWatchOptions
  ) => {
    await api.updateWatch(id, data);
    // URL を変えた場合に古いサイトのファビコンが残らないよう、画像も取り直させる
    setFaviconVersions((prev) => ({ ...prev, [id]: Date.now() }));

    if (recheck) {
      // 新しい設定での取得結果を、これまでの履歴に続けて積む
      await api.triggerCheck(id).catch(() => undefined);
      showToast('設定を更新しました。新しい内容で取得中です');
      setTimeout(() => fetchData(true), 2500);
    } else {
      showToast('監視の設定を更新しました');
    }
    fetchData(true);
  };

  const handleTriggerCheck = async (id: string) => {
    await api.triggerCheck(id);
    showToast('チェックを開始しました');
    // 数秒後に更新結果を取得
    setTimeout(() => fetchData(true), 2500);
  };

  const handleTogglePause = async (id: string, paused: boolean) => {
    await api.updateWatch(id, { paused });
    showToast(paused ? '監視を一時停止しました' : '監視を再開しました');
    fetchData(true);
  };

  const handleDeleteWatch = async (id: string) => {
    await api.deleteWatch(id);
    showToast('監視対象を削除しました');
    fetchData();
  };

  const handleCopyWatchTo = async (id: string, userId: string) => {
    const result = await api.copyWatchTo(id, userId);
    showToast(`「${result.title}」を ${result.username} 用にコピーしました`);
  };

  // トークン検証中は画面のちらつきを避けるため何も出さない
  if (authState === 'booting') {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === 'anon') {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  const userTopic = ntfy?.topic || user?.ntfyTopic || '';

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col font-sans pb-12">
      <Header
        health={health}
        loading={loading}
        user={user}
        ntfy={ntfy}
        theme={theme}
        onChangeTheme={handleChangeTheme}
        onRefresh={() => fetchData()}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <WatchList
          watches={watches}
          onTriggerCheck={handleTriggerCheck}
          onTogglePause={handleTogglePause}
          onOpenDiff={(w) => setDiffTargetWatch(w)}
          onEdit={(w) => setEditTargetWatch(w)}
          onCopyTo={(w) => setCopyTargetWatch(w)}
          faviconVersions={faviconVersions}
          onDelete={handleDeleteWatch}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
        />
      </main>

      {/* モーダル */}
      <CreateWatchModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateWatch}
        userTopic={userTopic}
      />

      <EditWatchModal
        watch={editTargetWatch}
        isOpen={!!editTargetWatch}
        userTopic={userTopic}
        onClose={() => setEditTargetWatch(null)}
        onSubmit={handleUpdateWatch}
      />

      <CopyWatchModal
        watch={copyTargetWatch}
        isOpen={!!copyTargetWatch}
        onClose={() => setCopyTargetWatch(null)}
        onSubmit={handleCopyWatchTo}
      />

      <DiffModal
        watch={diffTargetWatch}
        isOpen={!!diffTargetWatch}
        onClose={() => setDiffTargetWatch(null)}
        onViewed={() => fetchData(true)}
      />

      {/* トースト通知 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 dark:bg-slate-700/95 backdrop-blur text-white px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg animate-bounce">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
