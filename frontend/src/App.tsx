import { useState, useEffect, useCallback, useRef } from 'react';
import { SearchHeader } from './components/SearchHeader';
import { AccountModal } from './components/AccountModal';
import { AccountFab, CreateFab } from './components/FloatingActions';
import { WatchList } from './components/WatchList';
import { CreateWatchModal } from './components/CreateWatchModal';
import { EditWatchModal, EditWatchOptions } from './components/EditWatchModal';
import { CopyWatchModal } from './components/CopyWatchModal';
import { DiffModal } from './components/DiffModal';
import { HistoryModal } from './components/HistoryModal';
import { FeedModal } from './components/FeedModal';
import { RedirectReviewModal } from './components/RedirectReviewModal';
import { CardImageModal } from './components/CardImageModal';
import { LoginScreen } from './components/LoginScreen';
import {
  WatchModel,
  HealthStatus,
  CreateWatchDto,
  AuthUser,
  NtfyInfo,
  AuthSession,
  RedirectDecisionOptions,
} from './types';
import { api, authToken, setUnauthorizedHandler } from './api';
import { similarRedirectWatches } from './redirectGroup';
import { takePendingWatchId, takeCreateIntent, CreateIntent } from './deepLink';
import { ThemeMode, applyTheme, getStoredTheme, storeTheme, watchSystemTheme } from './theme';
import { forgetCardImage } from './hooks/useCardImage';
import { getStoredCardImageEnabled, storeCardImageEnabled } from './cardImagePref';

// booting: 保存済みトークンの検証中 / anon: 未ログイン / ready: ログイン済み
type AuthState = 'booting' | 'anon' | 'ready';

// ポーリング結果が前回と同じかどうか。同じなら state を触らず、再描画自体を起こさない。
const isSameWatchList = (a: WatchModel[], b: WatchModel[]): boolean =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('booting');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ntfy, setNtfy] = useState<NtfyInfo | null>(null);

  const [watches, setWatches] = useState<WatchModel[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  // 検索語は固定ヘッダ側の入力欄が持ち主。一覧には結果の絞り込みだけを渡す。
  const [search, setSearch] = useState('');
  const [editTargetWatch, setEditTargetWatch] = useState<WatchModel | null>(null);
  const [copyTargetWatch, setCopyTargetWatch] = useState<WatchModel | null>(null);
  const [diffTargetWatch, setDiffTargetWatch] = useState<WatchModel | null>(null);
  // 変更履歴（いつ何が変わったか）のモーダル。変更点モーダルの上に重ねて開くこともある。
  const [historyTargetWatch, setHistoryTargetWatch] = useState<WatchModel | null>(null);
  const [feedTargetWatch, setFeedTargetWatch] = useState<WatchModel | null>(null);
  // 監視先が別 URL へ転送されていたときの確認モーダル
  const [redirectTargetWatch, setRedirectTargetWatch] = useState<WatchModel | null>(null);
  // カード背景の絵を選び直すモーダル
  const [cardImageTargetWatch, setCardImageTargetWatch] = useState<WatchModel | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [watchesLoaded, setWatchesLoaded] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  // カードの背景に絵を敷くか（端末ごとの表示設定）
  const [showCardImages, setShowCardImages] = useState<boolean>(() => getStoredCardImageEnabled());
  // ntfy 通知から開かれたときに、その監視の差分を出すための ID
  const [pendingWatchId, setPendingWatchId] = useState<string | null>(null);
  // 共有シートやホーム画面のショートカット（?add=1）から開かれたときの登録内容。
  // ログイン前に共有された場合もあるため、ログインが済むまで持ち越す。
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [pendingCreateIntent, setPendingCreateIntent] = useState<CreateIntent | null>(null);
  // 登録直後の監視を数秒だけ光らせるための ID
  const [highlightedWatchId, setHighlightedWatchId] = useState<string | null>(null);
  const launchLinkRead = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    // 続けてトーストを出したとき、前のタイマーで新しいメッセージが早く消されないようにする
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // 登録した監視を数秒だけ目立たせる。どれが増えたのか一覧の中で見失わないようにするため。
  const highlightWatch = useCallback((id: string) => {
    setHighlightedWatchId(id);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedWatchId(null), 5000);
  }, []);

  // 消し込みのタイマーが残ったままログアウトなどで消えると、外れた state を触ることになる
  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    []
  );

  // 起動時のリンク（通知タップ・共有シート）を 1 度だけ読む。
  // これらは「クエリを読み取って URL から消す」副作用を伴うため、useState の初期化子には置けない。
  // 開発時の <React.StrictMode> は初期化を 2 回走らせるので、2 回目が空振りして
  // 共有したのにホーム画面が出るだけ、という状態になってしまう。
  useEffect(() => {
    if (launchLinkRead.current) return;
    launchLinkRead.current = true;

    setPendingWatchId(takePendingWatchId());
    setPendingCreateIntent(takeCreateIntent());
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

  const handleChangeShowCardImages = useCallback((show: boolean) => {
    setShowCardImages(show);
    storeCardImageEnabled(show);
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

  // データ取得。初回もポーリングも同じ扱いで、画面全体を覆う読み込み表示は出さない。
  // 一覧が既に出ている状態でスピナーに切り替わると、見ていた位置を見失うだけになる。
  const fetchData = useCallback(async () => {
    const [healthResult, watchesResult] = await Promise.allSettled([
      api.getHealth(),
      api.getWatches(),
    ]);

    // 取れなかったものは前回の表示をそのまま残す。
    // ここで空配列や null に落としてしまうと、30 秒ごとの裏取得がたまたま失敗しただけで
    // 一覧が一瞬カラになり「まだ監視対象がありません」が出る（画面がリロードされたように見える）。
    if (healthResult.status === 'fulfilled') setHealth(healthResult.value);

    if (watchesResult.status === 'fulfilled') {
      const next = watchesResult.value;
      // 中身が前回と同じなら state を差し替えない。同じ内容で再描画すると、
      // 一覧がちらついたり開いているメニューが閉じたりするだけで、得るものがない。
      setWatches((prev) => (isSameWatchList(prev, next) ? prev : next));
      setWatchesLoaded(true);
    } else {
      console.error(watchesResult.reason);
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

  // 共有から開かれたときは、ログインが済み次第そのまま登録モーダルを出す
  useEffect(() => {
    if (!pendingCreateIntent || authState !== 'ready') return;

    setSharedUrl(pendingCreateIntent.url);
    setIsCreateModalOpen(true);
    // 共有されたのに URL が取り出せなかったときは黙って空欄を出さない。
    // 端末やブラウザ側の受け渡しが崩れていても、貼り付けから続けられると分かるようにする。
    if (pendingCreateIntent.source === 'share' && !pendingCreateIntent.url) {
      showToast('共有からURLを受け取れませんでした。貼り付けから登録できます');
    }
    setPendingCreateIntent(null);
  }, [pendingCreateIntent, authState, showToast]);

  useEffect(() => {
    if (authState !== 'ready') return;
    fetchData();
    // 30秒ごとに自動ポーリング
    const interval = setInterval(() => fetchData(), 30000);
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
    const created = await api.createWatch(data);
    showToast('新しい監視対象を登録しました！');
    // 検索語が残っていると、登録したばかりの監視がその場で隠れてしまう
    setSearch('');
    // 一覧に並んでから光らせる。先に光らせても、まだそのカードは描かれていない。
    await fetchData();
    highlightWatch(created.id);
  };

  const handleUpdateWatch = async (
    id: string,
    data: Partial<WatchModel>,
    { recheck }: EditWatchOptions
  ) => {
    await api.updateWatch(id, data);
    // URL や監視範囲を変えると背景の絵も変わりうるので、覚えている絵を捨てて取り直させる
    if (data.url !== undefined || data.includeFilters !== undefined) forgetCardImage(id);

    if (recheck) {
      // 新しい設定での取得結果を、これまでの履歴に続けて積む
      await api.triggerCheck(id).catch(() => undefined);
      showToast('設定を更新しました。新しい内容で取得中です');
      setTimeout(() => fetchData(), 2500);
    } else {
      showToast('監視の設定を更新しました');
    }
    fetchData();
  };

  const handleTriggerCheck = async (id: string) => {
    await api.triggerCheck(id);
    showToast('チェックを開始しました');
    // 数秒後に更新結果を取得
    setTimeout(() => fetchData(), 2500);
  };

  const handleTogglePause = async (id: string, paused: boolean) => {
    await api.updateWatch(id, { paused });
    showToast(paused ? '監視を一時停止しました' : '監視を再開しました');
    fetchData();
  };

  const handleDeleteWatch = async (id: string) => {
    await api.deleteWatch(id);
    forgetCardImage(id);
    showToast('監視対象を削除しました');
    fetchData();
  };

  const handleCopyWatchTo = async (id: string, userId: string) => {
    const result = await api.copyWatchTo(id, userId);
    showToast(`「${result.title}」を ${result.username} 用にコピーしました`);
  };

  // 背景の絵を選び直した。覚えている絵を捨てると、出ているカードが新しい絵を取りに行く。
  const handleCardImageSaved = (id: string, message: string) => {
    forgetCardImage(id);
    showToast(message);
  };

  // 検知した移転を承認して、監視先を転送先の URL へ差し替える。
  // 同じ転送で確認待ちの監視もまとめて差し替わるので、何件効いたかをトーストで伝える。
  const handleAcceptRedirect = async (id: string, options: RedirectDecisionOptions) => {
    const result = await api.acceptRedirect(id, options);
    const applied = result.applied ?? 1;
    const failed = result.failed ?? 0;
    showToast(
      (applied > 1 ? `${applied} 件の監視先を変更しました` : '監視先を変更しました') +
        (failed > 0 ? `（${failed} 件は失敗）` : '') +
        (options.always ? '。以後この転送は自動で切り替えます' : '')
    );
    fetchData();
  };

  // 移転を却下して、監視先を元の URL のままにする
  const handleDismissRedirect = async (id: string, options: RedirectDecisionOptions) => {
    const result = await api.dismissRedirect(id, options);
    const applied = result.applied ?? 1;
    showToast(
      (applied > 1 ? `${applied} 件の監視先をそのままにしました` : '監視先はそのままにしました') +
        (options.always ? '。以後この転送は知らせません' : '')
    );
    fetchData();
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
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col font-sans pb-24">
      <SearchHeader value={search} onChange={setSearch} />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <WatchList
          watches={watches}
          loaded={watchesLoaded}
          search={search}
          highlightedId={highlightedWatchId}
          showCardImages={showCardImages}
          onTriggerCheck={handleTriggerCheck}
          onTogglePause={handleTogglePause}
          onOpenDiff={(w) => setDiffTargetWatch(w)}
          onOpenHistory={(w) => setHistoryTargetWatch(w)}
          onOpenFeed={(w) => setFeedTargetWatch(w)}
          onEdit={(w) => setEditTargetWatch(w)}
          onCopyTo={(w) => setCopyTargetWatch(w)}
          onReviewRedirect={(w) => setRedirectTargetWatch(w)}
          onChangeImage={(w) => setCardImageTargetWatch(w)}
          onDelete={handleDeleteWatch}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
        />
      </main>

      {/* フロートボタン */}
      {user && <AccountFab user={user} onClick={() => setIsAccountModalOpen(true)} />}
      <CreateFab onClick={() => setIsCreateModalOpen(true)} />

      {/* モーダル。同じページの監視が既にあったときは、登録の代わりにその監視の変更点を開く。 */}
      <CreateWatchModal
        isOpen={isCreateModalOpen}
        initialUrl={sharedUrl}
        onClose={() => {
          setIsCreateModalOpen(false);
          setSharedUrl(null);
        }}
        onSubmit={handleCreateWatch}
        userTopic={userTopic}
        watches={watches}
        onOpenExisting={(id) => {
          const existing = watches.find((w) => w.id === id);
          if (existing) setDiffTargetWatch(existing);
        }}
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

      <RedirectReviewModal
        watch={redirectTargetWatch}
        isOpen={!!redirectTargetWatch}
        similarCount={
          redirectTargetWatch ? similarRedirectWatches(watches, redirectTargetWatch).length : 0
        }
        onClose={() => setRedirectTargetWatch(null)}
        onAccept={handleAcceptRedirect}
        onDismiss={handleDismissRedirect}
      />

      <CardImageModal
        watch={cardImageTargetWatch}
        isOpen={!!cardImageTargetWatch}
        onClose={() => setCardImageTargetWatch(null)}
        onSaved={handleCardImageSaved}
      />

      <DiffModal
        watch={diffTargetWatch}
        isOpen={!!diffTargetWatch}
        onClose={() => setDiffTargetWatch(null)}
        onViewed={() => fetchData()}
        onOpenHistory={() => setHistoryTargetWatch(diffTargetWatch)}
      />

      <HistoryModal
        watch={historyTargetWatch}
        isOpen={!!historyTargetWatch}
        onClose={() => setHistoryTargetWatch(null)}
      />

      <FeedModal
        watch={feedTargetWatch}
        isOpen={!!feedTargetWatch}
        onClose={() => setFeedTargetWatch(null)}
      />

      {user && (
        <AccountModal
          isOpen={isAccountModalOpen}
          onClose={() => setIsAccountModalOpen(false)}
          user={user}
          ntfy={ntfy}
          health={health}
          theme={theme}
          onChangeTheme={handleChangeTheme}
          showCardImages={showCardImages}
          onChangeShowCardImages={handleChangeShowCardImages}
          onLogout={handleLogout}
        />
      )}

      {/* トースト通知 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 dark:bg-slate-700/95 backdrop-blur text-white px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg animate-bounce">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
