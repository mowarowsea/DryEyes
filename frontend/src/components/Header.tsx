import React from 'react';
import { Eye, Plus, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { HealthStatus } from '../types';

interface HeaderProps {
  health: HealthStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenCreateModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  loading,
  onRefresh,
  onOpenCreateModal,
}) => {
  const isEngineConnected = health?.changedetection?.status === 'connected';

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200 shadow-sm">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-100">
            <Eye className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">DryEyes</h1>
            <div className="flex items-center space-x-1.5 mt-1">
              <span className="text-[11px] text-slate-500">エンジン:</span>
              <span className={`inline-flex items-center text-[11px] font-medium ${isEngineConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
                {isEngineConnected ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 mr-0.5 inline" />
                    接続中
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3 mr-0.5 inline" />
                    未接続
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all rounded-lg"
            title="再読み込み"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
          <button
            onClick={onOpenCreateModal}
            className="flex items-center space-x-1 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white font-medium text-sm rounded-lg shadow-sm shadow-indigo-200"
          >
            <Plus className="w-4 h-4" />
            <span>新規監視</span>
          </button>
        </div>
      </div>
    </header>
  );
};
