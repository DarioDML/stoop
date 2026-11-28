import { RawStreamError } from '@openhoop/core/raw-streams';
import { Session } from '@openhoop/core/session';
import type { LiveImuSecond } from '@openhoop/core';
import { SimBand } from '@openhoop/sim';
import type { SimOptions } from '@openhoop/sim';

import { RawStreamManager, StreamBusyError, type StreamConnection } from '@/data/rawStreamManager';
import { parseFlags } from '@/data/rawStreamPolicy';

const FLAGS_KEY = 'raw.cleanup.1';

interface Harness {
  band: SimBand;
  manager: RawStreamManager;
  settings: Map<string, string>;
  reports: unknown[];
  stored: LiveImuSecond[];
  gate(): () => void;
  connect(): Promise<StreamConnection>;
  drop(): Promise<void>;
  setNow(ms: number): void;
  failConnect(on: boolean): void;
  busy: { ecg: boolean; syncing: boolean };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup(opts: Partial<SimOptions> = {}, settings = new Map<string, string>(), band?: SimBand): Harness {
  const sim = band ?? new SimBand({ seed: 7, now: () => Date.now() / 1000, historyDays: 1 / 24, model: 'MG', rawIntervalMs: 40, ...opts });
  let conn: StreamConnection | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let nowMs = 0;
  let connectFails = false;
  const reports: unknown[] = [];
  const stored: LiveImuSecond[] = [];
  const busy = { ecg: false, syncing: false };
  const exclusive = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };
  const connect = async (): Promise<StreamConnection> => {
    if (conn !== null && conn.session.isConnected) return conn;
    if (connectFails) throw new Error('band out of range');
    const [found] = await sim.scan(1000);
    if (found === undefined) throw new Error('no band');
    await sim.connect(found.id);
    await sim.bond();
    const session = new Session(sim);
    await session.open();
    session.onPacket((packet) => manager.onPacket(session, packet));
    conn = { session, deviceId: 1 };
    await manager.attach(conn);
    return conn;
  };
  const manager = new RawStreamManager({
    exclusive,
    current: () => conn,
    connect,
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => {
      settings.set(key, value);
    },
    busy: () => busy,
    storeImu: (_deviceId, second) => {
      stored.push(second);
    },
    publish: () => undefined,
    report: (error) => {
      reports.push(error);
    },
    now: () => nowMs,
  });
  return {
    band: sim,
    manager,
    settings,
    reports,
    stored,
    busy,
    gate: () => {
      let open: () => void = () => undefined;
      const blocked = new Promise<void>((resolve) => {
        open = resolve;
      });
      void exclusive(() => blocked);
      return open;
    },
    connect,
    drop: async () => {
      await sim.disconnect();
    },
    setNow: (ms) => {
      nowMs = ms;
    },
    failConnect: (on) => {
      connectFails = on;
    },
  };
}

describe('raw stream manager', () => {
  it('a stop while the start is still queued leaves nothing on', async () => {
    const h = setup();
    await h.connect();
    const open = h.gate();
    const started = h.manager.start('workout', ['imu']);
    const stopped = h.manager.stop('workout');
    open();
    expect(await started).toBe(false);
    await stopped;
    expect(h.band.imuOn).toBe(false);
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null).imu).toBe(false);
  });

  it('a stop out of range keeps the flag, and the next connect switches the stream off', async () => {
    const h = setup();
    expect(await h.manager.start('workout', ['imu'])).toBe(true);
    expect(h.band.imuOn).toBe(true);
    await h.drop();
    await h.manager.stop('workout');
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null).imu).toBe(true);
    expect(h.band.imuOn).toBe(true);
    await h.connect();
    expect(h.band.imuOn).toBe(false);
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null).imu).toBe(false);
  });

  it('a refused stream leaves the owner its other running stream', async () => {
    const h = setup({ rawRefuse: [108] });
    expect(await h.manager.start('developer', ['imu'])).toBe(true);
    expect(await h.manager.start('developer', ['optical'])).toBe(false);
    expect(h.band.imuOn).toBe(true);
    expect(h.manager.live().owners.developer).toEqual(['imu']);
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null)).toMatchObject({ imu: true, optical: false });
    expect(h.reports.some((e) => e instanceof RawStreamError)).toBe(true);
    await h.manager.stop('developer');
    expect(h.band.imuOn).toBe(false);
  });

  it('the fail-safe cannot switch off a stream claimed after it fired', async () => {
    const first = setup();
    await first.manager.start('workout', ['imu']);
    await first.drop();
    const h = setup({}, new Map(), first.band);
    await h.connect();
    const open = h.gate();
    await wait(150);
    const claimed = h.manager.start('workout', ['imu']);
    open();
    expect(await claimed).toBe(true);
    await wait(200);
    expect(h.band.imuOn).toBe(true);
    expect(h.manager.live().owners.workout).toEqual(['imu']);
    await h.manager.stop('workout');
    expect(h.band.imuOn).toBe(false);
  });

  it('an orphaned stream with no owner is switched off by the fail-safe', async () => {
    const first = setup();
    await first.manager.start('developer', ['optical']);
    await first.drop();
    const h = setup({}, new Map(), first.band);
    await h.connect();
    await wait(300);
    expect(h.band.opticalOn).toBe(false);
  });

  it('a refused cleanup never blocks the connection, and a refused stop counts as off', async () => {
    const settings = new Map([[FLAGS_KEY, JSON.stringify({ imu: true, optical: true, band: true })]]);
    const h = setup({ rawRefuse: [82] }, settings);
    await expect(h.connect()).resolves.toBeDefined();
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null)).toEqual({ imu: false, optical: false, band: false });
    expect(h.band.rawSessionBodies.map((b) => [...b])).toEqual([[1]]);
  });

  it('a band recording stopped out of range is stopped on the next connect', async () => {
    const h = setup();
    expect(await h.manager.setBandRecording(true)).toBe(true);
    expect(h.band.rawSessionBodies.map((b) => b[0])).toEqual([2]);
    await h.drop();
    await h.manager.setBandRecording(false);
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null).band).toBe(true);
    await h.connect();
    expect(h.band.rawSessionBodies.map((b) => b[0])).toEqual([2, 1]);
    expect(parseFlags(h.settings.get(FLAGS_KEY) ?? null).band).toBe(false);
  });

  it('stopping one kind keeps the other stream of the same owner', async () => {
    const h = setup();
    await h.manager.start('developer', ['imu', 'optical']);
    await h.manager.stop('developer', ['optical']);
    expect(h.band.opticalOn).toBe(false);
    expect(h.band.imuOn).toBe(true);
    expect(h.manager.live().owners.developer).toEqual(['imu']);
    await h.manager.stop('developer');
    expect(h.band.imuOn).toBe(false);
  });

  it('a band recording that cannot start leaves no intent behind', async () => {
    const h = setup();
    h.failConnect(true);
    expect(await h.manager.setBandRecording(true)).toBe(false);
    expect(h.manager.bandRequested()).toBe(false);
    h.failConnect(false);
    await h.connect();
    await wait(50);
    expect(h.band.rawSessionBodies).toEqual([]);
  });

  it('reassert re-sends a stream the band dropped on a live link', async () => {
    const h = setup();
    await h.manager.start('workout', ['imu']);
    h.band.imuOn = false;
    expect(await h.manager.reassert('workout')).toBe(true);
    expect(h.band.imuOn).toBe(true);
    await h.manager.stop('workout');
  });

  it('reassert stays quiet when the band is out of range', async () => {
    const h = setup();
    await h.manager.start('workout', ['imu']);
    await h.drop();
    h.failConnect(true);
    const before = h.reports.length;
    expect(await h.manager.reassert('workout')).toBe(false);
    expect(h.reports.length).toBe(before);
  });

  it('releaseAll switches every stream off', async () => {
    const h = setup();
    await h.manager.start('developer', ['imu', 'optical']);
    await h.manager.start('workout', ['imu']);
    await h.manager.releaseAll();
    expect(h.band.imuOn).toBe(false);
    expect(h.band.opticalOn).toBe(false);
  });

  it('the developer cap stops the developer streams and keeps the workout one', async () => {
    const h = setup();
    await h.manager.start('developer', ['optical']);
    await h.manager.start('workout', ['imu']);
    h.setNow(600_000);
    await h.manager.checkCaps();
    expect(h.band.opticalOn).toBe(false);
    expect(h.band.imuOn).toBe(true);
    await h.manager.stop('workout');
  });

  it('background releases the developer owner only', async () => {
    const h = setup();
    await h.manager.start('developer', ['imu', 'optical']);
    await h.manager.start('workout', ['imu']);
    await h.manager.background();
    expect(h.band.opticalOn).toBe(false);
    expect(h.band.imuOn).toBe(true);
    await h.manager.stop('workout');
  });

  it('refuses a developer start during an ECG reading or a sync', async () => {
    const h = setup();
    h.busy.syncing = true;
    expect(await h.manager.start('developer', ['imu'])).toBe(false);
    expect(h.reports[0]).toBeInstanceOf(StreamBusyError);
    h.busy.syncing = false;
    h.busy.ecg = true;
    expect(await h.manager.start('workout', ['imu'])).toBe(false);
    expect(h.band.imuOn).toBe(false);
  });

  it('stores workout motion seconds and keeps a developer buffer', async () => {
    const h = setup();
    await h.manager.start('workout', ['imu']);
    await h.manager.start('developer', ['imu']);
    await wait(250);
    expect(h.stored.length).toBeGreaterThanOrEqual(2);
    expect(h.manager.imuSeconds().length).toBeGreaterThanOrEqual(2);
    expect(h.manager.live().imu?.rateHz).toBe(100);
    await h.manager.releaseAll();
  });
});
