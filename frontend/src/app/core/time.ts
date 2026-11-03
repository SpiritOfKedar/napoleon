/** Formats seconds as HH:MM:SS (fractions are truncated; negative/invalid input gives 00:00:00). */
export function formatTimestamp(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00:00';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Clock-style position: "4:05", "34:51", "1:02:10" (hours only when needed). */
export function formatClock(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00';
  }
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Time remaining in plain words: "Less than a minute remaining", "About 4 minutes remaining". */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  if (seconds < 60) {
    return 'Less than a minute remaining';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `About ${h} hr ${m} min remaining` : `About ${h} hr remaining`;
}

/** Duration as "1h 08m", "4m 12s", "36s" for lists. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '—';
  }
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}

/** Parses the player's ?t= value. Accepts plain seconds ("872.5") and returns null for anything else. */
export function parseSeconds(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
