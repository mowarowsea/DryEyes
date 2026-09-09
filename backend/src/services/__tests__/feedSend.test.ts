import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-feedsend-test-'));
process.env.DATA_DIR = tmpDir;

const { sendCandidates } = await import('../feedSend.js');
const { notesBySourceKey } = await import('../powerdowner.js');
const { addCandidates, setFeedConfig, getCandidate } = await import('../feedStore.js');
const { assignOwner } = await import('../ownership.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const OWNER = 'user-1';

const itemOf = (rawText: string) => ({
  text: rawText,
  urls: ['https://a.example/x'],
  meta: { title: '作品名', author: '著者', volume: '3', rawText },
});

/** 応答を作る。既定は全部 created 扱い */
const okResponse = (candidates: { sourceKey: string }[]) => ({
  created: candidates.map((c, i) => ({ id: `job-${i}`, url: 'https://a.example/x', meta: { sourceKey: c.sourceKey } })),
  merged: [],
  skipped: [],
  invalid: [],
  truncated: 0,
});

describe('notesBySourceKey', () => {
  it('should fold every outcome into a note keyed by sourceKey', () => {
    const notes = notesBySourceKey({
      created: [{ id: 'j1', url: 'u', meta: { sourceKey: 'k1' } }],
      merged: [{ jobId: 'j2', sourceKey: 'k2', title: 't', urls: [] }],
      skipped: [{ sourceKey: 'k3', title: 't', reason: '所持済み (第1-6巻)' }],
      invalid: [{ sourceKey: 'k4', title: 't', reason: '有効な URL がありません' }],
      truncated: 0,
    });
    expect(notes.get('k1')).toMatch(/投入しました/);
    expect(notes.get('k2')).toMatch(/合流/);
    expect(notes.get('k3')).toBe('所持済み (第1-6巻)');
    expect(notes.get('k4')).toMatch(/有効な URL/);
  });
});

describe('sendCandidates', () => {
  it('should send with the userId and destDir configured on the watch', async () => {
    assignOwner('sw1', OWNER);
    setFeedConfig('sw1', { userId: 7, destDir: 'D:\manga' });
    const [candidate] = addCandidates('sw1', [itemOf('[著者] 作品名 第01巻')]);

    const send = vi.fn(async (input: any) => okResponse(input.candidates));
    const summary = await sendCandidates([candidate.id], OWNER, { send });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ userId: 7, destDir: 'D:\manga' });
    expect(summary.sent).toBe(1);
    expect(getCandidate(candidate.id)?.status).toBe('sent');
    expect(getCandidate(candidate.id)?.resultNote).toMatch(/投入しました/);
  });

  it('should record a skip from PowerDowner as the result, not as a failure', async () => {
    assignOwner('sw2', OWNER);
    setFeedConfig('sw2', { userId: 1 });
    const [candidate] = addCandidates('sw2', [itemOf('[著者] 作品名 第02巻')]);

    const send = vi.fn(async (input: any) => ({
      created: [], merged: [], invalid: [], truncated: 0,
      skipped: [{ sourceKey: input.candidates[0].sourceKey, title: '作品名', reason: '所持済み (第1-6巻)' }],
    }));
    const summary = await sendCandidates([candidate.id], OWNER, { send });

    expect(summary.sent).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(getCandidate(candidate.id)?.resultNote).toMatch(/所持済み/);
  });

  it('should split into batches instead of letting PowerDowner truncate', async () => {
    assignOwner('sw3', OWNER);
    setFeedConfig('sw3', { userId: 1 });
    const added = addCandidates(
      'sw3',
      Array.from({ length: 25 }, (_, i) => itemOf(`[著者] 作品名 第${100 + i}巻`))
    );

    const send = vi.fn(async (input: any) => okResponse(input.candidates));
    const summary = await sendCandidates(added.map((c) => c.id), OWNER, { send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].candidates).toHaveLength(20);
    expect(send.mock.calls[1][0].candidates).toHaveLength(5);
    expect(summary.sent).toBe(25);
  });

  it('should refuse to send when the watch has no PowerDowner user', async () => {
    assignOwner('sw4', OWNER);
    const [candidate] = addCandidates('sw4', [itemOf('[著者] 作品名 第04巻')]);

    const send = vi.fn();
    const summary = await sendCandidates([candidate.id], OWNER, { send: send as never });

    expect(send).not.toHaveBeenCalled();
    expect(summary.errors[0].message).toMatch(/ユーザーが未設定/);
    expect(getCandidate(candidate.id)?.status).toBe('pending');
  });

  it('should ignore candidates belonging to someone else', async () => {
    assignOwner('sw5', 'another-user');
    setFeedConfig('sw5', { userId: 1 });
    const [candidate] = addCandidates('sw5', [itemOf('[著者] 作品名 第05巻')]);

    const send = vi.fn();
    const summary = await sendCandidates([candidate.id], OWNER, { send: send as never });

    expect(send).not.toHaveBeenCalled();
    expect(summary.ignored[0].reason).toMatch(/他のユーザー/);
  });

  it('should not send the same candidate twice', async () => {
    assignOwner('sw6', OWNER);
    setFeedConfig('sw6', { userId: 1 });
    const [candidate] = addCandidates('sw6', [itemOf('[著者] 作品名 第06巻')]);

    const send = vi.fn(async (input: any) => okResponse(input.candidates));
    await sendCandidates([candidate.id], OWNER, { send });
    const again = await sendCandidates([candidate.id], OWNER, { send });

    expect(send).toHaveBeenCalledTimes(1);
    expect(again.ignored[0].reason).toMatch(/既に投入済み/);
  });

  it('should leave a candidate pending when PowerDowner did not report it', async () => {
    assignOwner('sw7', OWNER);
    setFeedConfig('sw7', { userId: 1 });
    const [candidate] = addCandidates('sw7', [itemOf('[著者] 作品名 第07巻')]);

    const send = vi.fn(async () => ({ created: [], merged: [], skipped: [], invalid: [], truncated: 1 }));
    const summary = await sendCandidates([candidate.id], OWNER, { send });

    expect(summary.sent).toBe(0);
    expect(getCandidate(candidate.id)?.status).toBe('pending');
    expect(summary.ignored[0].reason).toMatch(/次回/);
  });

  it('should keep going when one watch fails', async () => {
    assignOwner('sw8', OWNER);
    assignOwner('sw9', OWNER);
    setFeedConfig('sw8', { userId: 1 });
    setFeedConfig('sw9', { userId: 2 });
    const [bad] = addCandidates('sw8', [itemOf('[著者] 作品名 第08巻')]);
    const [good] = addCandidates('sw9', [itemOf('[著者] 作品名 第09巻')]);

    const send = vi.fn(async (input: any) => {
      if (input.userId === 1) throw new Error('PowerDowner に接続できません');
      return okResponse(input.candidates);
    });
    const summary = await sendCandidates([bad.id, good.id], OWNER, { send });

    expect(summary.errors).toHaveLength(1);
    expect(summary.sent).toBe(1);
    expect(getCandidate(bad.id)?.status).toBe('pending');
    expect(getCandidate(good.id)?.status).toBe('sent');
  });
});
