import type { GpsLog } from '@laptimer/timing';

// shortcut: localStorage (~5 MB) holds the last few sessions; move to IndexedDB if logs need to outlive more drives.
const KEY = 'gps-logs';
const KEEP = 5;

export function listLogs(): GpsLog[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as GpsLog[];
  } catch {
    return [];
  }
}

/** Insert or replace (by recordedAt), newest first; drops the oldest when storage is full. */
export function saveLog(log: GpsLog) {
  let logs = [log, ...listLogs().filter((l) => l.recordedAt !== log.recordedAt)].slice(0, KEEP);
  while (logs.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(logs));
      return;
    } catch {
      logs = logs.slice(0, -1);
    }
  }
}

export function deleteLog(recordedAt: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listLogs().filter((l) => l.recordedAt !== recordedAt)));
  } catch {
    /* storage blocked: nothing to delete */
  }
}

export function downloadLog(log: GpsLog) {
  const name = `gps-${log.route.name.replace(/[^\w-]+/g, '_')}-${new Date(log.recordedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(log)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
