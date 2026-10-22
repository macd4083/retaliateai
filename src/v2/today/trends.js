import { addDaysToLocalDate } from './model';

export const TREND_RANGES = [
  { value: '7D', label: 'Past 7 days', days: 7 },
  { value: '1M', label: 'Past month', days: 30 },
  { value: '1Y', label: 'Past year', days: 365 },
  { value: 'ALL', label: 'All time', days: null },
];

export function buildDailyTrend(values, todayLocalDate, range = '7D') {
  const days = TREND_RANGES.find((entry) => entry.value === range)?.days;
  const dates = Object.keys(values).filter((date) => date <= todayLocalDate).sort();
  const start = days ? addDaysToLocalDate(todayLocalDate, 1 - days) : (dates[0] || todayLocalDate);
  const points = [];
  for (let date = start; date <= todayLocalDate; date = addDaysToLocalDate(date, 1)) {
    points.push({ date, value: Number.isFinite(values[date]) ? values[date] : null });
  }
  return points;
}

export function buildBecomingTrend(reviews = [], todayLocalDate) {
  const values = {};
  for (const review of reviews) {
    if (Number.isInteger(review.becoming_rating) && review.becoming_rating >= 1 && review.becoming_rating <= 10) {
      values[review.local_date] = review.becoming_rating;
    }
  }
  return buildDailyTrend(values, todayLocalDate);
}

export function buildCommitmentTrend(fragments = [], legacySessions = [], todayLocalDate, range = '7D') {
  const values = {};
  for (const session of legacySessions) {
    if (Number.isFinite(session.commitment_score) && session.commitment_score >= 0 && session.commitment_score <= 100) {
      values[session.date] = session.commitment_score;
    }
  }
  const days = new Map();
  for (const fragment of fragments) {
    const date = fragment.target_local_date;
    const day = days.get(date) || { kept: 0, answered: 0 };
    if (fragment.completion_state === 'kept' || fragment.completion_state === 'not_kept') {
      day.answered += 1;
      if (fragment.completion_state === 'kept') day.kept += 1;
    }
    days.set(date, day);
  }
  for (const [date, day] of days) {
    values[date] = day.answered ? (day.kept / day.answered) * 100 : null;
  }
  return buildDailyTrend(values, todayLocalDate, range);
}
