import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-feed-test-'));
process.env.DATA_DIR = tmpDir;

const {
  getFeedConfig, setFeedConfig, getPointer, setPointer,
  addCandidates, listCandidates, markSent, dismissCandidate, restoreCandidate,
  setCandidateVolume,
  clearFeedState, pruneFeedState,
} = await import('../feedStore.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const meta = (rawText: string) => ({ title: '作品名', author: '著者', volume: '3', rawText });
const item = (rawText: string, urls = ['https://a.example/3']) => ({ text: rawText, urls, meta: meta(rawText) });

describe('feed config', () => {
  it('should default to asking before it sends anything', () => {
    expect(getFeedConfig('w-new')).toEqual({
      autoSend: false, author: null, title: null,
      itemPattern: null, group: null, userId: null, destDir: null,
    });
  });

  it('should merge partial updates', () => {
    setFeedConfig('w-cfg', { autoSend: true });
    setFeedConfig('w-cfg', { userId: 3 });
    expect(getFeedConfig('w-cfg')).toMatchObject({ autoSend: true, userId: 3, itemPattern: null });
  });
});

describe('feed pointer', () => {
  it('should be absent until the watch is scanned', () => {
    expect(getPointer('w-ptr')).toBeNull();
  });

  it('should record how far the watch has been turned into candidates', () => {
    setPointer('w-ptr', 1757000000);
    expect(getPointer('w-ptr')?.snapshotTimestamp).toBe(1757000000);
  });
});

describe('addCandidates', () => {
  it('should add one candidate per item', () => {
    const added = addCandidates('w1', [item('[著者] 作品名 第03巻')]);
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe('pending');
    expect(added[0].urls).toEqual(['https://a.example/3']);
    expect(added[0].meta.author).toBe('著者');
  });

  it('should not add the same line twice', () => {
    addCandidates('w2', [item('[著者] 作品名 第05巻')]);
    const again = addCandidates('w2', [item('[著者] 作品名 第05巻')]);
    expect(again).toHaveLength(0);
    expect(listCandidates({ watchId: 'w2' })).toHaveLength(1);
  });

  it('should not resurrect a candidate that was dismissed', () => {
    const [added] = addCandidates('w3', [item('[著者] 作品名 第07巻')]);
    dismissCandidate(added.id);
    expect(addCandidates('w3', [item('[著者] 作品名 第07巻')])).toHaveLength(0);
    expect(listCandidates({ watchId: 'w3', status: 'dismissed' })).toHaveLength(1);
  });

  it('should keep the same text separate per watch', () => {
    addCandidates('w4', [item('[著者] 作品名 第09巻')]);
    expect(addCandidates('w5', [item('[著者] 作品名 第09巻')])).toHaveLength(1);
  });
});

describe('exclude and restore', () => {
  it('should move an excluded candidate out of the pending list', () => {
    const [added] = addCandidates('wx', [item('[著者] 作品名 第21巻')]);
    dismissCandidate(added.id);

    expect(listCandidates({ watchId: 'wx', status: 'pending' })).toHaveLength(0);
    expect(listCandidates({ watchId: 'wx', status: 'dismissed' })).toHaveLength(1);
  });

  it('should put a restored candidate back in the pending list', () => {
    const [added] = addCandidates('wy', [item('[著者] 作品名 第23巻')]);
    dismissCandidate(added.id);

    const restored = restoreCandidate(added.id);
    expect(restored?.status).toBe('pending');
    expect(listCandidates({ watchId: 'wy', status: 'pending' })).toHaveLength(1);
    expect(listCandidates({ watchId: 'wy', status: 'dismissed' })).toHaveLength(0);
  });

  it('should not resurrect an excluded candidate on the next scan', () => {
    const [added] = addCandidates('wz', [item('[著者] 作品名 第25巻')]);
    dismissCandidate(added.id);
    expect(addCandidates('wz', [item('[著者] 作品名 第25巻')])).toHaveLength(0);
  });
});

describe('markSent', () => {
  it('should record the reply from PowerDowner, including a skip', () => {
    const [added] = addCandidates('w6', [item('[著者] 作品名 第11巻')]);
    const sent = markSent(added.id, '所持済み (第1-6巻) のためスキップ');
    expect(sent?.status).toBe('sent');
    expect(sent?.resultNote).toMatch(/スキップ/);
    expect(sent?.sentAt).toBeTruthy();
  });

  it('should return null for an unknown id', () => {
    expect(markSent('nope', null)).toBeNull();
  });
});

describe('setCandidateVolume', () => {
  it('should overwrite the volume PowerDowner reads first, keeping the rest', () => {
    const [added] = addCandidates('w8', [item('RionkuuruSenki v05 DL.rar')]);
    const updated = setCandidateVolume(added.id, '5');
    expect(updated?.meta.volume).toBe('5');
    expect(updated?.meta.rawText).toBe('RionkuuruSenki v05 DL.rar');
    expect(updated?.status).toBe('pending');
  });

  it('should clear back to reading from the raw text', () => {
    const [added] = addCandidates('w8', [item('RionkuuruSenki v06se.rar')]);
    expect(setCandidateVolume(added.id, null)?.meta.volume).toBeNull();
  });

  it('should return null for an unknown id', () => {
    expect(setCandidateVolume('nope', '1')).toBeNull();
  });
});

describe('cleanup', () => {
  it('should drop everything belonging to a deleted watch', () => {
    addCandidates('w7', [item('[著者] 作品名 第13巻')]);
    setFeedConfig('w7', { userId: 5 });
    setPointer('w7', 123);

    clearFeedState('w7');
    expect(listCandidates({ watchId: 'w7' })).toHaveLength(0);
    expect(getPointer('w7')).toBeNull();
    expect(getFeedConfig('w7').userId).toBeNull();
  });

  it('should prune watches that disappeared from changedetection.io', () => {
    addCandidates('w8', [item('[著者] 作品名 第15巻')]);
    setPointer('w8', 456);
    addCandidates('w9', [item('[著者] 作品名 第17巻')]);

    pruneFeedState(['w9']);
    expect(listCandidates({ watchId: 'w8' })).toHaveLength(0);
    expect(getPointer('w8')).toBeNull();
    expect(listCandidates({ watchId: 'w9' })).toHaveLength(1);
  });
});
