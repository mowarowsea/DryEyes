import { WatchModel, CreateWatchDto, WatchHistoryItem, HealthStatus } from '../types';

const API_BASE = '/api';

export const api = {
  async getHealth(): Promise<HealthStatus> {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Failed to fetch health status');
    return res.json();
  },

  async getWatches(): Promise<WatchModel[]> {
    const res = await fetch(`${API_BASE}/watches`);
    if (!res.ok) throw new Error('Failed to fetch watches');
    return res.json();
  },

  async getWatch(id: string): Promise<WatchModel> {
    const res = await fetch(`${API_BASE}/watches/${id}`);
    if (!res.ok) throw new Error('Failed to fetch watch');
    return res.json();
  },

  async createWatch(data: CreateWatchDto): Promise<WatchModel> {
    const res = await fetch(`${API_BASE}/watches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to create watch');
    }
    return res.json();
  },

  async updateWatch(id: string, data: Partial<WatchModel>): Promise<WatchModel> {
    const res = await fetch(`${API_BASE}/watches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update watch');
    return res.json();
  },

  async deleteWatch(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/watches/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete watch');
  },

  async triggerCheck(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/watches/${id}/check`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to trigger check');
  },

  async getHistory(id: string): Promise<WatchHistoryItem[]> {
    const res = await fetch(`${API_BASE}/watches/${id}/history`);
    if (!res.ok) throw new Error('Failed to fetch history');
    return res.json();
  },
};
