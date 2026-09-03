import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Ban, Check, Image as ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react';
import {
  CardImageChoice,
  CardImageCrop,
  CardImageOptions,
  SaveCardImageRequest,
  WatchModel,
} from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { CardImageCropEditor } from './CardImageCropEditor';
import { cancelButtonClass, submitButtonClass } from '../ui';

// カードの背景に敷く絵を選び直す。
//
// 絵は普段 BFF が推測している（OGP と監視対象セレクタの近くの画像）が、
// サイト共通のロゴを掴んだり、一覧の 1 コマ目を掴んだりと外すこともある。
// ここでは同じ材料をぜんぶ並べて人に選ばせ、手元の画像も受け付ける。
//
// 候補集めは監視対象サイトを実際にブラウザで開くため、数十秒かかることがある。

// 手元から登録できる大きさの上限。BFF 側も同じところで弾くが、
// 送ってから失敗すると待たせるだけなので、選んだ時点で知らせる。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// 選んだ絵。url は候補、upload は手元のファイル。
type Pick =
  | { kind: 'url'; url: string; src: string }
  | { kind: 'upload'; file: File; src: string };

interface CardImageModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
  /** 保存できたら呼ぶ。一覧側で覚えている絵を捨てて取り直させる。 */
  onSaved: (watchId: string, message: string) => void;
}

// File を data: URL にする。画像は JSON に載せて送る（専用の口を増やさない）。
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

export const CardImageModal: React.FC<CardImageModalProps> = ({ watch, isOpen, onClose, onSaved }) => {
  const [options, setOptions] = useState<CardImageOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 候補のサムネイル（url -> object URL）。BFF 経由でしか読めないので取ってから貼る。
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  // 取ってこられなかった候補。カード背景も同じ経路で取るので、選ばせても敷けない。
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [crop, setCrop] = useState<CardImageCrop | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 作った object URL は閉じるときにまとめて捨てる
  const objectUrls = useRef<string[]>([]);

  const watchId = watch?.id ?? null;

  useEffect(() => {
    if (!isOpen || !watchId) return;

    setOptions(null);
    setPick(null);
    setCrop(null);
    setUnavailable([]);
    setError(null);
    setLoading(true);

    let alive = true;
    api
      .getCardImageOptions(watchId)
      .then((result) => {
        if (!alive) return;
        setOptions(result);
        // 候補のサムネイルは 1 枚ずつ届き次第出す。全部揃うまで白いままにしない。
        for (const candidate of result.candidates) {
          api
            .getCardImageCandidateBlob(watchId, candidate.url)
            .then((blob) => {
              if (!alive) return;
              if (!blob) {
                setUnavailable((prev) => [...prev, candidate.url]);
                return;
              }
              const src = URL.createObjectURL(blob);
              objectUrls.current.push(src);
              setThumbnails((prev) => ({ ...prev, [candidate.url]: src }));
            })
            .catch(() => {
              if (alive) setUnavailable((prev) => [...prev, candidate.url]);
            });
        }
      })
      .catch((err: any) => {
        if (alive) setError(err.message || '候補の取得に失敗しました');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [isOpen, watchId]);

  // 閉じたら覚えている絵を捨てる。開き直したときは取り直す。
  useEffect(() => {
    if (isOpen) return;
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    setThumbnails({});
  }, [isOpen]);

  if (!isOpen || !watch) return null;

  const save = async (body: SaveCardImageRequest, message: string) => {
    try {
      setSaving(true);
      setError(null);
      await api.saveCardImage(watch.id, body);
      onSaved(watch.id, message);
      onClose();
    } catch (err: any) {
      setError(err.message || '背景画像の変更に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePickCandidate = (candidate: CardImageChoice) => {
    const src = thumbnails[candidate.url];
    if (!src) return; // まだ取れていない絵は切り抜けない
    setPick({ kind: 'url', url: candidate.url, src });
    // 同じ絵を選び直したときだけ、保存してある切り抜きから続ける
    setCrop(candidate.current ? options?.crop ?? null : null);
  };

  const handleSelectFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('画像が大きすぎます（4MB まで）');
      return;
    }
    setError(null);
    const src = URL.createObjectURL(file);
    objectUrls.current.push(src);
    setPick({ kind: 'upload', file, src });
    setCrop(null);
  };

  const handleConfirm = async () => {
    if (!pick) return;
    if (pick.kind === 'url') {
      await save({ mode: 'url', url: pick.url, crop }, '背景画像を変更しました');
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(pick.file);
      await save({ mode: 'upload', dataUrl, crop }, '背景画像を登録しました');
    } catch (err: any) {
      setError(err.message || '画像を読み込めませんでした');
    }
  };

  // 取れなかった候補は並べない。押しても切り抜けないし、選べてもカードには出ない。
  const candidates = (options?.candidates ?? []).filter((c) => !unavailable.includes(c.url));

  const tileClass =
    'relative rounded-xl overflow-hidden border transition active:scale-95 disabled:opacity-50 disabled:active:scale-100';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="背景画像を変更"
      subtitle={watch.title}
      icon={<ImageIcon className="w-5 h-5 text-indigo-500 flex-shrink-0" />}
      error={error}
      size="md"
    >
      {pick ? (
        // ── 切り抜きを決める ────────────────────────────────
        <>
          <div className="p-5 overflow-y-auto">
            <CardImageCropEditor src={pick.src} title={watch.title} crop={crop} onChange={setCrop} />
          </div>
          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setPick(null)}
              disabled={saving}
              className={`${cancelButtonClass} flex items-center gap-1.5`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              選び直す
            </button>
            <button type="button" onClick={handleConfirm} disabled={saving} className={submitButtonClass}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? '保存中...' : 'この絵にする'}
            </button>
          </div>
        </>
      ) : (
        // ── 絵を選ぶ ────────────────────────────────────────
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            監視対象のページを開いて、背景に使えそうな画像を集めました。
            選んだあとで、カードのどこを見せるかも決められます。
          </p>

          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ページを開いて候補を探しています...
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                実際に表示される内容に合わせるため、少し時間がかかります
              </span>
            </div>
          ) : (
            <>
              {candidates.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {candidates.map((candidate) => {
                    const thumbnail = thumbnails[candidate.url];
                    return (
                      <button
                        key={candidate.url}
                        type="button"
                        onClick={() => handlePickCandidate(candidate)}
                        disabled={!thumbnail}
                        title={candidate.url}
                        className={`${tileClass} aspect-[4/3] bg-slate-100 dark:bg-slate-800 ${
                          candidate.current
                            ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                        }`}
                      >
                        {thumbnail ? (
                          <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-slate-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                          </span>
                        )}
                        {candidate.current && (
                          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold">
                            表示中
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {options && candidates.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  このページからは背景に使えそうな画像が見つかりませんでした
                </div>
              )}

              {options?.browserFailed && (
                <div className="p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 rounded-xl text-[11px] flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  <span>
                    ページをブラウザで開けなかったため、候補が少なくなっています。Docker
                    が動いているか確認してください。
                  </span>
                </div>
              )}

              {/* 候補に無い絵を使う・絵をやめる・自動判定へ戻す */}
              <div className="space-y-2 pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handleSelectFile(e.target.files?.[0]);
                    // 同じファイルを選び直しても change が起きるようにする
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="w-full px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center gap-2"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                  手元の画像を使う
                </button>

                <button
                  type="button"
                  onClick={() => save({ mode: 'none' }, '背景画像を消しました')}
                  disabled={saving}
                  className={`w-full px-3 py-2.5 text-xs font-medium rounded-xl border transition flex items-center gap-2 ${
                    options?.mode === 'none'
                      ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-500/40'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5 text-slate-400" />
                  画像なし
                </button>

                <button
                  type="button"
                  onClick={() => save({ mode: 'auto' }, '背景画像を自動に戻しました')}
                  disabled={saving || options?.mode === 'auto'}
                  className="w-full px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-slate-400" />
                  自動で選ぶ（おまかせ）
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};
