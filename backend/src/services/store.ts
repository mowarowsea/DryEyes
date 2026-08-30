import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// ローカル運用前提のため、DB は用意せず JSON ファイルへ永続化する。
// 起動時に全件をメモリへ読み込み、更新のたびに書き戻すシンプルな方式。
export class JsonStore<T extends object> {
  private readonly filePath: string;
  private data: T;

  constructor(fileName: string, initial: T) {
    this.filePath = path.join(config.dataDir, fileName);
    this.data = this.load(initial);
  }

  private load(initial: T): T {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return { ...initial, ...JSON.parse(raw) };
    } catch {
      // 初回起動やファイル破損時は初期値から開始する
      return initial;
    }
  }

  get(): T {
    return this.data;
  }

  // 書き込み途中でプロセスが落ちても壊れないよう、一時ファイル経由で差し替える
  update(mutator: (data: T) => void): void {
    mutator(this.data);
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
