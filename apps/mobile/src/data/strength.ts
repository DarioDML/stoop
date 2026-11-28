import type {
  STRENGTH_LIMITS as CoreLimits,
  CustomExercise,
  MuscleGroup,
  PlannedExercise,
  SessionExercise,
  StrengthSession,
  StrengthSet,
} from '@openhoop/core';

import { activityMetrics, type HrPoint, type LoadReference } from '@openhoop/analytics';

import { formatNumber } from '@/lib/format';
import { weightIn, weightToKg } from '@/lib/units';

import { addDays, weekStart } from './derived';
import type { HeartRatePoint, Language, Units } from './types';

export const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'] as const satisfies readonly MuscleGroup[];

export const MUSCLE_GROUPS_COMPLETE: [Exclude<MuscleGroup, (typeof MUSCLE_GROUPS)[number]>] extends [never] ? true : false = true;

export const STRENGTH_LIMITS = {
  nameLength: { min: 1, max: 40 },
  templateNameLength: { min: 1, max: 60 },
  sets: { min: 1, max: 20 },
  reps: { min: 1, max: 100 },
  weightKg: { min: 0, max: 1000 },
  rpe: { min: 1, max: 10 },
  items: { max: 30 },
} as const satisfies typeof CoreLimits;

export const LIBRARY = [
  { id: 'bench_press', muscle: 'chest' },
  { id: 'incline_dumbbell_press', muscle: 'chest' },
  { id: 'push_up', muscle: 'chest' },
  { id: 'cable_fly', muscle: 'chest' },
  { id: 'deadlift', muscle: 'back' },
  { id: 'barbell_row', muscle: 'back' },
  { id: 'pull_up', muscle: 'back' },
  { id: 'lat_pulldown', muscle: 'back' },
  { id: 'seated_cable_row', muscle: 'back' },
  { id: 'overhead_press', muscle: 'shoulders' },
  { id: 'lateral_raise', muscle: 'shoulders' },
  { id: 'face_pull', muscle: 'shoulders' },
  { id: 'barbell_curl', muscle: 'biceps' },
  { id: 'hammer_curl', muscle: 'biceps' },
  { id: 'triceps_pushdown', muscle: 'triceps' },
  { id: 'skull_crusher', muscle: 'triceps' },
  { id: 'bench_dip', muscle: 'triceps' },
  { id: 'back_squat', muscle: 'quads' },
  { id: 'front_squat', muscle: 'quads' },
  { id: 'leg_press', muscle: 'quads' },
  { id: 'walking_lunge', muscle: 'quads' },
  { id: 'leg_extension', muscle: 'quads' },
  { id: 'romanian_deadlift', muscle: 'hamstrings' },
  { id: 'leg_curl', muscle: 'hamstrings' },
  { id: 'hip_thrust', muscle: 'glutes' },
  { id: 'glute_bridge', muscle: 'glutes' },
  { id: 'standing_calf_raise', muscle: 'calves' },
  { id: 'seated_calf_raise', muscle: 'calves' },
  { id: 'crunch', muscle: 'core' },
  { id: 'hanging_leg_raise', muscle: 'core' },
  { id: 'cable_crunch', muscle: 'core' },
  { id: 'kettlebell_swing', muscle: 'glutes' },
  { id: 'goblet_squat', muscle: 'quads' },
  { id: 'kettlebell_press', muscle: 'shoulders' },
  { id: 'kettlebell_row', muscle: 'back' },
  { id: 'turkish_get_up', muscle: 'core' },
] as const satisfies ReadonlyArray<{ id: string; muscle: MuscleGroup }>;

export type LibraryId = (typeof LIBRARY)[number]['id'];

export const LIBRARY_PREFIX = 'lib:';
export const CUSTOM_PREFIX = 'custom:';

export interface ExerciseRef {
  key: string;
  name: string;
  muscle: MuscleGroup;
  custom: boolean;
}

export function isLibraryId(value: string): value is LibraryId {
  return LIBRARY.some((entry) => entry.id === value);
}

export function libraryIdOf(key: string): LibraryId | null {
  if (!key.startsWith(LIBRARY_PREFIX)) return null;
  const id = key.slice(LIBRARY_PREFIX.length);
  return isLibraryId(id) ? id : null;
}

export function exerciseRefs(custom: readonly CustomExercise[], libraryName: (id: LibraryId) => string): ExerciseRef[] {
  const built = LIBRARY.map((entry): ExerciseRef => ({ key: `${LIBRARY_PREFIX}${entry.id}`, name: libraryName(entry.id), muscle: entry.muscle, custom: false }));
  const own = custom.map((entry): ExerciseRef => ({ key: `${CUSTOM_PREFIX}${entry.id}`, name: entry.name, muscle: entry.muscle, custom: true }));
  return [...built, ...own];
}

export function exerciseLabel(key: string, storedName: string, libraryName: (id: LibraryId) => string): string {
  const id = libraryIdOf(key);
  return id === null ? storedName : libraryName(id);
}

export const DEFAULT_TARGET = { sets: 3, reps: 8, weightKg: 0 } as const;

export function planned(ref: ExerciseRef, target: { sets: number; reps: number; weightKg: number } = DEFAULT_TARGET): PlannedExercise {
  return { exerciseKey: ref.key, exerciseName: ref.name, muscle: ref.muscle, sets: target.sets, reps: target.reps, weightKg: target.weightKg };
}

const INTEGER = /^\d{1,3}$/;
const DECIMAL = /^\d{1,4}([.,]\d{1,2})?$/;
const RPE = /^\d{1,2}([.,][05])?$/;

function parseInteger(text: string, limits: { readonly min: number; readonly max: number }): number | null {
  const trimmed = text.trim();
  if (!INTEGER.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= limits.min && value <= limits.max ? value : null;
}

export function roundKg(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

function parseWeight(text: string, units: Units): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const kg = roundKg(weightToKg(Number(trimmed.replace(',', '.')), units));
  return kg >= STRENGTH_LIMITS.weightKg.min && kg <= STRENGTH_LIMITS.weightKg.max ? kg : null;
}

export function weightInputText(kg: number, units: Units): string {
  return `${Math.round(weightIn(kg, units) * 100) / 100}`;
}

function parseRpe(text: string): number | null {
  const trimmed = text.trim();
  if (!RPE.test(trimmed)) return null;
  const value = Number(trimmed.replace(',', '.'));
  return value >= STRENGTH_LIMITS.rpe.min && value <= STRENGTH_LIMITS.rpe.max ? value : null;
}

export function cleanName(text: string, limits: { readonly min: number; readonly max: number }): string | null {
  const name = text.replace(/\s+/g, ' ').trim();
  if (name.length < limits.min || name.length > limits.max) return null;
  return /[\u0000-\u001f\u007f]/.test(name) ? null : name;
}

export type SetField = 'reps' | 'weight' | 'rpe';

export interface SetDraft {
  reps: string;
  weight: string;
  rpe: string;
}

export interface SetValues {
  reps: number;
  weightKg: number;
  rpe: number | null;
}

export type SetValidation = { ok: true; value: SetValues } | { ok: false; invalid: SetField[] };

function weightOf(text: string, units: Units, storedKg: number | undefined): number | null {
  if (storedKg !== undefined && text.trim() === weightInputText(storedKg, units)) return storedKg;
  return parseWeight(text, units);
}

export function validateSetDraft(draft: SetDraft, units: Units = 'metric', storedKg?: number): SetValidation {
  const invalid: SetField[] = [];
  const reps = parseInteger(draft.reps, STRENGTH_LIMITS.reps);
  if (reps === null) invalid.push('reps');
  const weightKg = weightOf(draft.weight, units, storedKg);
  if (weightKg === null) invalid.push('weight');
  let rpe: number | null = null;
  if (draft.rpe.trim() !== '') {
    rpe = parseRpe(draft.rpe);
    if (rpe === null) invalid.push('rpe');
  }
  if (invalid.length > 0 || reps === null || weightKg === null) return { ok: false, invalid };
  return { ok: true, value: { reps, weightKg, rpe } };
}

export type TargetField = 'sets' | 'reps' | 'weight';

export interface TargetDraft {
  sets: string;
  reps: string;
  weight: string;
}

export interface TargetValues {
  sets: number;
  reps: number;
  weightKg: number;
}

export type TargetValidation = { ok: true; value: TargetValues } | { ok: false; invalid: TargetField[] };

export function validateTargetDraft(draft: TargetDraft, units: Units = 'metric', storedKg?: number): TargetValidation {
  const invalid: TargetField[] = [];
  const sets = parseInteger(draft.sets, STRENGTH_LIMITS.sets);
  if (sets === null) invalid.push('sets');
  const reps = parseInteger(draft.reps, STRENGTH_LIMITS.reps);
  if (reps === null) invalid.push('reps');
  const weightKg = weightOf(draft.weight, units, storedKg);
  if (weightKg === null) invalid.push('weight');
  if (invalid.length > 0 || sets === null || reps === null || weightKg === null) return { ok: false, invalid };
  return { ok: true, value: { sets, reps, weightKg } };
}

export function targetDraftOf(item: PlannedExercise, units: Units = 'metric'): TargetDraft {
  return { sets: `${item.sets}`, reps: `${item.reps}`, weight: weightInputText(item.weightKg, units) };
}

export function stepDraftValue(text: string, delta: number, limits: { readonly min: number; readonly max: number }, decimals: number): string {
  const parsed = Number(text.trim().replace(',', '.'));
  const base = Number.isFinite(parsed) && text.trim() !== '' ? parsed : limits.min;
  const next = Math.min(limits.max, Math.max(limits.min, base + delta));
  const factor = 10 ** decimals;
  return `${Math.round(next * factor) / factor}`;
}

export function setVolumeKg(set: { reps: number; weightKg: number }): number {
  return set.reps * set.weightKg;
}

export const ONE_RM_MAX_REPS = 12;

/** Epley (1985): 1RM ≈ weight × (1 + reps / 30). An estimate, not a tested maximum. */
export function epleyOneRepMax(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isInteger(reps) || weightKg <= 0 || reps < 1 || reps > ONE_RM_MAX_REPS) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export interface SessionTotals {
  sets: number;
  reps: number;
  volumeKg: number;
}

export function sessionTotals(sets: readonly StrengthSet[]): SessionTotals {
  return sets.reduce<SessionTotals>(
    (total, set) => ({ sets: total.sets + 1, reps: total.reps + set.reps, volumeKg: total.volumeKg + setVolumeKg(set) }),
    { sets: 0, reps: 0, volumeKg: 0 },
  );
}

export interface TopSet {
  reps: number;
  weightKg: number;
  oneRepMaxKg: number | null;
}

function topSetOf(sets: readonly StrengthSet[]): TopSet | null {
  let best: TopSet | null = null;
  let bestScore = -1;
  for (const set of sets) {
    const oneRepMaxKg = epleyOneRepMax(set.weightKg, set.reps);
    const score = oneRepMaxKg ?? (set.weightKg > 0 ? set.weightKg * (1 + set.reps / 30) : set.reps);
    if (score > bestScore) {
      bestScore = score;
      best = { reps: set.reps, weightKg: set.weightKg, oneRepMaxKg };
    }
  }
  return best;
}

export interface ExerciseVolume {
  exerciseKey: string;
  exerciseName: string;
  muscle: MuscleGroup;
  sets: number;
  reps: number;
  volumeKg: number;
  topSet: TopSet | null;
}

export function exerciseVolumes(sets: readonly StrengthSet[]): ExerciseVolume[] {
  const groups = new Map<string, StrengthSet[]>();
  for (const set of sets) {
    const list = groups.get(set.exerciseKey);
    if (list === undefined) groups.set(set.exerciseKey, [set]);
    else list.push(set);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    const totals = sessionTotals(list);
    return {
      exerciseKey: first?.exerciseKey ?? '',
      exerciseName: first?.exerciseName ?? '',
      muscle: first?.muscle ?? 'core',
      sets: totals.sets,
      reps: totals.reps,
      volumeKg: totals.volumeKg,
      topSet: topSetOf(list),
    };
  });
}

export interface MuscleLoad {
  muscle: MuscleGroup;
  sets: number;
  volumeKg: number;
  share: number | null;
  motionSets: number;
}

export const MOTION_FACTOR_ENABLED = false;

/**
 * Muscular load: volume load (reps × weight, in kg) summed per primary muscle group, with the
 * set count next to it. No secondary muscles; bodyweight sets (weight 0) add sets but no volume.
 * A set the band measured carries a tempo factor (0.7–1.3); it weights the set's volume only
 * once the factor is switched on, and motionSets counts those sets either way.
 */
export function muscleLoad(sets: readonly StrengthSet[], factors: ReadonlyMap<number, number> = new Map(), applyFactors: boolean = MOTION_FACTOR_ENABLED): MuscleLoad[] {
  const volume = (set: StrengthSet): number => setVolumeKg(set) * (applyFactors ? (factors.get(set.id) ?? 1) : 1);
  const total = sets.reduce((sum, set) => sum + volume(set), 0);
  const rows: MuscleLoad[] = [];
  for (const muscle of MUSCLE_GROUPS) {
    const own = sets.filter((set) => set.muscle === muscle);
    if (own.length === 0) continue;
    const volumeKg = own.reduce((sum, set) => sum + volume(set), 0);
    rows.push({ muscle, sets: own.length, volumeKg, share: total > 0 ? volumeKg / total : null, motionSets: own.filter((set) => factors.has(set.id)).length });
  }
  return rows.sort((a, b) => b.volumeKg - a.volumeKg || b.sets - a.sets);
}

export function suggestReps(detected: number | null, draftReps: string): number | null {
  if (detected === null || detected < 1) return null;
  return String(detected) === draftReps.trim() ? null : detected;
}

export function durationS(session: Pick<StrengthSession, 'startedAt' | 'endedAt'>, nowS: number): number {
  return Math.max(0, (session.endedAt ?? nowS) - session.startedAt);
}

export interface HeartRateStats {
  avg: number;
  max: number;
  min: number;
  samples: number;
}

export function heartRateStats(points: readonly HeartRatePoint[]): HeartRateStats | null {
  const valid = points.filter((point) => Number.isFinite(point.hr) && point.hr > 0);
  if (valid.length === 0) return null;
  const values = valid.map((point) => point.hr);
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values),
    samples: values.length,
  };
}

export function finishedSessions(sessions: readonly StrengthSession[]): StrengthSession[] {
  return sessions.filter((session) => session.endedAt !== null);
}

export function activeSession(sessions: readonly StrengthSession[]): StrengthSession | null {
  let found: StrengthSession | null = null;
  for (const session of sessions) if (session.endedAt === null) found = session;
  return found;
}

function bestOneRepMax(sets: readonly StrengthSet[]): number | null {
  let best: number | null = null;
  for (const set of sets) {
    const value = epleyOneRepMax(set.weightKg, set.reps);
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

export function newRecords(session: StrengthSession, all: readonly StrengthSession[]): string[] {
  return [...new Set(sessionRecords(session, all).map((record) => record.exerciseKey))];
}

export interface ExerciseEntry {
  sessionId: number;
  day: string;
  sets: StrengthSet[];
  volumeKg: number;
  topSet: TopSet | null;
  oneRepMaxKg: number | null;
}

export interface ExerciseHistory {
  entries: ExerciseEntry[];
  bestOneRepMax: { kg: number; day: string } | null;
  heaviest: { weightKg: number; reps: number; day: string } | null;
  totalSets: number;
}

export function exerciseHistory(sessions: readonly StrengthSession[], exerciseKey: string): ExerciseHistory {
  const entries: ExerciseEntry[] = [];
  for (const session of finishedSessions(sessions)) {
    const sets = session.sets.filter((set) => set.exerciseKey === exerciseKey);
    if (sets.length === 0) continue;
    entries.push({
      sessionId: session.id,
      day: session.day,
      sets,
      volumeKg: sessionTotals(sets).volumeKg,
      topSet: topSetOf(sets),
      oneRepMaxKg: bestOneRepMax(sets),
    });
  }
  entries.reverse();
  let bestOneRepMaxEntry: ExerciseHistory['bestOneRepMax'] = null;
  let heaviest: ExerciseHistory['heaviest'] = null;
  for (const entry of [...entries].reverse()) {
    if (entry.oneRepMaxKg !== null && (bestOneRepMaxEntry === null || entry.oneRepMaxKg > bestOneRepMaxEntry.kg)) {
      bestOneRepMaxEntry = { kg: entry.oneRepMaxKg, day: entry.day };
    }
    for (const set of entry.sets) {
      if (heaviest === null || set.weightKg > heaviest.weightKg) heaviest = { weightKg: set.weightKg, reps: set.reps, day: entry.day };
    }
  }
  return { entries, bestOneRepMax: bestOneRepMaxEntry, heaviest, totalSets: entries.reduce((sum, entry) => sum + entry.sets.length, 0) };
}

export function exercisesUsed(sessions: readonly StrengthSession[]): Array<{ key: string; name: string; muscle: MuscleGroup }> {
  const seen = new Map<string, { key: string; name: string; muscle: MuscleGroup }>();
  for (const session of finishedSessions(sessions)) {
    for (const set of session.sets) seen.set(set.exerciseKey, { key: set.exerciseKey, name: set.exerciseName, muscle: set.muscle });
  }
  return [...seen.values()];
}

export interface WeekStat {
  weekStart: string;
  sessions: number;
  sets: number;
  volumeKg: number;
  byMuscle: Array<{ muscle: MuscleGroup; volumeKg: number; sets: number }>;
}

export function weeklyStats(sessions: readonly StrengthSession[], today: string, weeks: number): WeekStat[] {
  const current = weekStart(today);
  const result: WeekStat[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(current, -7 * i);
    const end = addDays(start, 6);
    const inWeek = finishedSessions(sessions).filter((session) => session.day >= start && session.day <= end);
    const sets = inWeek.flatMap((session) => session.sets);
    result.push({
      weekStart: start,
      sessions: inWeek.length,
      sets: sets.length,
      volumeKg: sessionTotals(sets).volumeKg,
      byMuscle: muscleLoad(sets).map((row) => ({ muscle: row.muscle, volumeKg: row.volumeKg, sets: row.sets })),
    });
  }
  return result;
}

export function sessionsThisWeek(sessions: readonly StrengthSession[], today: string): number {
  const start = weekStart(today);
  const end = addDays(start, 6);
  return finishedSessions(sessions).filter((session) => session.day >= start && session.day <= end).length;
}

export function strengthWeek(sessions: readonly StrengthSession[], anyDayInWeek: string): { dots: boolean[]; count: number } {
  const start = weekStart(anyDayInWeek);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const end = addDays(start, 6);
  const inWeek = finishedSessions(sessions).filter((session) => session.day >= start && session.day <= end);
  return { dots: days.map((day) => inWeek.some((session) => session.day === day)), count: inWeek.length };
}

export function suggestedWeightKg(exercise: Pick<SessionExercise, 'exerciseKey' | 'weightKg'>, sets: readonly StrengthSet[]): number {
  const last = [...sets].reverse().find((set) => set.exerciseKey === exercise.exerciseKey);
  return (last ?? exercise).weightKg;
}

export function suggestSet(exercise: Pick<SessionExercise, 'exerciseKey' | 'reps' | 'weightKg'>, sets: readonly StrengthSet[], units: Units = 'metric'): SetDraft {
  const last = [...sets].reverse().find((set) => set.exerciseKey === exercise.exerciseKey);
  const source = last ?? exercise;
  return { reps: `${source.reps}`, weight: weightInputText(source.weightKg, units), rpe: '' };
}

export function setsDone(exercise: Pick<SessionExercise, 'exerciseKey'>, sets: readonly StrengthSet[]): number {
  return sets.filter((set) => set.exerciseKey === exercise.exerciseKey).length;
}

export const REST_OPTIONS_S = [60, 90, 120, 180] as const;
export type RestSeconds = (typeof REST_OPTIONS_S)[number];

export function restRemainingS(startedAtMs: number, restS: number, nowMs: number): number {
  return Math.max(0, Math.ceil(restS - (nowMs - startedAtMs) / 1000));
}

export function formatClockTimer(totalS: number): string {
  const seconds = Math.max(0, Math.floor(totalS));
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${minutes}:${pad(seconds % 60)}`;
}

function sameWeight(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

export interface DatedSet {
  reps: number;
  weightKg: number;
  day: string;
}

export interface BestSet extends DatedSet {
  oneRepMaxKg: number | null;
}

export function bestSet(history: ExerciseHistory): BestSet | null {
  let best: BestSet | null = null;
  for (const entry of [...history.entries].reverse()) {
    for (const set of entry.sets) {
      const oneRepMaxKg = epleyOneRepMax(set.weightKg, set.reps);
      const candidate: BestSet = { reps: set.reps, weightKg: set.weightKg, day: entry.day, oneRepMaxKg };
      if (best === null || betterSet(candidate, best)) best = candidate;
    }
  }
  return best;
}

function betterSet(a: BestSet, b: BestSet): boolean {
  if (a.oneRepMaxKg !== null || b.oneRepMaxKg !== null) return (a.oneRepMaxKg ?? -1) > (b.oneRepMaxKg ?? -1);
  if (!sameWeight(a.weightKg, b.weightKg)) return a.weightKg > b.weightKg;
  return a.reps > b.reps;
}

export interface ExerciseRecords {
  heaviest: DatedSet | null;
  mostReps: DatedSet | null;
  bestVolume: { volumeKg: number; day: string } | null;
}

function usualWeight(sets: readonly StrengthSet[]): number | null {
  const counts: Array<{ weightKg: number; count: number }> = [];
  for (const set of sets) {
    const found = counts.find((entry) => sameWeight(entry.weightKg, set.weightKg));
    if (found === undefined) counts.push({ weightKg: set.weightKg, count: 1 });
    else found.count += 1;
  }
  let best: { weightKg: number; count: number } | null = null;
  for (const entry of counts) {
    if (best === null || entry.count > best.count || (entry.count === best.count && entry.weightKg > best.weightKg)) best = entry;
  }
  return best === null ? null : best.weightKg;
}

export function exerciseRecords(history: ExerciseHistory): ExerciseRecords {
  const chronological = [...history.entries].reverse();
  const all = chronological.flatMap((entry) => entry.sets);
  const usual = usualWeight(all);
  let heaviest: DatedSet | null = null;
  let mostReps: DatedSet | null = null;
  let bestVolume: ExerciseRecords['bestVolume'] = null;
  for (const entry of chronological) {
    for (const set of entry.sets) {
      if (set.weightKg > 0 && (heaviest === null || set.weightKg > heaviest.weightKg + 0.004 || (sameWeight(set.weightKg, heaviest.weightKg) && set.reps > heaviest.reps))) {
        heaviest = { weightKg: set.weightKg, reps: set.reps, day: entry.day };
      }
      if (usual !== null && sameWeight(set.weightKg, usual) && (mostReps === null || set.reps > mostReps.reps)) {
        mostReps = { weightKg: usual, reps: set.reps, day: entry.day };
      }
    }
    if (entry.volumeKg > 0 && (bestVolume === null || entry.volumeKg > bestVolume.volumeKg)) bestVolume = { volumeKg: entry.volumeKg, day: entry.day };
  }
  return { heaviest, mostReps, bestVolume };
}

interface RecordBase {
  exerciseKey: string;
  exerciseName: string;
}

export type SessionRecord =
  | (RecordBase & { kind: 'heaviest'; weightKg: number; reps: number })
  | (RecordBase & { kind: 'reps'; weightKg: number; reps: number })
  | (RecordBase & { kind: 'volume'; volumeKg: number });

function mostRepsAt(sets: readonly StrengthSet[], weightKg: number): number | null {
  let best: number | null = null;
  for (const set of sets) if (sameWeight(set.weightKg, weightKg) && (best === null || set.reps > best)) best = set.reps;
  return best;
}

export function sessionRecords(session: StrengthSession, all: readonly StrengthSession[]): SessionRecord[] {
  const earlier = finishedSessions(all).filter((other) => other.id !== session.id && other.startedAt < session.startedAt);
  const records: SessionRecord[] = [];
  for (const exercise of exerciseVolumes(session.sets)) {
    const key = exercise.exerciseKey;
    const before = earlier.map((other) => other.sets.filter((set) => set.exerciseKey === key)).filter((sets) => sets.length > 0);
    if (before.length === 0) continue;
    const now = session.sets.filter((set) => set.exerciseKey === key);
    const base: RecordBase = { exerciseKey: key, exerciseName: exercise.exerciseName };
    const previous = before.flat();
    const heaviestNow = Math.max(...now.map((set) => set.weightKg));
    const heaviestBefore = Math.max(...previous.map((set) => set.weightKg));
    if (heaviestNow > 0 && heaviestNow > heaviestBefore + 0.004) {
      records.push({ ...base, kind: 'heaviest', weightKg: heaviestNow, reps: mostRepsAt(now, heaviestNow) ?? 0 });
    }
    let repsRecord: { weightKg: number; reps: number } | null = null;
    for (const set of now) {
      const earlierBest = mostRepsAt(previous, set.weightKg);
      if (earlierBest === null || set.reps <= earlierBest) continue;
      if (repsRecord === null || set.weightKg > repsRecord.weightKg || (sameWeight(set.weightKg, repsRecord.weightKg) && set.reps > repsRecord.reps)) {
        repsRecord = { weightKg: set.weightKg, reps: set.reps };
      }
    }
    if (repsRecord !== null) records.push({ ...base, kind: 'reps', ...repsRecord });
    const bestVolumeBefore = Math.max(...before.map((sets) => sessionTotals(sets).volumeKg));
    if (exercise.volumeKg > 0 && exercise.volumeKg > bestVolumeBefore) records.push({ ...base, kind: 'volume', volumeKg: exercise.volumeKg });
  }
  return records;
}

export const LOAD_BUCKET_S = 1;

export interface SessionLoad {
  value: number | null;
  reason: string | null;
}

export function sessionLoad(points: readonly HeartRatePoint[], window: { start: number; end: number }, ref: LoadReference): SessionLoad {
  if (!(window.end > window.start)) return { value: null, reason: 'no-data' };
  const hr: HrPoint[] = points.filter((point) => point.t >= window.start && point.t < window.end).map((point) => ({ t: point.t, hr: point.hr }));
  const load = activityMetrics(hr, window, [], ref.rest, ref.max, undefined, ref.zoneFloors ?? null).load;
  return load.ok ? { value: load.value, reason: null } : { value: null, reason: load.reason };
}

const MIN_TRAINED = 0.15;

export function muscleIntensity(rows: readonly MuscleLoad[]): Partial<Record<MuscleGroup, number>> {
  const topVolume = Math.max(0, ...rows.map((row) => row.volumeKg));
  const topSets = Math.max(0, ...rows.map((row) => row.sets));
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const row of rows) {
    if (row.sets <= 0) continue;
    const share = topVolume > 0 ? row.volumeKg / topVolume : topSets > 0 ? row.sets / topSets : 0;
    out[row.muscle] = Math.min(1, Math.max(MIN_TRAINED, share));
  }
  return out;
}

const TEMPLATE_HISTORY = 5;

export function templateMinutes(templateId: number, sessions: readonly StrengthSession[]): number | null {
  const durations = finishedSessions(sessions)
    .filter((session) => session.templateId === templateId)
    .slice(-TEMPLATE_HISTORY)
    .map((session) => durationS(session, session.startedAt) / 60)
    .filter((minutes) => minutes >= 1)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 === 1 ? (durations[middle] ?? 0) : ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2;
  return Math.max(5, Math.round(median / 5) * 5);
}

export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const BIG_VOLUME = 10_000;

export interface VolumeMeasure {
  value: string;
  scale: 'one' | 'thousand';
}

export function formatVolume(kg: number, units: Units, language: Language): VolumeMeasure {
  const value = weightIn(kg, units);
  if (value < BIG_VOLUME) return { value: formatNumber(value, 0, language), scale: 'one' };
  const thousands = value / 1000;
  return { value: formatNumber(thousands, thousands < 100 ? 1 : 0, language), scale: 'thousand' };
}
