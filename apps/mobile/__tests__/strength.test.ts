import type { StrengthSession, StrengthSet } from '@openhoop/core';

import {
  LIBRARY,
  activeSession,
  cleanName,
  epleyOneRepMax,
  exerciseHistory,
  exerciseLabel,
  exerciseRefs,
  exerciseVolumes,
  formatClockTimer,
  heartRateStats,
  libraryIdOf,
  MOTION_FACTOR_ENABLED,
  muscleLoad,
  newRecords,
  restRemainingS,
  sessionTotals,
  sessionsThisWeek,
  setVolumeKg,
  suggestReps,
  strengthWeek,
  suggestSet,
  validateSetDraft,
  validateTargetDraft,
  weeklyStats,
} from '@/data/strength';

let nextSetId = 1;

function set(overrides: Partial<StrengthSet> & Pick<StrengthSet, 'exerciseKey' | 'reps' | 'weightKg'>): StrengthSet {
  return {
    id: nextSetId++,
    sessionId: 1,
    exerciseName: overrides.exerciseKey,
    muscle: 'chest',
    rpe: null,
    doneAt: 0,
    ...overrides,
  };
}

function session(id: number, day: string, sets: StrengthSet[], endedAt: number | null = id * 100 + 60): StrengthSession {
  return { id, templateId: null, name: `S${id}`, day, startedAt: id * 100, endedAt, exercises: [], sets: sets.map((entry) => ({ ...entry, sessionId: id })) };
}

describe('library', () => {
  it('has unique ids and plain keys', () => {
    const ids = LIBRARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(libraryIdOf('lib:bench_press')).toBe('bench_press');
    expect(libraryIdOf('lib:nope')).toBeNull();
    expect(libraryIdOf('custom:1')).toBeNull();
  });

  it('merges built-in and custom exercises and labels by key', () => {
    const refs = exerciseRefs([{ id: 3, name: 'Sled push', muscle: 'quads', createdAt: 1 }], (id) => `T:${id}`);
    expect(refs[0]).toEqual({ key: 'lib:bench_press', name: 'T:bench_press', muscle: 'chest', custom: false });
    expect(refs[refs.length - 1]).toEqual({ key: 'custom:3', name: 'Sled push', muscle: 'quads', custom: true });
    expect(exerciseLabel('lib:deadlift', 'Old name', (id) => `T:${id}`)).toBe('T:deadlift');
    expect(exerciseLabel('custom:3', 'Sled push', (id) => `T:${id}`)).toBe('Sled push');
  });
});

describe('validation', () => {
  it('accepts valid sets and returns numbers', () => {
    expect(validateSetDraft({ reps: '8', weight: '62,5', rpe: '' })).toEqual({ ok: true, value: { reps: 8, weightKg: 62.5, rpe: null } });
    expect(validateSetDraft({ reps: '100', weight: '0', rpe: '8.5' })).toEqual({ ok: true, value: { reps: 100, weightKg: 0, rpe: 8.5 } });
  });

  it('rejects every out-of-range or malformed number', () => {
    expect(validateSetDraft({ reps: '0', weight: '10', rpe: '' })).toEqual({ ok: false, invalid: ['reps'] });
    expect(validateSetDraft({ reps: '101', weight: '10', rpe: '' })).toEqual({ ok: false, invalid: ['reps'] });
    expect(validateSetDraft({ reps: '5.5', weight: '10', rpe: '' })).toEqual({ ok: false, invalid: ['reps'] });
    expect(validateSetDraft({ reps: '', weight: '', rpe: '' })).toEqual({ ok: false, invalid: ['reps', 'weight'] });
    expect(validateSetDraft({ reps: '5', weight: '1001', rpe: '' })).toEqual({ ok: false, invalid: ['weight'] });
    expect(validateSetDraft({ reps: '5', weight: '-5', rpe: '' })).toEqual({ ok: false, invalid: ['weight'] });
    expect(validateSetDraft({ reps: '5', weight: '1e3', rpe: '' })).toEqual({ ok: false, invalid: ['weight'] });
    expect(validateSetDraft({ reps: '5', weight: '10.123', rpe: '' })).toEqual({ ok: false, invalid: ['weight'] });
    expect(validateSetDraft({ reps: '5', weight: '10', rpe: '11' })).toEqual({ ok: false, invalid: ['rpe'] });
    expect(validateSetDraft({ reps: '5', weight: '10', rpe: '0.5' })).toEqual({ ok: false, invalid: ['rpe'] });
    expect(validateSetDraft({ reps: '5', weight: '10', rpe: '8.3' })).toEqual({ ok: false, invalid: ['rpe'] });
    expect(validateSetDraft({ reps: '5', weight: '10', rpe: 'abc' })).toEqual({ ok: false, invalid: ['rpe'] });
  });

  it('validates template targets', () => {
    expect(validateTargetDraft({ sets: '3', reps: '10', weight: '0' })).toEqual({ ok: true, value: { sets: 3, reps: 10, weightKg: 0 } });
    expect(validateTargetDraft({ sets: '0', reps: '10', weight: '0' })).toEqual({ ok: false, invalid: ['sets'] });
    expect(validateTargetDraft({ sets: '21', reps: '0', weight: 'x' })).toEqual({ ok: false, invalid: ['sets', 'reps', 'weight'] });
  });

  it('cleans names and rejects empty, long or control-character names', () => {
    expect(cleanName('  Cable   row ', { min: 1, max: 40 })).toBe('Cable row');
    expect(cleanName('   ', { min: 1, max: 40 })).toBeNull();
    expect(cleanName('x'.repeat(41), { min: 1, max: 40 })).toBeNull();
    expect(cleanName('bad\u0007name', { min: 1, max: 40 })).toBeNull();
  });
});

describe('volume', () => {
  it('multiplies reps by weight', () => {
    expect(setVolumeKg({ reps: 5, weightKg: 100 })).toBe(500);
    expect(setVolumeKg({ reps: 12, weightKg: 0 })).toBe(0);
  });

  it('adds up sets, reps and volume and groups per exercise in logging order', () => {
    const sets = [
      set({ exerciseKey: 'lib:bench_press', reps: 8, weightKg: 60 }),
      set({ exerciseKey: 'lib:back_squat', muscle: 'quads', reps: 5, weightKg: 100 }),
      set({ exerciseKey: 'lib:bench_press', reps: 6, weightKg: 65 }),
    ];
    expect(sessionTotals(sets)).toEqual({ sets: 3, reps: 19, volumeKg: 480 + 500 + 390 });
    const volumes = exerciseVolumes(sets);
    expect(volumes.map((row) => [row.exerciseKey, row.sets, row.reps, row.volumeKg])).toEqual([
      ['lib:bench_press', 2, 14, 870],
      ['lib:back_squat', 1, 5, 500],
    ]);
    expect(volumes[0]?.topSet).toMatchObject({ reps: 6, weightKg: 65 });
  });

  it('returns zero totals for no sets', () => {
    expect(sessionTotals([])).toEqual({ sets: 0, reps: 0, volumeKg: 0 });
    expect(exerciseVolumes([])).toEqual([]);
  });
});

describe('estimated 1RM (Epley 1985)', () => {
  it('uses weight × (1 + reps / 30)', () => {
    expect(epleyOneRepMax(100, 1)).toBe(100);
    expect(epleyOneRepMax(100, 5)).toBeCloseTo(116.667, 3);
    expect(epleyOneRepMax(80, 10)).toBeCloseTo(106.667, 3);
    expect(epleyOneRepMax(60, 12)).toBeCloseTo(84, 5);
  });

  it('gives no estimate for bodyweight, over 12 reps or invalid input', () => {
    expect(epleyOneRepMax(0, 5)).toBeNull();
    expect(epleyOneRepMax(100, 13)).toBeNull();
    expect(epleyOneRepMax(100, 0)).toBeNull();
    expect(epleyOneRepMax(100, 2.5)).toBeNull();
    expect(epleyOneRepMax(Number.NaN, 5)).toBeNull();
  });
});

describe('muscular load', () => {
  const sets = [
    set({ exerciseKey: 'lib:bench_press', muscle: 'chest', reps: 10, weightKg: 50 }),
    set({ exerciseKey: 'lib:bench_press', muscle: 'chest', reps: 10, weightKg: 50 }),
    set({ exerciseKey: 'lib:back_squat', muscle: 'quads', reps: 5, weightKg: 100 }),
    set({ exerciseKey: 'lib:push_up', muscle: 'chest', reps: 20, weightKg: 0 }),
    set({ exerciseKey: 'lib:crunch', muscle: 'core', reps: 15, weightKg: 0 }),
  ];

  it('sums reps × weight and counts sets per primary muscle, biggest first', () => {
    const load = muscleLoad(sets);
    expect(load.map((row) => [row.muscle, row.sets, row.volumeKg])).toEqual([
      ['chest', 3, 1000],
      ['quads', 1, 500],
      ['core', 1, 0],
    ]);
    expect(load[0]?.share).toBeCloseTo(1000 / 1500, 6);
    expect(load[1]?.share).toBeCloseTo(500 / 1500, 6);
    expect(load[2]?.share).toBe(0);
  });

  it('has no share when nothing carries weight, and is empty without sets', () => {
    expect(muscleLoad([set({ exerciseKey: 'lib:crunch', muscle: 'core', reps: 15, weightKg: 0 })])[0]?.share).toBeNull();
    expect(muscleLoad([])).toEqual([]);
  });
});

describe('muscular load with motion', () => {
  const bench = set({ id: 1, exerciseKey: 'lib:bench_press', muscle: 'chest', reps: 10, weightKg: 100 });
  const press = set({ id: 2, exerciseKey: 'lib:overhead_press', muscle: 'shoulders', reps: 10, weightKg: 40 });

  it('stays plain volume while the motion factor is switched off', () => {
    expect(MOTION_FACTOR_ENABLED).toBe(false);
    const load = muscleLoad([bench, press], new Map([[1, 1.2]]));
    expect(load.map((row) => [row.muscle, row.volumeKg, row.motionSets])).toEqual([
      ['chest', 1000, 1],
      ['shoulders', 400, 0],
    ]);
  });

  it('weights a set with motion by its factor once the factor is switched on', () => {
    const load = muscleLoad([bench, press], new Map([[1, 1.2]]), true);
    expect(load.map((row) => [row.muscle, row.volumeKg])).toEqual([
      ['chest', 1200],
      ['shoulders', 400],
    ]);
  });
});

describe('rep suggestion from the band', () => {
  it('suggests the counted reps only when they differ from the draft', () => {
    expect(suggestReps(7, '8')).toBe(7);
    expect(suggestReps(7, '7')).toBeNull();
    expect(suggestReps(null, '8')).toBeNull();
    expect(suggestReps(0, '8')).toBeNull();
    expect(suggestReps(7, '')).toBe(7);
  });
});

describe('history and records', () => {
  const sessions = [
    session(1, '2026-11-02', [set({ exerciseKey: 'lib:bench_press', reps: 5, weightKg: 80 })]),
    session(2, '2026-11-09', [set({ exerciseKey: 'lib:bench_press', reps: 5, weightKg: 85 }), set({ exerciseKey: 'lib:bench_press', reps: 3, weightKg: 90 })]),
    session(3, '2026-11-16', [set({ exerciseKey: 'lib:bench_press', reps: 5, weightKg: 80 })]),
    session(4, '2026-11-23', [set({ exerciseKey: 'lib:bench_press', reps: 5, weightKg: 100 })], null),
  ];

  it('lists finished sessions newest first with the best estimate and heaviest set', () => {
    const history = exerciseHistory(sessions, 'lib:bench_press');
    expect(history.entries.map((entry) => entry.day)).toEqual(['2026-11-16', '2026-11-09', '2026-11-02']);
    expect(history.totalSets).toBe(4);
    expect(history.bestOneRepMax?.day).toBe('2026-11-09');
    expect(history.bestOneRepMax?.kg).toBeCloseTo(99.16667, 4);
    expect(history.heaviest).toEqual({ weightKg: 90, reps: 3, day: '2026-11-09' });
    expect(exerciseHistory(sessions, 'lib:squat').entries).toEqual([]);
  });

  it('flags a new best estimate only against earlier finished sessions', () => {
    expect(newRecords(sessions[0] as StrengthSession, sessions)).toEqual([]);
    expect(newRecords(sessions[1] as StrengthSession, sessions)).toEqual(['lib:bench_press']);
    expect(newRecords(sessions[2] as StrengthSession, sessions)).toEqual([]);
  });

  it('finds the open session', () => {
    expect(activeSession(sessions)?.id).toBe(4);
    expect(activeSession(sessions.slice(0, 3))).toBeNull();
  });
});

describe('weekly trends', () => {
  const sessions = [
    session(1, '2026-11-02', [set({ exerciseKey: 'a', muscle: 'chest', reps: 10, weightKg: 50 })]),
    session(2, '2026-11-04', [set({ exerciseKey: 'b', muscle: 'quads', reps: 5, weightKg: 100 })]),
    session(3, '2026-11-24', [set({ exerciseKey: 'a', muscle: 'chest', reps: 10, weightKg: 60 })]),
    session(4, '2026-11-25', [set({ exerciseKey: 'a', muscle: 'chest', reps: 10, weightKg: 70 })], null),
  ];

  it('buckets finished sessions into Monday-first weeks ending this week', () => {
    const stats = weeklyStats(sessions, '2026-11-25', 4);
    expect(stats.map((week) => week.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    expect(stats.map((week) => week.sessions)).toEqual([2, 0, 0, 1]);
    expect(stats[0]?.volumeKg).toBe(1000);
    expect(stats[0]?.byMuscle.map((row) => row.muscle).sort()).toEqual(['chest', 'quads']);
    expect(stats[3]?.volumeKg).toBe(600);
  });

  it('counts sessions this week and marks the days', () => {
    expect(sessionsThisWeek(sessions, '2026-11-25')).toBe(1);
    expect(sessionsThisWeek(sessions, '2026-11-02')).toBe(2);
    expect(strengthWeek(sessions, '2026-11-25')).toEqual({ dots: [false, true, false, false, false, false, false], count: 1 });
    expect(strengthWeek([], '2026-11-25')).toEqual({ dots: [false, false, false, false, false, false, false], count: 0 });
  });
});

describe('heart rate and timers', () => {
  it('summarises samples and returns null without any', () => {
    expect(heartRateStats([])).toBeNull();
    expect(heartRateStats([{ t: 1, hr: 0 }])).toBeNull();
    expect(heartRateStats([{ t: 1, hr: 100 }, { t: 2, hr: 140 }, { t: 3, hr: 120 }])).toEqual({ avg: 120, max: 140, min: 100, samples: 3 });
  });

  it('computes the rest countdown from wall-clock time', () => {
    expect(restRemainingS(1_000, 90, 1_000)).toBe(90);
    expect(restRemainingS(1_000, 90, 31_500)).toBe(60);
    expect(restRemainingS(1_000, 90, 200_000)).toBe(0);
  });

  it('formats timers', () => {
    expect(formatClockTimer(0)).toBe('0:00');
    expect(formatClockTimer(75)).toBe('1:15');
    expect(formatClockTimer(3_725)).toBe('1:02:05');
    expect(formatClockTimer(-4)).toBe('0:00');
  });
});

describe('suggestSet', () => {
  it('starts from the plan and then follows the last logged set', () => {
    const exercise = { exerciseKey: 'lib:bench_press', reps: 8, weightKg: 60 };
    expect(suggestSet(exercise, [])).toEqual({ reps: '8', weight: '60', rpe: '' });
    expect(suggestSet(exercise, [set({ exerciseKey: 'lib:bench_press', reps: 6, weightKg: 62.5 })])).toEqual({ reps: '6', weight: '62.5', rpe: '' });
  });
});
