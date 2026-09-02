import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RedirectProposal } from '../../types/index.js';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-redirect-test-'));
process.env.DATA_DIR = tmpDir;

const {
  allowRedirectHost,
  clearPendingRedirect,
  clearRedirectState,
  denyRedirectHost,
  getPendingRedirect,
  isAllowedRedirect,
  isDeniedRedirect,
  pruneRedirectState,
  setPendingRedirect,
} = await import('../redirectReview.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const proposalTo = (toUrl: string): RedirectProposal => ({
  fromUrl: 'https://example.com/list',
  toUrl,
  chain: ['https://example.com/list', toUrl],
  status: 302,
  permanent: false,
  hostChanged: true,
  detectedAt: new Date().toISOString(),
  selectorFound: true,
  toTitle: 'ミラーサイト',
});

describe('redirectReview', () => {
  it('should hold a proposal until it is answered', () => {
    expect(getPendingRedirect('watch-1')).toBeNull();

    setPendingRedirect('watch-1', proposalTo('https://example.other/list'));
    expect(getPendingRedirect('watch-1')?.toUrl).toBe('https://example.other/list');

    clearPendingRedirect('watch-1');
    expect(getPendingRedirect('watch-1')).toBeNull();
  });

  it('should remember an approved host so the same move is not asked again', () => {
    allowRedirectHost('watch-2', 'https://example.other/list');

    expect(isAllowedRedirect('watch-2', 'https://example.other/list')).toBe(true);
    // 判断はホスト単位。同じ移転先ならパスが違っても聞き直さない。
    expect(isAllowedRedirect('watch-2', 'https://example.other/other-page')).toBe(true);
    // www の有無だけの違いも同じホストとして扱う
    expect(isAllowedRedirect('watch-2', 'https://www.example.other/list')).toBe(true);
    // 別の監視には効かない
    expect(isAllowedRedirect('watch-3', 'https://example.other/list')).toBe(false);
    // 承認していないホストは対象外
    expect(isAllowedRedirect('watch-2', 'https://example.parking/list')).toBe(false);
  });

  it('should remember a rejected host so it is not proposed again', () => {
    denyRedirectHost('watch-4', 'https://example.parking/list');
    expect(isDeniedRedirect('watch-4', 'https://example.parking/list')).toBe(true);
    expect(isAllowedRedirect('watch-4', 'https://example.parking/list')).toBe(false);
  });

  it('should replace an earlier decision when the user changes their mind', () => {
    allowRedirectHost('watch-5', 'https://example.other/list');
    denyRedirectHost('watch-5', 'https://example.other/list');

    expect(isDeniedRedirect('watch-5', 'https://example.other/list')).toBe(true);
    // 承認と却下の両方に載ったままにしない
    expect(isAllowedRedirect('watch-5', 'https://example.other/list')).toBe(false);

    allowRedirectHost('watch-5', 'https://example.other/list');
    expect(isAllowedRedirect('watch-5', 'https://example.other/list')).toBe(true);
    expect(isDeniedRedirect('watch-5', 'https://example.other/list')).toBe(false);
  });

  it('should not crash on a malformed URL', () => {
    allowRedirectHost('watch-6', 'not a url');
    expect(isAllowedRedirect('watch-6', 'not a url')).toBe(false);
  });

  it('should drop everything for a deleted watch', () => {
    setPendingRedirect('watch-7', proposalTo('https://example.other/list'));
    allowRedirectHost('watch-7', 'https://example.other/list');

    clearRedirectState('watch-7');

    expect(getPendingRedirect('watch-7')).toBeNull();
    expect(isAllowedRedirect('watch-7', 'https://example.other/list')).toBe(false);
  });

  it('should prune records of watches that no longer exist', () => {
    setPendingRedirect('watch-8', proposalTo('https://example.other/list'));
    allowRedirectHost('watch-8', 'https://example.other/list');
    setPendingRedirect('watch-9', proposalTo('https://example.other/list'));

    pruneRedirectState(['watch-9']);

    expect(getPendingRedirect('watch-8')).toBeNull();
    expect(isAllowedRedirect('watch-8', 'https://example.other/list')).toBe(false);
    expect(getPendingRedirect('watch-9')?.toUrl).toBe('https://example.other/list');
  });
});
