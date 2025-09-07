export const ALL_TIME_KEY = 'lb:alltime';

export function weeklyKey(weekId: number) {
  return `lb:weekly:${weekId}`;
}

/**
 * ISO week ID as YYYYWW (e.g., 202536).
 * Calculated in UTC to keep it consistent for all players.
 */
export function getCurrentWeekId(d: Date = new Date()): number {
  // Copy & use UTC to avoid local tz shifts
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year.
  const dayNum = (date.getUTCDay() + 6) % 7; // make Monday=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  // week number
  const weekNo = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  const year = date.getUTCFullYear();
  return Number(`${year}${String(weekNo).padStart(2, '0')}`);
}