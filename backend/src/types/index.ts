export type FetchBackend = 'html_requests' | 'html_webdriver' | 'html_playwright';

export interface WatchModel {
  id: string; // uuid
  url: string;
  title: string;
  fetchBackend: FetchBackend;
  checkIntervalMinutes: number;
  paused: boolean;
  lastChecked: number | null; // unix timestamp
  lastChanged: number | null; // unix timestamp
  hasError: boolean;
  lastError: string | null;
  includeFilters: string[]; // css selectors / xpath
  subtractedFilters: string[]; // ignore selectors
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

export interface UpdateWatchDto {
  url?: string;
  title?: string;
  fetchBackend?: FetchBackend;
  checkIntervalMinutes?: number;
  paused?: boolean;
  includeFilters?: string[];
  subtractedFilters?: string[];
  notificationTopic?: string;
  tag?: string;
}

export interface WatchHistoryItem {
  timestamp: number;
  snapshotId: string;
}
