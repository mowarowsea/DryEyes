import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RedirectProposal } from '../../types/index.js';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-redirect-test-'));
process.env.DATA_DIR = tmpDir;

// 監視 1 件ごとに行き先ホストだけを覚えていた頃の記録。読み込み時に捨てられることを確かめる。
fs.writeFileSync(
  path.join(tmpDir, 'watch-redirects.json'),
  JSON.stringify({
    pending: {},
    decisions: {
      'legacy-watch': { allowedHosts: ['example.other'], deniedHosts: [] },
    },
  })
);

const {
  allowRedirect,
  clearPendingRedirect,
  clearRedirectState,
  denyRedirect,
  getDecisions,
  getPendingRedirect,
  hostPairOf,
  isAllowedRedirect,
  isDeniedRedirect,
  listPendingRedirects,
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
    expect(listPendingRedirects()).toEqual([
      { watchId: 'watch-1', proposal: expect.objectContaining({ toUrl: 'https://example.other/list' }) },
    ]);

    clearPendingRedirect('watch-1');
    expect(getPendingRedirect('watch-1')).toBeNull();
  });

  it('should key a decision on the from/to host pair, ignoring path and www', () => {
    expect(hostPairOf('https://www.example.com/a?x=1', 'https://example.other/b')).toEqual({
      from: 'example.com',
      to: 'example.other',
    });
    expect(hostPairOf('not a url', 'https://example.other/b')).toBeNull();
  });

  it('should remember an approved move for the user so the same move is not asked again', () => {
    allowRedirect('user-1', 'https://example.com/list', 'https://example.other/list');

    expect(isAllowedRedirect('user-1', 'https://example.com/list', 'https://example.other/list')).toBe(true);
    // 判断はホストの組。同じ移転ならパスが違っても聞き直さない。
    expect(isAllowedRedirect('user-1', 'https://example.com/other', 'https://example.other/other-page')).toBe(true);
    // www の有無だけの違いも同じホストとして扱う
    expect(isAllowedRedirect('user-1', 'https://example.com/list', 'https://www.example.other/list')).toBe(true);
    // 転送元が違えば別の移転。同じ行き先でも聞く。
    expect(isAllowedRedirect('user-1', 'https://example.net/list', 'https://example.other/list')).toBe(false);
    // 逆向きは自動では許可しない（承認時に呼び出し側が明示的に足す）
    expect(isAllowedRedirect('user-1', 'https://example.other/list', 'https://example.com/list')).toBe(false);
    // 別のユーザーには効かない
    expect(isAllowedRedirect('user-2', 'https://example.com/list', 'https://example.other/list')).toBe(false);
    // 承認していない行き先は対象外
    expect(isAllowedRedirect('user-1', 'https://example.com/list', 'https://example.parking/list')).toBe(false);
  });

  it('should remember a rejected move so it is not proposed again', () => {
    denyRedirect('user-3', 'https://example.com/list', 'https://example.parking/list');
    expect(isDeniedRedirect('user-3', 'https://example.com/list', 'https://example.parking/list')).toBe(true);
    expect(isAllowedRedirect('user-3', 'https://example.com/list', 'https://example.parking/list')).toBe(false);
    expect(isDeniedRedirect('user-4', 'https://example.com/list', 'https://example.parking/list')).toBe(false);
  });

  it('should replace an earlier decision when the user changes their mind', () => {
    allowRedirect('user-5', 'https://example.com/list', 'https://example.other/list');
    denyRedirect('user-5', 'https://example.com/list', 'https://example.other/list');

    expect(isDeniedRedirect('user-5', 'https://example.com/list', 'https://example.other/list')).toBe(true);
    // 承認と却下の両方に載ったままにしない
    expect(isAllowedRedirect('user-5', 'https://example.com/list', 'https://example.other/list')).toBe(false);

    allowRedirect('user-5', 'https://example.com/list', 'https://example.other/list');
    expect(isAllowedRedirect('user-5', 'https://example.com/list', 'https://example.other/list')).toBe(true);
    expect(isDeniedRedirect('user-5', 'https://example.com/list', 'https://example.other/list')).toBe(false);
    // 同じ組を何度答えても記録は 1 つ
    expect(getDecisions('user-5').allowed).toHaveLength(1);
  });

  it('should not crash on a malformed URL', () => {
    allowRedirect('user-6', 'not a url', 'https://example.other/list');
    expect(isAllowedRedirect('user-6', 'not a url', 'https://example.other/list')).toBe(false);
    expect(getDecisions('user-6')).toEqual({ allowed: [], denied: [] });
  });

  it('should drop the proposal but keep the user decision when a watch is deleted', () => {
    setPendingRedirect('watch-7', proposalTo('https://example.other/list'));
    allowRedirect('user-7', 'https://example.com/list', 'https://example.other/list');

    clearRedirectState('watch-7');

    expect(getPendingRedirect('watch-7')).toBeNull();
    // 判断は監視ではなくユーザーのもの。監視を消しても、次に登録した監視で聞き直さない。
    expect(isAllowedRedirect('user-7', 'https://example.com/list', 'https://example.other/list')).toBe(true);
  });

  it('should prune proposals of watches that no longer exist', () => {
    setPendingRedirect('watch-8', proposalTo('https://example.other/list'));
    setPendingRedirect('watch-9', proposalTo('https://example.other/list'));

    pruneRedirectState(['watch-9']);

    expect(getPendingRedirect('watch-8')).toBeNull();
    expect(getPendingRedirect('watch-9')?.toUrl).toBe('https://example.other/list');
  });

  it('should discard per-watch decisions written by the old format', () => {
    // 古い形の記録は組へ直せないので捨てる。残しておくと誰の判断でもない鍵が居座り続ける。
    expect(getDecisions('legacy-watch')).toEqual({ allowed: [], denied: [] });
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'watch-redirects.json'), 'utf-8'));
    expect(saved.decisions['legacy-watch']).toBeUndefined();
  });
});
