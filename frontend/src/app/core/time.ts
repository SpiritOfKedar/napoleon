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

/** Parses the player's ?t= value. Accepts plain seconds ("872.5") and returns null for anything else. */
export function parseSeconds(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
