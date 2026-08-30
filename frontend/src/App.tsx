import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { WatchList } from './components/WatchList';
import { CreateWatchModal } from './components/CreateWatchModal';
import { HistoryModal } from './components/HistoryModal';
import { WatchModel, HealthStatus, CreateWatchDto } from './types';
import { api } from './api';

export default function App() {
  const [watches, setWatches] = useState<WatchModel[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [historyTargetWatch, setHistoryTargetWatch] = useState<WatchModel | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // データ取得
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [healthData, watchesData] = await Promise.all([
        api.getHealth().catch(() => null),
        api.getWatches().catch(() => []),
      ]);
      setHealth(healthData);
      setWatches(watchesData);
    } catch (err: any) {
      console.error(err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // 30秒ごとに自動ポーリング
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // アクションハンドラー
  const handleCreateWatch = async (data: CreateWatchDto) => {
    await api.createWatch(data);
    showToast('新しい監視対象を登録しました！');
    fetchData();
  };

  const handleTriggerCheck = async (id: string) => {
    await api.triggerCheck(id);
    showToast('チェックを開始しました');
    // 数秒後に更新結果を取得
    setTimeout(() => fetchData(true), 2500);
  };

  const handleTogglePause = async (id: string, paused: boolean) => {
    await api.updateWatch(id, { paused });
    showToast(paused ? '監視を一時停止しました' : '監視を再開しました');
    fetchData(true);
  };

  const handleDeleteWatch = async (id: string) => {
    await api.deleteWatch(id);
    showToast('監視対象を削除しました');
    fetchData();
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans pb-12">
      <Header
        health={health}
        loading={loading}
        onRefresh={() => fetchData()}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <WatchList
          watches={watches}
          onTriggerCheck={handleTriggerCheck}
          onTogglePause={handleTogglePause}
          onViewHistory={(w) => setHistoryTargetWatch(w)}
          onDelete={handleDeleteWatch}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
        />
      </main>

      {/* モーダル */}
      <CreateWatchModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateWatch}
        defaultTopic={health?.config?.defaultTopic || 'dryeyes'}
      />

      <HistoryModal
        watch={historyTargetWatch}
        isOpen={!!historyTargetWatch}
        onClose={() => setHistoryTargetWatch(null)}
      />

      {/* トースト通知 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 backdrop-blur text-white px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg animate-bounce">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
