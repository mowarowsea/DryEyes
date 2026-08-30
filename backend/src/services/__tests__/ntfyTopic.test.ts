import { describe, it, expect } from 'vitest';
import {
  buildUserTopic,
  buildWatchClickUrl,
  scopeTopicToUser,
  toAppriseNtfyUrl,
  toNtfyTopic,
  withClickParam,
} from '../ntfyTopic.js';

describe('ntfy topic helpers', () => {
  it('should sanitize notification topics that ntfy would reject', () => {
    // 英字が残るケースはそのままスラグ化して可読性を保つ
    expect(toNtfyTopic('My Watch (Prices)', 'dryeyes')).toBe('My-Watch-Prices');
    expect(toNtfyTopic('ぐらんぶる (Raw - Free)', 'dryeyes')).toBe('Raw-Free');
    expect(toNtfyTopic('', 'dryeyes')).toBe('dryeyes');
    // 英字が残らない場合はタイトル由来のハッシュにフォールバックする
    expect(toNtfyTopic('価格 / 在庫', 'dryeyes')).toMatch(/^dryeyes-[0-9a-f]{8}$/);
    expect(toNtfyTopic('第111話', 'dryeyes')).toMatch(/^dryeyes-[0-9a-f]{8}$/);
    // 同じタイトルからは常に同じトピックが得られる
    expect(toNtfyTopic('第111話', 'dryeyes')).toBe(toNtfyTopic('第111話', 'dryeyes'));
  });

  it('should build Apprise-compatible ntfy URLs', () => {
    expect(toAppriseNtfyUrl('http://host.docker.internal:8085', 'alerts'))
      .toBe('ntfy://host.docker.internal:8085/alerts');
    expect(toAppriseNtfyUrl('https://ntfy.sh', 'alerts'))
      .toBe('ntfys://ntfy.sh/alerts');
  });

  it('should build a valid unique topic per user', () => {
    expect(buildUserTopic('alice', 'user-id-1', 'dryeyes')).toMatch(/^dryeyes-alice-[0-9a-f]{6}$/);
    // ユーザー名が日本語でも ntfy が受け付ける文字だけになる
    expect(buildUserTopic('たろう', 'user-id-2', 'dryeyes')).toMatch(/^dryeyes-[0-9a-f]{6}$/);
    expect(buildUserTopic('たろう', 'user-id-2', 'dryeyes')).toMatch(/^[-_A-Za-z0-9]{1,64}$/);
    // 同名ユーザーでも ID が違えば別トピックになる
    expect(buildUserTopic('alice', 'user-id-1', 'dryeyes'))
      .not.toBe(buildUserTopic('alice', 'user-id-2', 'dryeyes'));
  });

  it('should keep every watch topic inside the owner namespace', () => {
    const alice = 'dryeyes-alice-aaaaaa';
    const bob = 'dryeyes-bob-bbbbbb';

    // 未指定ならユーザー共通トピックへまとめる
    expect(scopeTopicToUser(alice)).toBe(alice);
    expect(scopeTopicToUser(alice, '')).toBe(alice);
    expect(scopeTopicToUser(alice, alice)).toBe(alice);

    // 監視ごとに分けたい場合もユーザートピック配下に閉じ込める
    expect(scopeTopicToUser(alice, '価格チェック')).toMatch(new RegExp(`^${alice}-`));

    // 同じ監視名でもユーザーが違えば別トピック（他ユーザーに通知が漏れない）
    expect(scopeTopicToUser(alice, 'My Watch')).toBe(`${alice}-My-Watch`);
    expect(scopeTopicToUser(bob, 'My Watch')).toBe(`${bob}-My-Watch`);
    expect(scopeTopicToUser(alice, 'My Watch')).not.toBe(scopeTopicToUser(bob, 'My Watch'));

    // 保存済みのスコープ済みトピックを渡しても二重に前置されない
    expect(scopeTopicToUser(alice, `${alice}-My-Watch`)).toBe(`${alice}-My-Watch`);

    // ntfy の制限（[-_A-Za-z0-9]{1,64}）を必ず満たす
    const long = scopeTopicToUser(alice, 'とても長い日本語のタイトルをつけた監視対象のページ');
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[-_A-Za-z0-9]{1,64}$/);
  });

  it('should build a click url that changedetection.io expands per watch', () => {
    // UUID は Jinja トークンのまま。changedetection.io が通知送信時に展開する
    expect(buildWatchClickUrl('http://192.168.0.10:3010/')).toBe(
      'http://192.168.0.10:3010/?watch={{watch_uuid}}'
    );
  });

  it('should attach the click url without encoding the jinja braces', () => {
    const url = toAppriseNtfyUrl(
      'http://host.docker.internal:8085',
      'alerts',
      'http://192.168.0.10:3010/?watch={{watch_uuid}}'
    );

    expect(url).toBe(
      'ntfy://host.docker.internal:8085/alerts' +
        '?click=http%3A%2F%2F192.168.0.10%3A3010%2F%3Fwatch%3D{{watch_uuid}}'
    );
  });

  it('should replace an existing click while keeping other parameters', () => {
    const replaced = withClickParam(
      'ntfy://host:8085/alerts?priority=high&click=http%3A%2F%2Fold%2F',
      'http://new:3010/?watch={{watch_uuid}}'
    );

    expect(replaced).toBe(
      'ntfy://host:8085/alerts?priority=high' +
        '&click=http%3A%2F%2Fnew%3A3010%2F%3Fwatch%3D{{watch_uuid}}'
    );
  });
});
