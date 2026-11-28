import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addStrengthSet,
  afterSignals,
  computeEcgMovement,
  computeSessionMotion,
  insertEcgRecording,
  insertSignals,
  listEcgRecordings,
  listSetMotion,
  listStrengthData,
  openStore,
  pruneSignalsBefore,
  startStrengthSession,
} from '../src/index';
import type { DeviceRow, StrengthSession, StrengthSetInput, Store } from '../src/index';
import { lift, segmentSeconds, still, synthImu, walk } from './motionFactory';
import type { Segment } from './motionFactory';
import { openStrictDriver } from './strictDriver';

const T0 = 1_795_900_000;
const DEVICE: Omit<DeviceRow, 'id'> = { bleId: 'AA', name: 'MG', model: 'MG', firmware: '50.43.2.0', serial: null, ownerSince: null, configSnapshot: null };
const BENCH: StrengthSetInput = { exerciseKey: 'bench', exerciseName: 'Bench press', muscle: 'chest', reps: 8, weightKg: 60, rpe: null };

describe('per-set motion', () => {
  let store: Store;
  let deviceId: number;

  beforeEach(async () => {
    store = await openStore(openStrictDriver());
    deviceId = (await store.upsertDevice(DEVICE)).id;
  });
  afterEach(async () => {
    await store.driver.close();
  });

  async function sessionWithSets(startedAt: number, doneAts: readonly number[], input: StrengthSetInput = BENCH): Promise<StrengthSession> {
    const id = await startStrengthSession(store.driver, { templateId: null, name: 'Push', day: '2026-11-28', exercises: [] }, startedAt);
    for (const doneAt of doneAts) await addStrengthSet(store.driver, id, input, doneAt);
    const session = (await listStrengthData(store.driver)).sessions.find((s) => s.id === id);
    if (session === undefined) throw new Error('session not stored');
    return session;
  }

  async function storeMotion(t0: number, segments: readonly Segment[]): Promise<void> {
    await insertSignals(store.driver, { imu: synthImu(deviceId, t0, segments), optical: [] }, null);
  }

  const oneSet: Segment[] = [walk(30), still(5), lift(8), still(5)];

  it('live session with three sets gets readable rows', async () => {
    await storeMotion(T0, [...oneSet, ...oneSet, ...oneSet]);
    const per = segmentSeconds(oneSet);
    const session = await sessionWithSets(T0, [T0 + per, T0 + 2 * per, T0 + 3 * per]);
    const rows = await computeSessionMotion(store.driver, deviceId, session, 0);
    expect(rows.map((r) => [r.status, r.repsDetected])).toEqual([
      ['readable', 8],
      ['readable', 8],
      ['readable', 8],
    ]);
    expect(rows.every((r) => r.factor === 1)).toBe(true);
    const stored = await listSetMotion(store.driver, [session.id]);
    expect(stored.size).toBe(3);
    expect(stored.get(session.sets[1]?.id ?? -1)?.algo).toBe('strength.motion@1');
  });

  it('sets logged after the lifting are matched in order', async () => {
    await storeMotion(T0, [...oneSet, ...oneSet, ...oneSet, still(400)]);
    const session = await sessionWithSets(T0, [T0 + 900, T0 + 930, T0 + 960]);
    const rows = await computeSessionMotion(store.driver, deviceId, session, 0);
    expect(rows.map((r) => [r.status, r.repsDetected])).toEqual([
      ['readable', 8],
      ['readable', 8],
      ['readable', 8],
    ]);
  });

  it('unequal bout count leaves sets unmatched', async () => {
    await storeMotion(T0, [...oneSet, ...oneSet, still(400)]);
    const session = await sessionWithSets(T0, [T0 + 900, T0 + 930, T0 + 960]);
    const rows = await computeSessionMotion(store.driver, deviceId, session, 0);
    expect(rows.map((r) => r.status)).toEqual(['unmatched', 'unmatched', 'unmatched']);
    expect(rows.every((r) => r.factor === 1 && r.repsDetected === null)).toBe(true);
  });

  it('a wrist that barely moves is unreadable, and no motion at all is none', async () => {
    await storeMotion(T0, [still(40), lift(8, 2.5, 0.01), still(5)]);
    const session = await sessionWithSets(T0, [T0 + 65, T0 + 2_000]);
    const rows = await computeSessionMotion(store.driver, deviceId, session, 0);
    expect(rows.map((r) => r.status)).toEqual(['unreadable', 'none']);
  });

  it('post-sync range finds the session and fills it', async () => {
    const per = segmentSeconds(oneSet);
    const session = await sessionWithSets(T0, [T0 + per]);
    expect((await computeSessionMotion(store.driver, deviceId, session, 0)).map((r) => r.status)).toEqual(['none']);
    await storeMotion(T0, oneSet);
    const result = await afterSignals(store.driver, deviceId, { from: T0, to: T0 + per }, 0);
    expect(result.sessions).toBe(1);
    expect((await listSetMotion(store.driver, [session.id])).get(session.sets[0]?.id ?? -1)?.status).toBe('readable');
    expect((await afterSignals(store.driver, deviceId, { from: T0, to: T0 + per }, 0)).sessions).toBe(0);
  });

  it('clock offset shifts set windows', async () => {
    const per = segmentSeconds(oneSet);
    await storeMotion(T0 + 30, oneSet);
    const session = await sessionWithSets(T0, [T0 + per]);
    expect((await computeSessionMotion(store.driver, deviceId, session, 0)).map((r) => r.status)).not.toEqual(['readable']);
    expect((await computeSessionMotion(store.driver, deviceId, session, 30)).map((r) => r.status)).toEqual(['readable']);
  });

  it('references exclude the current and later sets', async () => {
    const quick: Segment[] = [still(10), lift(8, 2, 0.3), still(5)];
    const slow: Segment[] = [still(10), lift(6, 3.5, 0.3), still(5)];
    const history = await sessionWithSets(T0 - 10_000, [T0 - 9_970, T0 - 9_940, T0 - 9_910]);
    await storeMotion(T0 - 10_000, [still(5), ...quick, ...quick, ...quick].slice(1));
    await computeSessionMotion(store.driver, deviceId, history, 0);
    const q = segmentSeconds(quick);
    const s = segmentSeconds(slow);
    await storeMotion(T0, [...quick, ...slow, ...quick]);
    const session = await sessionWithSets(T0, [T0 + q, T0 + q + s, T0 + 2 * q + s]);
    const rows = await computeSessionMotion(store.driver, deviceId, session, 0);
    expect(rows.map((r) => r.status)).toEqual(['readable', 'readable', 'readable']);
    expect(rows[1]?.factor).toBeGreaterThan(1.2);
    expect(rows[0]?.factor).toBeCloseTo(1, 1);
    const again = await computeSessionMotion(store.driver, deviceId, session, 0);
    expect(again[1]?.factor).toBeCloseTo(rows[1]?.factor ?? 0, 6);
  });

  it('ECG movement is stored once and survives pruneSignalsBefore', async () => {
    await storeMotion(T0, [still(5), lift(12), still(5)]);
    await insertEcgRecording(store.driver, deviceId, { startedAt: T0 + 5, durationMs: 30_000, samples: [1, 2, 3], rateHz: 128, wrist: 'left' });
    const result = await afterSignals(store.driver, deviceId, { from: T0, to: T0 + 40 }, 0);
    expect(result.ecg).toBe(1);
    const [reading] = await listEcgRecordings(store.driver, deviceId);
    expect(reading?.movementG).toBeGreaterThan(0.1);
    await pruneSignalsBefore(store.driver, deviceId, T0 + 1_000);
    expect((await afterSignals(store.driver, deviceId, { from: T0, to: T0 + 40 }, 0)).ecg).toBe(0);
    expect((await listEcgRecordings(store.driver, deviceId))[0]?.movementG).toBe(reading?.movementG);
  });

  it('a recompute replaces stored ECG movement only where the motion is still kept', async () => {
    await storeMotion(T0, [still(5), lift(12), still(5)]);
    await insertEcgRecording(store.driver, deviceId, { startedAt: T0 + 5, durationMs: 30_000, samples: [1, 2, 3], rateHz: 128, wrist: 'left' });
    await insertEcgRecording(store.driver, deviceId, { startedAt: T0 + 5_000, durationMs: 30_000, samples: [1, 2, 3], rateHz: 128, wrist: 'left' });
    await store.driver.run('UPDATE ecg_recordings SET movement_g = 0.5');
    expect(await computeEcgMovement(store.driver, deviceId, 0, T0 + 10_000, 0)).toBe(0);
    expect(await computeEcgMovement(store.driver, deviceId, 0, T0 + 10_000, 0, { replace: true })).toBe(1);
    const readings = await listEcgRecordings(store.driver, deviceId);
    const kept = readings.find((r) => r.t === T0 + 5);
    expect(kept?.movementG).toBeGreaterThan(0.1);
    expect(kept?.movementG).not.toBe(0.5);
    expect(readings.find((r) => r.t === T0 + 5_000)?.movementG).toBe(0.5);
  });
});
