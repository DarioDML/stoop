import type { StrengthSession } from '@openhoop/core';

import {
  monthStart,
  periodBuckets,
  periodMuscles,
  parseTrendRange,
  periodBounds,
  periodTotals,
  strengthGoal,
  strengthMinuteBars,
  typicalSessionMinutes,
} from '@/data/strengthTrends';
import { defaultPlan } from '@/data/weeklyPlan';

const TODAY = '2026-11-25';

function unixOf(day: string, hour: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 1000 + hour * 3_600;
}

function session(id: number, day: string, minutes: number, volume = 1000): StrengthSession {
  const startedAt = unixOf(day, 10);
  return {
    id,
    templateId: null,
    name: `S${id}`,
    day,
    startedAt,
    endedAt: startedAt + minutes * 60,
    exercises: [],
    sets: [{ id, sessionId: id, exerciseKey: 'lib:bench_press', exerciseName: 'Bench', muscle: 'chest', reps: 10, weightKg: volume / 10, rpe: null, doneAt: startedAt }],
  };
}

const NOW_S = unixOf(TODAY, 18);
const SESSIONS = [session(1, '2026-11-02', 65), session(2, '2026-11-10', 45, 2000), session(3, '2026-11-23', 50, 3000), session(4, '2026-11-25', 40), session(5, '2026-10-05', 60, 500)];
const INPUT = { sessions: SESSIONS, activities: [], today: TODAY, nowS: NOW_S, tzOffsetS: 0 };

describe('strength minutes over time', () => {
  it('shows this week per day, with no value for days still to come', () => {
    const bars = strengthMinuteBars('1w', INPUT);
    expect(bars.map((bar) => bar.minutes)).toEqual([50, 0, 40, null, null, null, null]);
    expect(bars.findIndex((bar) => bar.current)).toBe(2);
  });

  it('shows the last four weeks', () => {
    const bars = strengthMinuteBars('1m', INPUT);
    expect(bars.map((bar) => [bar.start, bar.minutes])).toEqual([
      ['2026-11-02', 65],
      ['2026-11-09', 45],
      ['2026-11-16', 0],
      ['2026-11-23', 90],
    ]);
    expect(bars[3]?.current).toBe(true);
  });

  it('shows the last six months', () => {
    const bars = strengthMinuteBars('6m', INPUT);
    expect(bars.map((bar) => bar.start)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    expect(bars.map((bar) => bar.minutes)).toEqual([0, 0, 0, 0, 60, 200]);
    expect(bars[5]?.end).toBe('2026-11-30');
  });

  it('parses the range and finds month starts', () => {
    expect(parseTrendRange('6m')).toBe('6m');
    expect(parseTrendRange('8')).toBe('1m');
    expect(monthStart('2026-01-15', -1)).toBe('2025-12-01');
  });
});

describe('period totals', () => {
  it('counts sessions and volume and the same days of the period before', () => {
    expect(periodBounds('1m', TODAY)).toEqual({ start: '2026-11-02', end: '2026-11-29', elapsedDays: 24, previousStart: '2026-10-05', previousEnd: '2026-10-28' });
    expect(periodBounds('1w', TODAY)).toEqual({ start: '2026-11-23', end: '2026-11-29', elapsedDays: 3, previousStart: '2026-11-16', previousEnd: '2026-11-18' });
    expect(periodTotals('1m', SESSIONS, TODAY)).toEqual({
      start: '2026-11-02',
      end: '2026-11-29',
      elapsedDays: 24,
      sessions: 4,
      volumeKg: 7000,
      previousSessions: 1,
      previousVolumeKg: 500,
    });
    expect(periodBounds('6m', TODAY)).toMatchObject({ elapsedDays: 178, previousStart: '2025-12-01', previousEnd: '2026-05-27' });
  });
});

describe('period buckets', () => {
  it('splits every range into the same spans as the minute bars', () => {
    expect(periodBuckets('1w', SESSIONS, TODAY).map((bucket) => [bucket.start, bucket.sessions, bucket.future])).toEqual([
      ['2026-11-23', 1, false],
      ['2026-11-24', 0, false],
      ['2026-11-25', 1, false],
      ['2026-11-26', 0, true],
      ['2026-11-27', 0, true],
      ['2026-11-28', 0, true],
      ['2026-11-29', 0, true],
    ]);
    expect(periodBuckets('1m', SESSIONS, TODAY).map((bucket) => bucket.volumeKg)).toEqual([1000, 2000, 0, 4000]);
    expect(periodBuckets('6m', SESSIONS, TODAY).map((bucket) => [bucket.start, bucket.sessions])).toEqual([
      ['2026-06-01', 0],
      ['2026-07-01', 0],
      ['2026-08-01', 0],
      ['2026-09-01', 0],
      ['2026-10-01', 1],
      ['2026-11-01', 4],
    ]);
  });

  it('adds up muscle volume over the same period as the tiles', () => {
    expect(periodMuscles('1w', SESSIONS, TODAY)).toEqual([{ muscle: 'chest', sets: 2, volumeKg: 4000, share: 1, motionSets: 0 }]);
    expect(periodMuscles('6m', SESSIONS, TODAY)[0]).toMatchObject({ sets: 5, volumeKg: 7500 });
  });
});

describe('weekly strength goal', () => {
  const planInput = { days: [], sessions: SESSIONS, activities: [], steps: [], today: TODAY, nowS: NOW_S, tzOffsetS: 0 };

  it('measures this week against the plan’s strength minutes', () => {
    const plan = { ...defaultPlan(null), goals: ['strength' as const], strengthMinutes: 150 };
    expect(strengthGoal(plan, planInput)).toEqual({ kind: 'goal', done: 90, target: 150, left: 60, sessionsNeeded: 2 });
    expect(strengthGoal({ ...plan, strengthMinutes: 90 }, planInput)).toMatchObject({ left: 0, sessionsNeeded: null });
  });

  it('is honest when there is no plan or no strength goal', () => {
    expect(strengthGoal(null, planInput)).toEqual({ kind: 'noPlan' });
    expect(strengthGoal({ ...defaultPlan(null), goals: ['loadDays'] }, planInput)).toEqual({ kind: 'noGoal' });
  });

  it('takes the typical session length from recent sessions', () => {
    expect(typicalSessionMinutes(SESSIONS)).toBe(50);
    expect(typicalSessionMinutes([])).toBeNull();
  });
});
