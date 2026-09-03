import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ZoomIn } from 'lucide-react';
import { CardImageCrop } from '../types';
import {
  CARD_IMAGE_MASK,
  CARD_IMAGE_WIDTH,
  coverCrop,
  cropBackgroundStyle,
  moveCrop,
  resizeCrop,
} from '../cardImage';

// 選んだ絵の「どこを敷くか」を決める。
//
// カードに出るのは横に細長い帯なので、縦長の表紙をそのまま敷くと真ん中の一帯しか出ない。
// 顔やタイトルがそこから外れているかどうかは絵によるため、機械では決められない。
//
// 切り抜き枠の縦横比は、下に置いた「実際のカードの見え方」の箱から測って合わせる。
// 決め打ちの比率にすると、スマホと PC で枠と実物がずれる（カードの幅が倍以上違う）。

interface CardImageCropEditorProps {
  /** 切り抜き対象の画像（候補のサムネイル、または手元で選んだファイルの object URL） */
  src: string;
  /** カードに出す名前。仕上がりの見え方を確かめるために添える。 */
  title: string;
  crop: CardImageCrop | null;
  onChange: (crop: CardImageCrop) => void;
}

export const CardImageCropEditor: React.FC<CardImageCropEditorProps> = ({
  src,
  title,
  crop,
  onChange,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // 画像の縦横比。読み込み終わるまでは枠を出しても意味がないので、それまで待つ。
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewBox, setPreviewBox] = useState<{ width: number; height: number } | null>(null);

  // 別の絵を選び直したら、比率も読み込み直す
  useEffect(() => {
    setRatio(null);
    setFailed(false);
  }, [src]);

  // 仕上がりの箱を測る。切り抜き枠の縦横比はここから決まる。
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const measure = () => setPreviewBox({ width: preview.clientWidth, height: preview.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  const boxRatio = previewBox && previewBox.height > 0 ? previewBox.width / previewBox.height : null;

  // 開いた直後は「今までどおりの見え方」（cover / center 相当）から始める。
  // いきなり絵が動くと、何を基準に調整しているのか分からなくなる。
  useEffect(() => {
    if (ratio === null || boxRatio === null) return;
    if (crop && Math.abs(crop.ratio - ratio) < 0.01) return;
    onChange(coverCrop(ratio, boxRatio));
    // crop / onChange を依存に入れると、親が作り直した関数で毎回初期化してしまう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, boxRatio]);

  // 枠のドラッグ。指でもマウスでも同じ経路を通るよう pointer イベントで受ける。
  const dragRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!crop) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, x: crop.x, y: crop.y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !crop || !frame) return;

    // 枠は画像そのものの上に重ねてあるので、動かした距離を画像に対する割合へ直せばよい
    const dx = (e.clientX - drag.pointerX) / frame.clientWidth;
    const dy = (e.clientY - drag.pointerY) / frame.clientHeight;
    onChange(moveCrop(crop, drag.x + dx, drag.y + dy));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // 拡大率は「箱いっぱいに見せる範囲」に対する倍率。1 が既定で、下げるほど一部を大きく映す。
  const zoom = crop && boxRatio !== null && ratio !== null
    ? crop.width / coverCrop(ratio, boxRatio).width
    : 1;

  const previewStyle =
    crop && previewBox && previewBox.width > 0 && previewBox.height > 0
      ? cropBackgroundStyle(crop, previewBox.width, previewBox.height)
      : null;

  return (
    <div className="space-y-3">
      {/* 仕上がり。一覧のカードと同じ組み方で出して、決めた範囲がそのまま見えるようにする。 */}
      <div>
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
          カードでの見え方
        </p>
        <div className="relative bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl px-3 py-2.5 overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 rounded-xl overflow-hidden">
            <div
              ref={previewRef}
              className="absolute inset-y-0 right-0 bg-cover bg-center opacity-80 dark:opacity-60"
              style={{
                width: CARD_IMAGE_WIDTH,
                backgroundImage: `url(${src})`,
                maskImage: CARD_IMAGE_MASK,
                WebkitMaskImage: CARD_IMAGE_MASK,
                ...previewStyle,
              }}
            />
          </div>
          <div className="relative z-10">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-tight truncate">
              {title}
            </h3>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">更新: たった今</p>
          </div>
        </div>
      </div>

      {/* 切り抜き枠。画像を実寸比で敷き、その上に枠を重ねる（枠の位置＝画像に対する割合）。 */}
      <div className="flex justify-center">
        <div
          ref={frameRef}
          className="relative overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800 select-none touch-none"
          style={{
            width: ratio ? `min(100%, ${Math.round(38 * ratio)}vh)` : '100%',
            aspectRatio: ratio ? String(ratio) : '16 / 9',
          }}
        >
          <img
            src={src}
            alt="切り抜き対象"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setRatio(img.naturalWidth / img.naturalHeight);
              }
            }}
            onError={() => setFailed(true)}
            className="absolute inset-0 w-full h-full object-fill pointer-events-none"
          />

          {crop && (
            <div
              role="presentation"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="absolute border-2 border-white rounded-sm cursor-move touch-none"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
                // 枠の外側だけを暗くする。要素を 4 枚並べるより、はみ出す影 1 枚で足りる。
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
              }}
            />
          )}

          {!ratio && !failed && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-slate-500 dark:text-slate-400">
              画像を読み込めませんでした
            </div>
          )}
        </div>
      </div>

      {/* 拡大。縦長の絵ではここを下げると、帯に収まる範囲が狭く（＝絵が大きく）なる。 */}
      <label className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <ZoomIn className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-shrink-0">拡大</span>
        <input
          type="range"
          min={20}
          max={100}
          step={1}
          // 右へ動かすほど拡大されるよう、内部で持つ「見せる範囲の広さ」とは向きを逆にする
          value={Math.round(120 - zoom * 100)}
          disabled={!crop || boxRatio === null}
          onChange={(e) => {
            if (!crop || boxRatio === null) return;
            onChange(resizeCrop(crop, boxRatio, (120 - Number(e.target.value)) / 100));
          }}
          aria-label="拡大"
          className="flex-1 accent-indigo-600"
        />
      </label>

      <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
        白い枠をドラッグして、カードに出す部分を決めます
      </p>
    </div>
  );
};
