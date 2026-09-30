import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Library, Link2, Loader2, RefreshCw, RotateCcw, Send, Undo2, X } from 'lucide-react';
import {
  FeedCandidateWithState,
  FeedConfig,
  FeedScanResult,
  PinaxSeries,
  PowerdownerUser,
  WatchModel,
} from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { inputClass, selectClass, submitButtonClass } from '../ui';
import { LabelParts, splitSharedAffixes } from '../candidateLabel';
import { guessSeriesQuery } from '../seriesQuery';

// 監視の増分から作った投入候補を確認して、PowerDowner へ送る画面。
//
// 想定している流れは 2 段構え:
//   1. 登録直後は「全件を洗い出す」でページに並んでいるものを丸ごと出し、
//      対象と対象外に振り分ける。まだ何も取り込んでいなければ、開いた時点で自動で走る
//   2. 決まったら「確認なしで投入する」を立てて任せる
//
// 区分けは対象／対象外の 2 つだけ。「今は落とさないが後で落とすかもしれない」は
// 実際にはほぼ起きないので、中間状態を置いて迷いどころを増やさない。
// 振り分けを間違えても、対象外からいつでも戻せる。
//
// 投入済みも畳んで残す。PowerDowner 側でジョブを消してしまうと、こちらは「送った」まま
// 向こうに何も無い状態になり、次のスキャンでも同じ行は二度と候補にならない
// (sourceKey で弾かれる)。ここから送り直せるようにしておかないと、その巻だけ
// 監視を作り直すまで手が届かなくなる。

interface FeedModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
  /** 保存・投入の結果をモーダルの外 (トースト) で知らせる */
  onNotify?: (message: string) => void;
}

/** 投入先が未設定のとき既定で選ぶ PowerDowner のユーザー。蔵書 (Pinax) の棚に入れる口 */
const DEFAULT_USER_NAME = 'pinax';

type NameSource = 'pinax' | 'manual';

const SCAN_MESSAGE: Record<FeedScanResult['status'], string> = {
  'no-selector': '監視する要素が指定されていないため、どこを 1 件とみなすか決められません。',
  'no-snapshot':
    'まだ一度もページを取得していないので、比べる元がありません。「全件を洗い出す」ならいま並んでいるものを出せます。',
  initialized: '初回なので増分はありません。「全件を洗い出す」でいま並んでいるものを出せます。',
  unchanged: '前回の取り込みから増分はありません。',
  scanned: '',
  collected: '',
};

/** スキャン結果を 1 行で。「増えた行」と「取れた要素」を添えるのは、候補が 0 件だったときに
 *  差分が無かったのかセレクタが外れているのかを切り分けるため */
const scanNotice = (result: FeedScanResult): string =>
  result.status === 'scanned'
    ? `${result.added} 件を追加 (増えた行 ${result.addedLines ?? 0} / 取れた要素 ${result.extracted ?? 0})`
    : result.status === 'collected'
      ? `ページ全体から ${result.added} 件を候補にしました (取れた要素 ${result.extracted ?? 0})`
      : SCAN_MESSAGE[result.status];

/** PowerDowner から見た状態。既に手元にあるものを投入対象から外すために使う */
const STATE_BADGE: Record<'skip' | 'merge', { label: string; className: string }> = {
  skip: { label: '所持済み', className: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  merge: { label: '取得中', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' },
};

/**
 * 同じ状態を投入済みの側から見たときの言い方。
 *
 * 未投入なら skip は「持っているから送らなくていい」だが、投入済みの行では
 * 「送ったものが向こうに収まっている」を意味する。同じ札で両方を表すと、
 * 入れ直しの要る行が見分けられない。
 */
const SENT_BADGE: Record<'new' | 'skip' | 'merge', { label: string; className: string }> = {
  // 判定から消えている = 向こうでジョブごと消された。この画面で拾いたいのはこれ
  new: { label: 'ジョブなし', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300' },
  skip: { label: '取得済み', className: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  merge: { label: '取得中', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' },
};

/**
 * 投入済みなのに PowerDowner にジョブが無いもの。
 *
 * 向こうの重複判定はジョブ自身を見るので、ジョブを消すと判定からも消える。
 * これが「間違って消した」の印になる。
 * 巻数を読めない候補は重なり判定にそもそも参加できず常に new で返ってくるため、
 * ここでは数えない — 消えていないものを「消えた」と言うと、押しても何も起きない
 * ボタンだけが並ぶ。
 */
const isMissingJob = (candidate: FeedCandidateWithState): boolean =>
  candidate.powerdowner?.state === 'new' && candidate.powerdowner.volumeFrom !== null;

/** 投入した時刻。年は出さない — 並んでいるのは大抵ここ数日のもの */
const formatSentAt = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** PowerDowner が元の文字列から読み取った巻数 */
const volumeLabel = (candidate: FeedCandidateWithState): string | null => {
  const pd = candidate.powerdowner;
  if (!pd || pd.volumeFrom === null) return null;
  return pd.volumeFrom === pd.volumeTo ? `第${pd.volumeFrom}巻` : `第${pd.volumeFrom}-${pd.volumeTo}巻`;
};

/**
 * 行に出す名前。
 *
 * 作品名は行ではなく監視の属性なので、候補には今の設定が重ねて返る (feedStore の withFeedMeta)。
 * それを主表示にすると一覧が同じ名前だけで埋まり、どれがどの巻か分からない。
 * 行ごとに違うのは元のテキストなので、そちらを出す。
 */
const candidateLabel = (candidate: FeedCandidateWithState): string =>
  candidate.meta.rawText || candidate.text || candidate.meta.title || '(テキストなし)';

/**
 * 元テキストを、一覧の中で共通する前後を薄めて出す。
 * 同じ作品の並びは大半が共通なので、そのままでは違う 2 文字が埋もれる。
 */
const CandidateLabel: React.FC<{ parts: LabelParts; bodyClass: string }> = ({ parts, bodyClass }) => (
  <p
    className={`text-[11px] leading-tight break-all ${bodyClass}`}
    title={`${parts.head}${parts.body}${parts.tail}`}
  >
    {parts.head && <span className="text-slate-400 dark:text-slate-500">{parts.head}</span>}
    {parts.body}
    {parts.tail && <span className="text-slate-400 dark:text-slate-500">{parts.tail}</span>}
  </p>
);

/** 入力欄に入れておく今の巻数。「1-4」の形にしておけば、そのまま直して Enter で済む */
const volumeDraft = (candidate: FeedCandidateWithState): string => {
  const pd = candidate.powerdowner;
  if (pd && pd.volumeFrom !== null) {
    return pd.volumeFrom === pd.volumeTo ? String(pd.volumeFrom) : `${pd.volumeFrom}-${pd.volumeTo}`;
  }
  return candidate.meta.volume ?? '';
};

/**
 * 巻数の表示と、その場での書き換え。
 *
 * 画面に足すものを増やさないよう、いま出ている「第1-4巻」「巻数不明」の文字自体を押せるようにする。
 * 押すと同じ場所が小さな入力欄になり、Enter か欄の外で決まる (Esc で取り消し)。
 * 空で決めると、元の文字列からの読み取りに戻る。
 */
const VolumeEditor: React.FC<{
  candidate: FeedCandidateWithState;
  disabled: boolean;
  onSave: (volume: string | null) => Promise<void>;
}> = ({ candidate, disabled, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Esc で閉じた欄が外れるときの blur で保存しないための印
  const cancelled = useRef(false);
  // 判定が付いていない (PowerDowner に聞けていない) ときも、人が入れた巻数は見せる
  const label =
    volumeLabel(candidate) ??
    (!candidate.powerdowner && candidate.meta.volume ? `第${candidate.meta.volume}巻` : null);
  // 巻数を読めていないと「もう持っているか」の判定に参加できないので目立たせる
  const unreadable = !!candidate.powerdowner && candidate.powerdowner.volumeFrom === null;

  if (editing) {
    const commit = async () => {
      setEditing(false);
      if (cancelled.current) return;
      const next = draft.trim();
      if (next === volumeDraft(candidate)) return;
      await onSave(next || null);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation(); // モーダルごと閉じない
            cancelled.current = true;
            setEditing(false);
          }
        }}
        placeholder="1-4"
        aria-label="巻数"
        className="w-14 px-1 py-0 text-[10px] leading-tight rounded border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 outline-none"
      />
    );
  }

  if (!label && !unreadable) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setDraft(volumeDraft(candidate));
        cancelled.current = false;
        setEditing(true);
      }}
      title={
        unreadable
          ? '巻数を読み取れないと、既に持っているかの判定に参加できません。押して巻数を指定'
          : '押して巻数を直す'
      }
      className={`rounded hover:underline decoration-dotted underline-offset-2 disabled:no-underline ${
        unreadable ? 'text-rose-500 dark:text-rose-400' : ''
      }`}
    >
      {label ?? '巻数不明'}
    </button>
  );
};

export const FeedModal: React.FC<FeedModalProps> = ({ watch, isOpen, onClose, onNotify }) => {
  const [config, setConfig] = useState<FeedConfig | null>(null);
  const [users, setUsers] = useState<PowerdownerUser[]>([]);
  // 一覧を取れなかった理由。握り潰すと投入先が ID の手入力に落ちた訳が画面から消える
  const [usersError, setUsersError] = useState<string | null>(null);
  // 蔵書 (Pinax) から作者・作品名を借りるための検索
  const [shelfQuery, setShelfQuery] = useState('');
  const [shelfHits, setShelfHits] = useState<PinaxSeries[]>([]);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [shelfBusy, setShelfBusy] = useState(false);
  const [candidates, setCandidates] = useState<FeedCandidateWithState[]>([]);
  const [excluded, setExcluded] = useState<FeedCandidateWithState[]>([]);
  const [sent, setSent] = useState<FeedCandidateWithState[]>([]);
  const [busy, setBusy] = useState<
    'load' | 'scan' | 'send' | 'exclude' | 'restore' | 'resend' | 'volume' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 作者・作品名の決め方。蔵書から選ぶか手で書くかのどちらか一方だけを見せる
  const [nameSource, setNameSource] = useState<NameSource>('pinax');
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);
  // 候補が 0 件だったスキャンの控え。何が取れていたのかを見せて原因を切り分ける。
  //
  // 候補が出たスキャンでは持たない。持ち越すと、投入して対象が空になっただけの画面に
  // 「取れませんでした」の説明が残り、うまくいった操作を失敗に見せてしまう。
  const [samples, setSamples] = useState<FeedScanResult['samples']>(undefined);
  // 開いた時点で自動で走らせている「全件を洗い出す」。busy とは分けておき、
  // その間も投入設定は触れて保存もできるようにする (設定を見ている間に一覧が揃うのが狙い)
  const [autoScanning, setAutoScanning] = useState(false);
  // 自動の洗い出しは 1 回開くにつき 1 回まで。watch が差し替わって effect が
  // 走り直しても、同じ監視で二重に投げない
  const autoScannedFor = useRef<string | null>(null);
  // 蔵書の検索結果から自動で選ぶときに今の設定を覗く口。effect の依存に config を
  // 入れると、設定を変えるたびに検索が投げ直される
  const configRef = useRef(config);
  configRef.current = config;
  // 手入力の欄に入ったときの値。離れたときに変わっていれば保存する
  const focusedValue = useRef('');

  /**
   * initial はモーダルを開いた最初の 1 回だけ true。
   * ここで設定の開閉を決めているので、毎回の読み直しで上書きすると
   * 下のボタンを押しただけで設定が開いてしまう。
   */
  /** 投入先の選択肢。PowerDowner が止まっていると取れないので、失敗も画面に残す */
  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api.listPowerdownerUsers());
      setUsersError(null);
    } catch (err: any) {
      setUsers([]);
      setUsersError(err.message || 'PowerDowner のユーザー一覧を取れません');
    }
  }, []);

  /** 戻り値は「対象・対象外・投入済みのどれも空だったか」。取れなかったときは false */
  const load = useCallback(async (watchId: string, initial = false): Promise<boolean> => {
    setBusy('load');
    setError(null);
    try {
      const [loadedConfig, pending, dismissed, alreadySent] = await Promise.all([
        api.getFeedConfig(watchId),
        api.listFeedCandidates('pending', watchId),
        api.listFeedCandidates('dismissed', watchId),
        api.listFeedCandidates('sent', watchId),
      ]);
      setConfig(loadedConfig);
      setCandidates(pending);
      setExcluded(dismissed);
      setSent(alreadySent);
      // 投入先が決まっていない間は設定を開いておく
      if (initial) setSettingsOpen(loadedConfig.userId === null);
      return pending.length === 0 && dismissed.length === 0 && alreadySent.length === 0;
    } catch (err: any) {
      setError(err.message || '読み込みに失敗しました');
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  /** 候補の 3 区分だけを読み直す。設定は画面の値を正にしたいので触らない */
  const reloadLists = useCallback(async (watchId: string) => {
    const [pending, dismissed, alreadySent] = await Promise.all([
      api.listFeedCandidates('pending', watchId),
      api.listFeedCandidates('dismissed', watchId),
      api.listFeedCandidates('sent', watchId),
    ]);
    setCandidates(pending);
    setExcluded(dismissed);
    setSent(alreadySent);
  }, []);

  // 走っている保存。保存は順に並べ、投入の前にはこれを待つ
  // (手入力の欄から直接「投入」を押すと、欄を離れた保存と投入が同時に出る)
  const saving = useRef<Promise<void>>(Promise.resolve());

  /**
   * 投入設定を変えたその場で保存する。
   *
   * 「設定を保存」ボタンだと、作品を選んだところで済んだ気になって押し忘れる。
   * 未保存のままだと所持の判定も巻数も古い設定のままで、確認なしの自動投入も古い設定で走る。
   * 送るのは変えた項目だけ (サーバーが重ねる)。保存先は常に投入先ユーザーの既定に戻す —
   * 好きな場所に落としたければ PowerDowner 側で。
   * 保存したら判定が付き直すので一覧を読み直す。
   */
  const saveSettings = useCallback(
    (watchId: string, next: Partial<FeedConfig>): Promise<void> => {
      const run = async () => {
        try {
          await api.saveFeedConfig(watchId, { ...next, destDir: null });
          // 返ってきた設定で丸ごと置き換えると、保存中に書き進めた手入力の欄を巻き戻す
          setConfig((prev) => (prev ? { ...prev, ...next, destDir: null } : prev));
          onNotify?.('設定を保存しました');
          await reloadLists(watchId);
        } catch (err: any) {
          setError(err.message || '設定の保存に失敗しました');
        }
      };
      saving.current = saving.current.then(run);
      return saving.current;
    },
    [onNotify, reloadLists]
  );

  useEffect(() => {
    if (!isOpen) autoScannedFor.current = null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !watch) return;
    let alive = true;
    setNotice(null);
    setSamples(undefined);
    setExcludedOpen(false);
    setSentOpen(false);
    setNameSource('pinax');
    const watchId = watch.id;
    // まだ一度も洗い出していない監視 (どの区分も空) なら、開いたそのままで全件を洗い出す。
    // 押すボタンが 1 つ減るだけでなく、投入設定を確かめている間に一覧が揃う
    load(watchId, true).then(async (empty) => {
      if (!alive || !empty || autoScannedFor.current === watchId) return;
      autoScannedFor.current = watchId;
      setAutoScanning(true);
      try {
        const result = await api.scanFeed(watchId, true);
        if (!alive) return;
        setNotice(scanNotice(result));
        setSamples(result.added === 0 ? result.samples : undefined);
        await load(watchId);
      } catch (err: any) {
        if (alive) setError(err.message || '候補の作成に失敗しました');
      } finally {
        if (alive) setAutoScanning(false);
      }
    });
    // PowerDowner が止まっていても画面は使えるようにする (手入力に落とす)
    loadUsers();
    // 監視のタイトルから作品名を起こして、蔵書の検索欄に入れておく。
    // 外すこともあるので、あくまで初期値 (seriesQuery.ts)
    setShelfQuery(guessSeriesQuery(watch.title));
    setShelfHits([]);
    setShelfError(null);
    return () => {
      alive = false;
      setAutoScanning(false);
    };
  }, [isOpen, watch, load, loadUsers]);

  /**
   * 蔵書 (Pinax) を引く。打つたびに投げないよう少し待つ。
   *
   * まだ何も決まっていない監視で候補が 1 件に絞れたときは、そのまま選んで保存する。
   * 迷う余地が無く、違っていても選び直せば済む。人が決めたものは上書きしない。
   */
  useEffect(() => {
    if (!isOpen || !settingsOpen || nameSource !== 'pinax') return;
    const q = shelfQuery.trim();
    if (!q) {
      setShelfHits([]);
      setShelfError(null);
      return;
    }

    let alive = true;
    const timer = setTimeout(() => {
      setShelfBusy(true);
      api
        .searchPinaxSeries(q)
        .then((hits) => {
          if (!alive) return;
          setShelfHits(hits);
          setShelfError(null);
          const current = configRef.current;
          if (hits.length === 1 && watch && current && !current.author && !current.title) {
            saveSettings(watch.id, { author: hits[0].author, title: hits[0].title });
          }
        })
        .catch((err: any) => {
          if (!alive) return;
          setShelfHits([]);
          setShelfError(err.message || '蔵書を引けません');
        })
        .finally(() => {
          if (alive) setShelfBusy(false);
        });
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [isOpen, settingsOpen, nameSource, shelfQuery, watch, saveSettings]);

  /**
   * 投入先が決まっていなければ、PowerDowner に pinax が居ればそれを既定にする。
   * 違っていれば選び直せば済む。
   */
  useEffect(() => {
    if (!config || config.userId !== null || !watch) return;
    const fallback = users.find((u) => u.name.toLowerCase() === DEFAULT_USER_NAME);
    if (!fallback) return;
    setConfig({ ...config, userId: fallback.id });
    // 画面に出すだけでなく保存もする。未保存のままだとサーバーは誰の手元の話か決められず、
    // 見出しには「pinax」と出ているのに所持の判定も巻数も付かない (投入しても弾かれる)。
    // 自分で選んだわけではないので、トーストは出さない
    const watchId = watch.id;
    api
      .saveFeedConfig(watchId, { userId: fallback.id })
      .then(() => reloadLists(watchId))
      .catch(() => {
        /* 保存できなくても画面では選べている。選び直せばそこで保存される */
      });
  }, [config, users, watch, reloadLists]);

  // 「どこが違うか」は並んでいるものの間で決まるので、区分ごとに切り分ける。
  // 下の読み込み中の分岐より前に置くこと (フックの数がレンダーで変わると React が落ちる)
  const candidateLabels = useMemo(() => splitSharedAffixes(candidates.map(candidateLabel)), [candidates]);
  const excludedLabels = useMemo(() => splitSharedAffixes(excluded.map(candidateLabel)), [excluded]);
  const sentLabels = useMemo(() => splitSharedAffixes(sent.map(candidateLabel)), [sent]);

  if (!isOpen || !watch || !config) {
    return (
      <Modal isOpen={isOpen && !!watch} onClose={onClose} title="ダウンロード投入" subtitle={watch?.title}>
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </Modal>
    );
  }

  const patch = (next: Partial<FeedConfig>) => setConfig({ ...config, ...next });
  const working = busy !== null;
  // 取り込み系は自動の洗い出しとぶつかるので止める。設定の保存は止めない
  const scanLocked = working || autoScanning;
  const currentUser = users.find((u) => u.id === config.userId) ?? null;
  // 投入済みのうち、PowerDowner に見当たらないもの (向こうでジョブを消した分)
  const missingJobs = sent.filter(isMissingJob);


  const save = (next: Partial<FeedConfig>) => {
    patch(next);
    setError(null);
    return saveSettings(watch.id, next);
  };

  /** 手入力の欄は打つたびではなく、離れたときに変わっていれば保存する */
  const saveOnBlur = (next: Partial<FeedConfig>, value: string) => {
    if (value !== focusedValue.current) save(next);
  };

  /**
   * 投入の前に、足りない設定が無いかを見る。足りなければ設定を開いて理由を出す。
   * サーバーも同じところで止めるが、送ってから弾かれるより押した時点で分かる方が早い。
   * 作品名は行から読めている (itemPattern) こともあるので、送る候補ごとに見る。
   */
  const checkReady = (targets: FeedCandidateWithState[]): boolean => {
    const problem =
      config.userId === null
        ? '投入先 (PowerDowner のユーザー) を選んでください'
        : targets.some((c) => !(config.title ?? c.meta.title))
          ? '作品名が決まっていません。蔵書から選ぶか手入力してください'
          : null;
    if (!problem) return true;
    setError(problem);
    setSettingsOpen(true);
    return false;
  };

  const handleScan = async (all: boolean) => {
    setBusy('scan');
    setError(null);
    setNotice(null);
    try {
      const result = await api.scanFeed(watch.id, all);
      setNotice(scanNotice(result));
      // 候補が出たなら説明は要らない (下の空表示に持ち越さない)
      setSamples(result.added === 0 ? result.samples : undefined);
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '候補の作成に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    if (!checkReady(candidates)) return;
    setBusy('send');
    setError(null);
    setNotice(null);
    setSamples(undefined);
    try {
      await saving.current;
      // 対象に残っているものを全部送る。落としたくないものは × で対象外にしておく
      const summary = await api.sendFeedCandidates(candidates.map((c) => c.id));
      const parts = [`${summary.sent} 件を PowerDowner に投入しました`];
      if (summary.ignored.length > 0) parts.push(`${summary.ignored.length} 件は送りませんでした`);
      if (summary.errors.length > 0) {
        // 失敗が混じったときは閉じない。何が残ったのかをこの画面で見られるように
        parts.push(summary.errors.map((e) => e.message).join(' / '));
        setNotice(parts.join('。'));
        await load(watch.id);
        return;
      }
      onNotify?.(parts.join('。'));
      onClose();
    } catch (err: any) {
      setError(err.message || '投入に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleExclude = async (ids: string[]) => {
    setBusy('exclude');
    setError(null);
    setNotice(null);
    setSamples(undefined);
    try {
      const result = await api.excludeFeedCandidates(ids);
      setNotice(`${result.excluded} 件を対象外にしました`);
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '対象外にできませんでした');
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (id: string) => {
    setBusy('restore');
    setError(null);
    setSamples(undefined);
    try {
      await api.restoreFeedCandidate(id);
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '戻せませんでした');
    } finally {
      setBusy(null);
    }
  };

  /** 巻数を直したら読み直す。所持の判定がその巻数で付け直される */
  const handleVolume = async (id: string, volume: string | null) => {
    setBusy('volume');
    setError(null);
    try {
      await api.setFeedCandidateVolume(id, volume);
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '巻数を保存できませんでした');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 投入済みを送り直す。
   *
   * 棚にある巻・ジョブが残っている巻は「取得済み」で弾かれて返ってくるので、
   * 消してしまったジョブだけが入り直る。押し間違えても二重に落ちることはない。
   */
  const handleResend = async (ids: string[]) => {
    if (!checkReady(sent.filter((c) => ids.includes(c.id)))) return;
    setBusy('resend');
    setError(null);
    setNotice(null);
    setSamples(undefined);
    try {
      await saving.current;
      const summary = await api.sendFeedCandidates(ids, true);
      const parts = [`${summary.sent} 件を投入し直しました`];
      // 「送ったのに何も起きない」ように見えるのは大抵ここなので、理由をそのまま出す
      if (summary.ignored.length > 0) parts.push(`${summary.ignored.length} 件は送りませんでした`);
      if (summary.errors.length > 0) parts.push(summary.errors.map((e) => e.message).join(' / '));
      setNotice(parts.join('。'));
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '再投入に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const labelClass = 'block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1';
  const subButton =
    'px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition disabled:opacity-40';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ダウンロード投入" subtitle={watch.title} error={error}>
      <div className="p-5 pt-4 space-y-3 overflow-y-auto">
        {/* --- 設定 (普段は畳んでおく) --- */}
        <section className="border border-slate-200 dark:border-slate-700 rounded-lg">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${settingsOpen ? '' : '-rotate-90'}`}
            />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">投入設定</span>
            <span className="ml-auto text-[11px] text-slate-400 truncate">
              {currentUser?.name ?? (config.userId === null ? '投入先が未設定' : `ID ${config.userId}`)}
              {config.autoSend ? ' · 自動' : ''}
            </span>
          </button>

          {settingsOpen && (
            <div className="px-3 pb-3 space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-2.5">
              <div>
                <label className={labelClass}>投入先 (PowerDowner のユーザー)</label>
                {users.length > 0 ? (
                  <select
                    value={config.userId ?? ''}
                    onChange={(e) => save({ userId: e.target.value === '' ? null : Number(e.target.value) })}
                    className={selectClass}
                  >
                    <option value="">選択してください</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                        {user.defaultDir ? ` (${user.defaultDir})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  // PowerDowner が止まっていると一覧を取れない。手入力に落とす。
                  // ここで ID を出したままにすると「誰に送るのか」が読めなくなるので、
                  // 名前が出ない理由と取り直す手段を必ず添える
                  <>
                    <input
                      type="number"
                      value={config.userId ?? ''}
                      onChange={(e) => patch({ userId: e.target.value === '' ? null : Number(e.target.value) })}
                      onFocus={(e) => (focusedValue.current = e.target.value)}
                      onBlur={(e) =>
                        saveOnBlur({ userId: e.target.value === '' ? null : Number(e.target.value) }, e.target.value)
                      }
                      placeholder="ユーザー ID"
                      className={inputClass}
                    />
                    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 leading-tight">
                      <span className="flex-1 min-w-0">
                        名前で選べません — {usersError ?? 'PowerDowner のユーザー一覧を取得できませんでした'}
                      </span>
                      <button
                        type="button"
                        onClick={loadUsers}
                        className="shrink-0 underline hover:no-underline"
                      >
                        取り直す
                      </button>
                    </p>
                  </>
                )}
              </div>

              {/* 作者と作品名の決め方は 2 通り。どちらか一方しか使わないので、タブで片方だけ見せる。
                  蔵書 (Pinax) から: 手で書くと棚と 1 文字違うだけで別フォルダに割れるので、
                  既に棚にある綴りをそのまま選ぶ。
                  手入力: 棚にまだ無い作品。監視 1 件 = 1 作品で、行に載っているのは巻数だけという
                  サイトが多いので、ここで 1 回決めてしまう */}
              <div>
                <div className="flex items-end justify-between gap-2 mb-1">
                  <span className={`${labelClass} !mb-0`}>作者・作品名</span>
                  <div role="tablist" className="flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-[11px]">
                    {(
                      [
                        ['pinax', '蔵書 (Pinax) から'],
                        ['manual', '手入力'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={nameSource === key}
                        onClick={() => setNameSource(key)}
                        className={`px-2 py-0.5 rounded-md transition ${
                          nameSource === key
                            ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-slate-100 shadow-sm font-medium'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {nameSource === 'pinax' ? (
                  <>
                    <div className="relative">
                      <Library className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={shelfQuery}
                        onChange={(e) => setShelfQuery(e.target.value)}
                        placeholder="作品名か作者名で探す"
                        className={`${inputClass} pl-8`}
                      />
                      {shelfBusy && (
                        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 animate-spin" />
                      )}
                    </div>

                    {shelfError ? (
                      // 蔵書が止まっていても投入設定は手入力で使える。邪魔しない濃さで出す
                      <p className="mt-1 text-[11px] text-slate-400 leading-tight">{shelfError}</p>
                    ) : shelfHits.length > 0 ? (
                      <ul className="mt-1 border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-40 overflow-y-auto">
                        {shelfHits.map((hit) => {
                          const chosen =
                            (config.title ?? '') === hit.title && (config.author ?? '') === (hit.author ?? '');
                          return (
                            <li key={hit.id}>
                              <button
                                type="button"
                                onClick={() => !chosen && save({ author: hit.author, title: hit.title })}
                                className={`w-full text-left px-2.5 py-1.5 transition ${
                                  chosen
                                    ? 'bg-indigo-50 dark:bg-indigo-900/30'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-slate-800 dark:text-slate-100">
                                    {hit.title}
                                  </span>
                                  {chosen && (
                                    <span className="shrink-0 text-[10px] text-indigo-600 dark:text-indigo-400">
                                      選択中
                                    </span>
                                  )}
                                  <span className="shrink-0 text-[10px] text-slate-400">{hit.files}冊</span>
                                </span>
                                <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">
                                  {hit.author || '作者なし'}
                                  {/* 「続きが出ている — 8〜15巻が未所持」。落とす価値がここで分かる */}
                                  {hit.shelf ? ` · ${hit.shelf}` : ''}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : shelfQuery.trim() && !shelfBusy ? (
                      <p className="mt-1 text-[11px] text-slate-400 leading-tight">
                        棚に見当たりません。「手入力」で直接書けます。
                      </p>
                    ) : null}
                    {/* 検索結果に今の設定が無いとき (手入力で決めた・検索語を変えた) も、何が入っているかは見せる */}
                    {config.title && !shelfHits.some((hit) => hit.title === config.title) && (
                      <p className="mt-1 text-[10px] text-slate-400 truncate">
                        いまの設定: {config.author ? `${config.author} / ` : ''}
                        {config.title}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={config.author ?? ''}
                      onChange={(e) => patch({ author: e.target.value || null })}
                      onFocus={(e) => (focusedValue.current = e.target.value)}
                      onBlur={(e) => saveOnBlur({ author: e.target.value || null }, e.target.value)}
                      placeholder="作者"
                      aria-label="作者"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      value={config.title ?? ''}
                      onChange={(e) => patch({ title: e.target.value || null })}
                      onFocus={(e) => (focusedValue.current = e.target.value)}
                      onBlur={(e) => saveOnBlur({ title: e.target.value || null }, e.target.value)}
                      placeholder={watch.title}
                      aria-label="作品タイトル"
                      className={inputClass}
                    />
                  </div>
                )}
              </div>

              {/* 取り込み自体は監視のチェックに付いて自動で走るので、スイッチは無い。
                  ここで決めるのは「人が見るか、そのまま送るか」だけ */}
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={config.autoSend}
                  onChange={(e) => save({ autoSend: e.target.checked })}
                  className="w-3.5 h-3.5 rounded accent-indigo-600"
                />
                次の更新分からは確認なしで投入する
              </label>
            </div>
          )}
        </section>

        {/* --- 取り込み --- */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => handleScan(true)} disabled={scanLocked} className={subButton}>
            全件を洗い出す
          </button>
          <button
            type="button"
            onClick={() => handleScan(false)}
            disabled={scanLocked}
            className={`${subButton} flex items-center gap-1`}
          >
            <RefreshCw className={`w-3 h-3 ${busy === 'scan' || autoScanning ? 'animate-spin' : ''}`} />
            増分を取り込む
          </button>
          {notice && (
            <p className="flex-1 min-w-0 text-[11px] text-indigo-600 dark:text-indigo-400 leading-tight">
              {notice}
            </p>
          )}
        </div>

        {/* --- 対象 --- */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              ダウンロード対象 ({candidates.length})
            </h3>
            {candidates.length > 0 && (
              <span className="text-[11px] text-slate-400">× で対象外へ</span>
            )}
          </div>

          {candidates.length === 0 ? (
            autoScanning ? (
              <p className="py-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ページに並んでいるものを洗い出しています...
              </p>
            ) : samples && samples.length > 0 ? (
              // 要素は取れているのに候補にならなかったとき。
              // セレクタが外れているのか、リンクが取れていないのかをここで切り分ける
              <div className="space-y-1">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {samples.some((sample) => sample.urls > 0) ? (
                    // リンクは取れている = 一度通した行。同じ行は二度と候補にならないので、
                    // 「取れなかった」ではなく「もう振り分け済み」と言う
                    <>取れた要素はどれも取り込み済みでした。対象外か投入済みに入っています。</>
                  ) : (
                    <>
                      取れた要素にリンクがありませんでした。選んだ範囲に <code>&lt;a href&gt;</code> が
                      入っていないか、リンクが別の場所にあります。
                    </>
                  )}
                </p>
                {samples.map((sample, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-1.5 bg-slate-50 dark:bg-slate-800/60 rounded text-[11px]"
                  >
                    <span
                      className={`flex-shrink-0 px-1.5 rounded font-medium ${
                        sample.urls > 0
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300'
                      }`}
                    >
                      {sample.urls}
                    </span>
                    <span className="min-w-0 break-all text-slate-600 dark:text-slate-300">
                      {sample.text || '(テキストなし)'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-5 text-center text-[11px] text-slate-400">
                {sent.length > 0 || excluded.length > 0
                  ? '投入する対象はありません。次に増えた分がここに並びます。'
                  : '「全件を洗い出す」を押すと、いまページにあるものが並びます。'}
              </p>
            )
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {candidates.map((candidate, index) => {
                const pd = candidate.powerdowner;
                const badge = pd && pd.state !== 'new' ? STATE_BADGE[pd.state] : null;
                return (
                  <li
                    key={candidate.id}
                    className="flex items-start gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800/60 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <CandidateLabel
                        parts={candidateLabels[index]}
                        bodyClass="text-slate-800 dark:text-slate-100"
                      />
                      <p className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="flex items-center gap-0.5">
                          <Link2 className="w-2.5 h-2.5" />
                          {candidate.urls.length}
                        </span>
                        <VolumeEditor
                          candidate={candidate}
                          disabled={working}
                          onSave={(volume) => handleVolume(candidate.id, volume)}
                        />
                      </p>
                    </div>
                    {badge && (
                      <span
                        className={`flex-shrink-0 mt-0.5 px-1.5 text-[10px] font-medium rounded ${badge.className}`}
                        title={pd?.reason ?? undefined}
                      >
                        {badge.label}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleExclude([candidate.id])}
                      disabled={working}
                      aria-label="対象外にする"
                      title="対象外にする (あとで戻せます)"
                      className="flex-shrink-0 p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded transition disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* --- 対象外 (振り分けを間違えたら戻せる) --- */}
        {excluded.length > 0 && (
          <section className="border-t border-slate-100 dark:border-slate-800 pt-2">
            <button
              type="button"
              onClick={() => setExcludedOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 text-left"
            >
              <ChevronDown
                className={`w-3 h-3 text-slate-400 transition-transform ${excludedOpen ? '' : '-rotate-90'}`}
              />
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                対象外 ({excluded.length})
              </span>
            </button>

            {excludedOpen && (
              <ul className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                {excluded.map((candidate, index) => (
                  <li
                    key={candidate.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800/60 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <CandidateLabel
                        parts={excludedLabels[index]}
                        bodyClass="text-slate-500 dark:text-slate-400"
                      />
                      {volumeLabel(candidate) && (
                        <p className="text-[10px] text-slate-400">{volumeLabel(candidate)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(candidate.id)}
                      disabled={working}
                      className={`${subButton} flex items-center gap-1 flex-shrink-0`}
                    >
                      <Undo2 className="w-3 h-3" />
                      戻す
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* --- 投入済み (向こうでジョブを消したときの入れ直し口) --- */}
        {sent.length > 0 && (
          <section className="border-t border-slate-100 dark:border-slate-800 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSentOpen((v) => !v)}
                className="flex items-center gap-1.5 text-left"
              >
                <ChevronDown
                  className={`w-3 h-3 text-slate-400 transition-transform ${sentOpen ? '' : '-rotate-90'}`}
                />
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  投入済み ({sent.length})
                </span>
              </button>

              {/* 畳んでいても気づけるように、消えている件数は見出しの隣に出す */}
              {missingJobs.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleResend(missingJobs.map((c) => c.id))}
                  disabled={working}
                  title="PowerDowner にジョブが無いものだけを送り直します"
                  className={`${subButton} ml-auto flex items-center gap-1 !text-amber-700 dark:!text-amber-300 !bg-amber-50 dark:!bg-amber-900/40 hover:!bg-amber-100 dark:hover:!bg-amber-900/60`}
                >
                  <RotateCcw className={`w-3 h-3 ${busy === 'resend' ? 'animate-spin' : ''}`} />
                  ジョブが無い {missingJobs.length} 件を再投入
                </button>
              )}
            </div>

            {sentOpen && (
              <ul className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
                {sent.map((candidate, index) => {
                  const badge = candidate.powerdowner
                    ? isMissingJob(candidate)
                      ? SENT_BADGE.new
                      : candidate.powerdowner.state === 'new'
                        ? null // 巻数を読めず判定に参加できていないだけ。無いとは言えない
                        : SENT_BADGE[candidate.powerdowner.state]
                    : null;
                  const sentAt = formatSentAt(candidate.sentAt);
                  return (
                    <li
                      key={candidate.id}
                      className="flex items-start gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800/60 rounded"
                    >
                      <div className="min-w-0 flex-1">
                        <CandidateLabel
                          parts={sentLabels[index]}
                          bodyClass="text-slate-600 dark:text-slate-300"
                        />
                        <p className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                          {volumeLabel(candidate) && <span>{volumeLabel(candidate)}</span>}
                          {sentAt && <span>{sentAt}</span>}
                          {/* 向こうの返答をそのまま残す。合流・スキップも「投入済み」なので、
                              何が起きたのかはこの一言でしか分からない */}
                          {candidate.resultNote && (
                            <span className="truncate" title={candidate.resultNote}>
                              {candidate.resultNote}
                            </span>
                          )}
                        </p>
                      </div>
                      {badge && (
                        <span
                          className={`flex-shrink-0 mt-0.5 px-1.5 text-[10px] font-medium rounded ${badge.className}`}
                          title={candidate.powerdowner?.reason ?? undefined}
                        >
                          {badge.label}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleResend([candidate.id])}
                        disabled={working}
                        title="もう一度 PowerDowner へ送る (持っているものは向こうで弾かれます)"
                        className={`${subButton} flex items-center gap-1 flex-shrink-0`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        再投入
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${subButton} mr-auto`}>
            閉じる
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={scanLocked || candidates.length === 0}
            className={`${submitButtonClass} !px-3 !py-1.5 !text-xs`}
          >
            {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {candidates.length} 件を投入
          </button>
        </div>
      </div>
    </Modal>
  );
};
