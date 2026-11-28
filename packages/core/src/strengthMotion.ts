import { STRENGTH_MOTION, analyseBout, findBouts, lastBoutBefore, tempoFactor, wristMovementG } from '@openhoop/analytics';
import type { Bout, MotionSecond, SetMotion } from '@openhoop/analytics';
import { GYRO_INVALID } from '@openhoop/protocol';
import type { ImuSecond } from './signals';
import { imuBetween } from './signals';
import type { StrengthSession, StrengthSet } from './strength';
import { listStrengthData } from './strength';
import type { SqlDriver, SqlValue } from './store/types';

const ACCEL_LSB_PER_G = 4096;
const GYRO_LSB_PER_DPS = 16.384;
const DONE_PAD_S = 5;
const ECG_MIN_COVERAGE = 0.5;

export type SetMotionStatus = SetMotion['status'] | 'unmatched';

export type SetMotionRow = Omit<SetMotion, 'status' | 'reps'> & {
  setId: number;
  status: SetMotionStatus;
  repsDetected: number | null;
  factor: number;
  algo: string;
};

export function toMotionSecond(s: ImuSecond): MotionSecond {
  const g = (axis: readonly number[]): number[] => axis.map((v) => v / ACCEL_LSB_PER_G);
  const dps = (axis: readonly number[]): number[] => axis.map((v) => (v === GYRO_INVALID ? Number.NaN : v / GYRO_LSB_PER_DPS));
  return { t: s.t, rateHz: s.rateHz, accel: [g(s.accel[0]), g(s.accel[1]), g(s.accel[2])], gyro: [dps(s.gyro[0]), dps(s.gyro[1]), dps(s.gyro[2])] };
}

function hasMotion(seconds: readonly MotionSecond[], from: number, to: number): boolean {
  return seconds.some((s) => s.t >= Math.floor(from) && s.t < to);
}

interface Reference {
  exerciseKey: string;
  doneAt: number;
  tempoS: number;
}

async function otherSessionReferences(driver: SqlDriver, sessionId: number): Promise<Reference[]> {
  const rows = await driver.all<Record<string, SqlValue>>(
    `SELECT s.exercise_key, s.done_at, m.tempo_s FROM strength_set_motion m JOIN strength_sets s ON s.id = m.set_id
     WHERE m.status = 'readable' AND m.tempo_s IS NOT NULL AND s.session_id != ?`,
    [sessionId],
  );
  return rows.flatMap((row) => {
    const { exercise_key: key, done_at: doneAt, tempo_s: tempo } = row;
    return typeof key === 'string' && typeof doneAt === 'number' && typeof tempo === 'number' ? [{ exerciseKey: key, doneAt, tempoS: tempo }] : [];
  });
}

function rowOf(set: StrengthSet, status: SetMotionStatus, motion: SetMotion | null, factor: number): SetMotionRow {
  return {
    setId: set.id,
    status,
    repsDetected: motion?.reps ?? null,
    tutS: motion?.tutS ?? null,
    tempoS: motion?.tempoS ?? null,
    velocityLoss: motion?.velocityLoss ?? null,
    coverage: Math.min(1, Math.max(0, motion?.coverage ?? 0)),
    factor,
    algo: STRENGTH_MOTION.algo,
  };
}

async function writeRows(driver: SqlDriver, rows: readonly SetMotionRow[]): Promise<void> {
  for (const r of rows) {
    await driver.run(
      `INSERT OR REPLACE INTO strength_set_motion (set_id, status, reps_detected, tut_s, tempo_s, velocity_loss, coverage, factor, algo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.setId, r.status, r.repsDetected, r.tutS, r.tempoS !== null && r.tempoS > 0 ? r.tempoS : null, r.velocityLoss, r.coverage, r.factor, r.algo],
    );
  }
}

export async function computeSessionMotion(driver: SqlDriver, deviceId: number, session: StrengthSession, offsetS: number): Promise<SetMotionRow[]> {
  const sets = [...session.sets].sort((a, b) => a.doneAt - b.doneAt || a.id - b.id);
  const lastSet = sets[sets.length - 1];
  if (lastSet === undefined) return [];
  const startBand = session.startedAt + offsetS;
  const endBand = lastSet.doneAt + offsetS + DONE_PAD_S;
  const seconds = (await imuBetween(driver, deviceId, startBand - STRENGTH_MOTION.searchS, endBand)).map(toMotionSecond);

  const bouts: (Bout | null)[] = [];
  let after = startBand - 1;
  for (const set of sets) {
    const doneBand = set.doneAt + offsetS;
    const bout = lastBoutBefore(seconds, doneBand, after);
    bouts.push(bout);
    after = Math.max(doneBand, bout?.end ?? after);
  }

  const missing = bouts.filter((b) => b === null).length;
  let fallback: Bout[] | null = null;
  if (missing * 2 > sets.length) fallback = findBouts(seconds, startBand, endBand);
  if (fallback !== null && fallback.length === sets.length) fallback.forEach((b, i) => (bouts[i] = b));

  const others = await otherSessionReferences(driver, session.id);
  const rows: SetMotionRow[] = [];
  sets.forEach((set, i) => {
    const bout = bouts[i] ?? null;
    const doneBand = set.doneAt + offsetS;
    if (bout === null) {
      const windowHasMotion = hasMotion(seconds, doneBand - STRENGTH_MOTION.searchS, doneBand + 1);
      let status: SetMotionStatus = windowHasMotion ? 'unreadable' : 'none';
      if (fallback !== null && fallback.length > 0 && fallback.length !== sets.length) status = 'unmatched';
      rows.push(rowOf(set, status, null, 1));
      return;
    }
    const motion = analyseBout(seconds, bout);
    if (motion.status !== 'readable') {
      rows.push(rowOf(set, motion.status, motion, 1));
      return;
    }
    const earlierHere = rows.flatMap((r, k) => {
      const prior = sets[k];
      return prior !== undefined && prior.exerciseKey === set.exerciseKey && r.status === 'readable' && r.tempoS !== null && prior.doneAt < set.doneAt ? [r.tempoS] : [];
    });
    const earlierElsewhere = others.filter((r) => r.exerciseKey === set.exerciseKey && r.doneAt < set.doneAt).map((r) => r.tempoS);
    rows.push(rowOf(set, 'readable', motion, tempoFactor(motion.tempoS, [...earlierElsewhere, ...earlierHere])));
  });
  await driver.transaction((tx) => writeRows(tx, rows));
  return rows;
}

function rowFromDb(row: Record<string, SqlValue>): SetMotionRow | null {
  const { set_id: setId, status, reps_detected: reps, tut_s: tut, tempo_s: tempo, velocity_loss: loss, coverage, factor, algo } = row;
  if (typeof setId !== 'number' || typeof coverage !== 'number' || typeof factor !== 'number' || typeof algo !== 'string') return null;
  if (status !== 'readable' && status !== 'unreadable' && status !== 'none' && status !== 'unmatched') return null;
  const n = (v: SqlValue | undefined): number | null => (typeof v === 'number' ? v : null);
  return { setId, status, repsDetected: n(reps), tutS: n(tut), tempoS: n(tempo), velocityLoss: n(loss), coverage, factor, algo };
}

export async function listSetMotion(driver: SqlDriver, sessionIds: readonly number[]): Promise<Map<number, SetMotionRow>> {
  const out = new Map<number, SetMotionRow>();
  if (sessionIds.length === 0) return out;
  const rows = await driver.all<Record<string, SqlValue>>(
    `SELECT m.* FROM strength_set_motion m JOIN strength_sets s ON s.id = m.set_id WHERE s.session_id IN (${sessionIds.map(() => '?').join(', ')})`,
    [...sessionIds],
  );
  for (const row of rows) {
    const parsed = rowFromDb(row);
    if (parsed !== null) out.set(parsed.setId, parsed);
  }
  return out;
}

export async function sessionsNeedingMotion(driver: SqlDriver, fromBand: number, toBand: number, offsetS: number): Promise<number[]> {
  const rows = await driver.all<{ id: number }>(
    `SELECT s.id FROM strength_sessions s
     WHERE s.started_at + ? - ? <= ?
       AND COALESCE((SELECT MAX(done_at) FROM strength_sets WHERE session_id = s.id), s.started_at) + ? + ? >= ?
       AND EXISTS (
         SELECT 1 FROM strength_sets st LEFT JOIN strength_set_motion m ON m.set_id = st.id
         WHERE st.session_id = s.id AND (m.status IS NULL OR m.status != 'readable')
       )
     ORDER BY s.started_at`,
    [offsetS, STRENGTH_MOTION.searchS, toBand, offsetS, DONE_PAD_S, fromBand],
  );
  return rows.map((r) => r.id);
}

export async function computeEcgMovement(
  driver: SqlDriver,
  deviceId: number,
  fromBand: number,
  toBand: number,
  offsetS: number,
  opts: { replace: boolean } = { replace: false },
): Promise<number> {
  const missing = opts.replace ? '' : ' AND movement_g IS NULL';
  const rows = await driver.all<{ id: number; t: number; duration_ms: number }>(
    `SELECT id, t, duration_ms FROM ecg_recordings WHERE device_id = ?${missing} AND t + ? <= ? AND t + ? + duration_ms / 1000.0 >= ?`,
    [deviceId, offsetS, toBand, offsetS, fromBand],
  );
  let updated = 0;
  for (const row of rows) {
    const from = row.t + offsetS;
    const to = from + row.duration_ms / 1000;
    const seconds = (await imuBetween(driver, deviceId, Math.floor(from) - STRENGTH_MOTION.gravityWindowS, Math.ceil(to) + STRENGTH_MOTION.gravityWindowS)).map(toMotionSecond);
    const expected = Math.max(1, Math.ceil(to) - Math.floor(from));
    const present = seconds.filter((s) => s.t >= Math.floor(from) && s.t < to).length;
    if (present / expected < ECG_MIN_COVERAGE) continue;
    const movement = wristMovementG(seconds, from, to);
    if (movement === null) continue;
    updated += (await driver.run(`UPDATE ecg_recordings SET movement_g = ? WHERE id = ?${missing}`, [movement, row.id])).changes;
  }
  return updated;
}

export async function afterSignals(
  driver: SqlDriver,
  deviceId: number,
  range: { from: number; to: number },
  offsetS: number,
): Promise<{ sessions: number; ecg: number }> {
  const ids = await sessionsNeedingMotion(driver, range.from, range.to, offsetS);
  if (ids.length > 0) {
    const sessions = (await listStrengthData(driver)).sessions.filter((s) => ids.includes(s.id));
    for (const session of sessions) await computeSessionMotion(driver, deviceId, session, offsetS);
  }
  const ecg = await computeEcgMovement(driver, deviceId, range.from, range.to, offsetS);
  return { sessions: ids.length, ecg };
}
