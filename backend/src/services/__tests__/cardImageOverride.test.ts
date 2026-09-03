import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// JsonStore と手元の画像の置き場所はモジュール読み込み時に config.dataDir から決まるため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-card-image-test-'));
process.env.DATA_DIR = tmpDir;

const {
  clearCardImage,
  decodeImageDataUrl,
  formatCrop,
  getCardImage,
  normalizeCrop,
  getCardImageOverride,
  resetCardImageCache,
  saveUploadedCardImage,
  setCardImageOverride,
} = await import('../cardImage.js');

// 監視の型は、動的 import した関数の引数から借りる
type Watch = Parameters<typeof getCardImage>[0];

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const uploadDir = path.join(tmpDir, 'card-images');

// PNG として判定される最小限のバイト列（中身は見ないので先頭だけで足りる）
const pngBytes = (marker: number) =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);

const watchOf = (id: string): Watch =>
  ({
    id,
    url: 'https://example.com/works/42',
    title: 'テスト',
    fetchBackend: 'html_requests',
    checkIntervalMinutes: 10,
    paused: false,
    lastChecked: null,
    lastChanged: null,
    hasError: false,
    lastError: null,
    includeFilters: [],
    subtractedFilters: [],
    notificationTopic: 'dryeyes',
    snapshotCount: 0,
  }) as Watch;

beforeEach(() => {
  resetCardImageCache();
});

describe('ユーザーが決めた背景', () => {
  it('「画像なし」を選ぶと、自動判定へ落ちずに絵なしになる', async () => {
    setCardImageOverride('none-1', { mode: 'none', updatedAt: new Date().toISOString() });

    // 自動判定はページを開きに行くが、指定があるので呼ばれない（＝すぐ返る）
    expect(await getCardImage(watchOf('none-1'))).toBeNull();
    expect(getCardImageOverride('none-1')?.mode).toBe('none');
  });

  it('手元の画像は切り抜きごと返る', async () => {
    const uploadFile = saveUploadedCardImage('upload-1', pngBytes(0x01));
    const crop = { x: 0, y: 0.2, width: 1, height: 0.1, ratio: 0.7 };
    setCardImageOverride('upload-1', {
      mode: 'upload',
      uploadFile,
      crop,
      updatedAt: new Date().toISOString(),
    });

    const result = await getCardImage(watchOf('upload-1'));
    expect(result?.asset.contentType).toBe('image/png');
    expect(result?.crop).toEqual(crop);
  });

  it('画像として読めないものは登録しない', () => {
    expect(() => saveUploadedCardImage('bad-1', Buffer.from('<!DOCTYPE html>'))).toThrow();
  });

  // 拡張子が変わると古い絵がそのまま残り、消したはずの画像がディスクに溜まっていく
  it('登録し直すと、前に置いた絵は残らない', () => {
    saveUploadedCardImage('replace-1', pngBytes(0x01));
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
    const second = saveUploadedCardImage('replace-1', gif);

    expect(second).toBe('replace-1.gif');
    expect(fs.readdirSync(uploadDir).filter((name) => name.startsWith('replace-1.'))).toEqual([
      'replace-1.gif',
    ]);
  });

  it('自動へ戻すと、指定も手元の絵も消える', () => {
    const uploadFile = saveUploadedCardImage('auto-1', pngBytes(0x02));
    setCardImageOverride('auto-1', { mode: 'upload', uploadFile, updatedAt: new Date().toISOString() });

    setCardImageOverride('auto-1', null);

    expect(getCardImageOverride('auto-1')).toBeNull();
    expect(fs.existsSync(path.join(uploadDir, uploadFile))).toBe(false);
  });

  it('監視を消すと、その背景の指定と絵も片付ける', () => {
    const uploadFile = saveUploadedCardImage('gone-1', pngBytes(0x03));
    setCardImageOverride('gone-1', { mode: 'upload', uploadFile, updatedAt: new Date().toISOString() });

    clearCardImage('gone-1');

    expect(getCardImageOverride('gone-1')).toBeNull();
    expect(fs.existsSync(path.join(uploadDir, uploadFile))).toBe(false);
  });

  // 監視 ID はそのままファイル名になる。所有者チェックを通った ID しか来ないが、
  // 名前の組み立てだけで置き場所の外へ出られないことを、呼び出し元に頼らず保証する。
  it('監視 ID に紛れ込んだ区切り文字では、置き場所の外へ出ない', () => {
    const uploadFile = saveUploadedCardImage('../../escape', pngBytes(0x04));
    expect(uploadFile).toBe('escape.png');
    expect(fs.existsSync(path.join(uploadDir, 'escape.png'))).toBe(true);
  });
});

// 切り抜きは画面が計算した値がそのまま届く。壊れた値を覚えると、そのカードだけ
// 絵が消えたり極端に拡大されたりして、画面から直す手立ても無くなる。
describe('切り抜きの受け渡し', () => {
  it('画像に添えるヘッダーは x,y,幅,高さ,縦横比 の順', () => {
    expect(formatCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.25, ratio: 1.5 })).toBe(
      '0.10000,0.20000,0.50000,0.25000,1.50000'
    );
  });

  it('範囲からはみ出した指定は、画像に収まるところまで戻す', () => {
    expect(normalizeCrop({ x: 5, y: -1, width: 2, height: 0.5, ratio: 0.7 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.5,
      ratio: 0.7,
    });
  });

  it('数として成り立たない指定は、切り抜きなしとして扱う', () => {
    expect(normalizeCrop(null)).toBeNull();
    expect(normalizeCrop({ x: 0, y: 0, width: 0, height: 0.5, ratio: 1 })).toBeNull();
    expect(normalizeCrop({ x: NaN, y: 0, width: 1, height: 0.5, ratio: 1 })).toBeNull();
    expect(normalizeCrop({ x: 0, y: 0, width: 1, height: 0.5, ratio: 0 })).toBeNull();
  });

  it('data: URL からバイト列を取り出す', () => {
    const png = pngBytes(0x05);
    expect(decodeImageDataUrl(`data:image/png;base64,${png.toString('base64')}`)).toEqual(png);
    expect(() => decodeImageDataUrl('https://example.com/a.png')).toThrow();
    expect(() => decodeImageDataUrl(undefined)).toThrow();
  });
});
