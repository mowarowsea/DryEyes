import { defineConfig } from 'vitest/config';

// テストは src/ のものだけを走らせる。
// 既定の探索範囲は dist/ も含むため、指定しないとビルド済みの古いテストまで拾い、
// 「同じテストが 2 度走り、片方は前回ビルド時のコードを検証している」状態になる。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
