export type FetchBackend = 'html_requests' | 'html_webdriver' | 'html_playwright';

export interface WatchModel {
  id: string;
  url: string;
  title: string;
  fetchBackend: FetchBackend;
  checkIntervalMinutes: number;
  paused: boolean;
  lastChecked: number | null;
  lastChanged: number | null;
  hasError: boolean;
  lastError: string | null;
  includeFilters: string[];
  subtractedFilters: string[];
  notificationTopic: string;
  tag?: string;
}

export interface CreateWatchDto {
  url: string;
  title?: string;
  fetchBackend?: FetchBackend;
  checkIntervalMinutes?: number;
  includeFilters?: string[];
  subtractedFilters?: string[];
  notificationTopic?: string;
  tag?: string;
}

export interface WatchHistoryItem {
  timestamp: number;
  snapshotId: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  config: {
    changedetectionUrl: string;
    ntfyUrl: string;
    defaultTopic: string;
  };
  changedetection: {
    status: string;
    info: any;
  };
}
