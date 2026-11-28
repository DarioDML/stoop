import type { LiveImuSecond, LiveOpticalSecond, Session, StreamKind } from '@openhoop/core';
import { RawStreamError, StreamCollector, isLiveSignal, startBandRecording, stopBandRecording, switchStreams } from '@openhoop/core/raw-streams';
import type { Packet } from '@openhoop/protocol';

import { EMPTY_IMU_TAIL, IDLE_RAW_LIVE, appendImuTail, opticalChannels } from './rawLive';
import type { RawLiveState } from './rawLive';
import { FailSafe, StreamOwners, onBackground, parseFlags, planReconcile, serializeFlags } from './rawStreamPolicy';
import type { StreamOwner } from './rawStreamPolicy';

export const DEV_STREAM_SECONDS = 600;
export const BAND_RECORDING_MS = 10_800_000;

const KINDS: readonly StreamKind[] = ['imu', 'optical'];

export class StreamBusyError extends Error {
  constructor() {
    super('an ECG reading or a sync is running');
    this.name = 'StreamBusyError';
  }
}

export interface StreamConnection {
  session: Session;
  deviceId: number;
}

export interface StreamHost {
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  current(): StreamConnection | null;
  connect(): Promise<StreamConnection>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  busy(): { ecg: boolean; syncing: boolean };
  storeImu(deviceId: number, second: LiveImuSecond): void;
  publish(state: RawLiveState): void;
  report(error: unknown): void;
  now(): number;
}

export function streamFlagsKey(deviceId: number): string {
  return `raw.cleanup.${deviceId}`;
}

function keepLast<T>(list: readonly T[], item: T, limit: number): T[] {
  const next = [...list, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export class RawStreamManager {
  private readonly owners = new StreamOwners();
  private readonly failSafe = new FailSafe();
  private readonly mayBeOn = new Set<StreamKind>();
  private readonly confirmed = new Set<StreamKind>();
  private bandWanted = false;
  private bandConfirmed = false;
  private bandMayBeOn = false;
  private collector: { session: Session; collector: StreamCollector } | null = null;
  private devImu: LiveImuSecond[] = [];
  private devOptical: LiveOpticalSecond[] = [];
  private state: RawLiveState = IDLE_RAW_LIVE;

  constructor(private readonly host: StreamHost) {}

  live(): RawLiveState {
    return this.state;
  }

  imuSeconds(): readonly LiveImuSecond[] {
    return this.devImu;
  }

  opticalSeconds(): readonly LiveOpticalSecond[] {
    return this.devOptical;
  }

  active(): StreamKind[] {
    return this.owners.active();
  }

  hasOwner(owner: StreamOwner): boolean {
    return this.owners.has(owner);
  }

  bandRequested(): boolean {
    return this.bandWanted;
  }

  async start(owner: StreamOwner, kinds: readonly StreamKind[]): Promise<boolean> {
    const busy = this.host.busy();
    if (busy.ecg || (owner === 'developer' && busy.syncing)) {
      this.host.report(new StreamBusyError());
      return false;
    }
    const newly = this.owners.claim(owner, kinds, this.host.now());
    if (owner === 'developer') {
      if (newly.includes('imu')) this.devImu = [];
      if (newly.includes('optical')) this.devOptical = [];
    }
    this.publishOwners();
    try {
      await this.queue();
    } catch (error) {
      this.owners.releaseKinds(owner, newly);
      this.publishOwners();
      this.host.report(error);
      return false;
    }
    return kinds.every((kind) => this.confirmed.has(kind) && this.owners.kindsOf(owner).includes(kind));
  }

  async stop(owner: StreamOwner, kinds?: readonly StreamKind[]): Promise<void> {
    if (kinds === undefined) {
      this.clearLive(this.owners.release(owner));
    } else {
      const before = this.owners.active();
      this.owners.releaseKinds(owner, kinds);
      const after = this.owners.active();
      this.clearLive(before.filter((kind) => !after.includes(kind)));
    }
    await this.settle();
  }

  async setBandRecording(on: boolean): Promise<boolean> {
    this.bandWanted = on;
    if (!on) this.bandConfirmed = false;
    await this.settle();
    if (on && !this.bandConfirmed) {
      this.bandWanted = false;
      if (this.bandMayBeOn) await this.settle();
      return false;
    }
    return on ? true : !this.bandMayBeOn;
  }

  async reassert(owner: StreamOwner): Promise<boolean> {
    const kinds = this.owners.kindsOf(owner);
    if (kinds.length === 0) return false;
    for (const kind of kinds) this.confirmed.delete(kind);
    try {
      await this.queue();
    } catch {
      return false;
    }
    return kinds.every((kind) => this.confirmed.has(kind));
  }

  async background(): Promise<void> {
    this.clearLive(onBackground(this.owners));
    await this.settle();
  }

  async releaseAll(): Promise<void> {
    this.owners.releaseAll();
    this.bandWanted = false;
    this.bandConfirmed = false;
    this.clearLive(KINDS);
    await this.settle();
  }

  async checkCaps(): Promise<void> {
    for (const owner of this.owners.expired(this.host.now())) await this.stop(owner);
  }

  async attach(conn: StreamConnection): Promise<void> {
    this.confirmed.clear();
    const flags = parseFlags(await this.host.getSetting(streamFlagsKey(conn.deviceId)));
    for (const kind of KINDS) if (flags[kind]) this.mayBeOn.add(kind);
    if (flags.band) this.bandMayBeOn = true;
    this.collect(conn);
    await this.reconcileWith(conn);
  }

  detach(): void {
    this.collector?.collector.close();
    this.collector = null;
  }

  onPacket(session: Session, packet: Packet): void {
    if (!isLiveSignal(packet) || packet.kind !== 'record') return;
    const kind: StreamKind = packet.layout === 21 ? 'imu' : 'optical';
    const busy = this.host.busy();
    if (!this.failSafe.shouldStop(this.host.now(), { owned: this.owners.active().includes(kind), ecg: busy.ecg, syncing: busy.syncing })) return;
    this.mayBeOn.add(kind);
    const conn = this.host.current();
    if (conn === null || conn.session !== session) return;
    void this.queue().catch(() => undefined);
  }

  private async settle(): Promise<void> {
    try {
      await this.queue();
    } catch (error) {
      this.host.report(error);
    }
  }

  private queue(): Promise<void> {
    return this.host.exclusive(async () => {
      let conn = this.host.current();
      if (conn === null || !conn.session.isConnected) {
        if (this.owners.active().length === 0 && !this.bandWanted) return;
        conn = await this.host.connect();
      }
      await this.reconcileWith(conn);
    });
  }

  private plan(): ReturnType<typeof planReconcile> {
    return planReconcile({
      target: this.owners.active(),
      confirmed: [...this.confirmed],
      mayBeOn: [...this.mayBeOn],
      bandWanted: this.bandWanted,
      bandConfirmed: this.bandConfirmed,
      bandMayBeOn: this.bandMayBeOn,
    });
  }

  private async reconcileWith(conn: StreamConnection): Promise<void> {
    const session = conn.session;
    for (const kind of this.plan().off) {
      if (!session.isConnected) break;
      this.failSafe.noteStop(this.host.now());
      try {
        await switchStreams(session, [kind], false);
        this.markOff(kind);
      } catch (error) {
        if (!(error instanceof RawStreamError)) break;
        this.markOff(kind);
      }
    }
    if (this.plan().stopBand && session.isConnected) {
      try {
        await stopBandRecording(session);
        this.bandMayBeOn = false;
      } catch (error) {
        if (error instanceof RawStreamError) this.bandMayBeOn = false;
      }
    }
    for (const kind of this.plan().on) {
      if (!session.isConnected) break;
      this.mayBeOn.add(kind);
      await this.saveFlags(conn.deviceId);
      try {
        await switchStreams(session, [kind], true);
        this.confirmed.add(kind);
      } catch (error) {
        if (!(error instanceof RawStreamError)) break;
        this.owners.dropKind(kind);
        this.mayBeOn.delete(kind);
        this.clearLive([kind]);
        this.host.report(error);
      }
    }
    if (this.plan().startBand && session.isConnected) {
      this.bandMayBeOn = true;
      await this.saveFlags(conn.deviceId);
      try {
        await startBandRecording(session, BAND_RECORDING_MS);
        this.bandConfirmed = true;
      } catch (error) {
        if (error instanceof RawStreamError) {
          this.bandWanted = false;
          this.bandMayBeOn = false;
          this.host.report(error);
        }
      }
    }
    await this.saveFlags(conn.deviceId);
    this.publishOwners();
  }

  private markOff(kind: StreamKind): void {
    this.mayBeOn.delete(kind);
    this.confirmed.delete(kind);
  }

  private async saveFlags(deviceId: number): Promise<void> {
    await this.host.setSetting(streamFlagsKey(deviceId), serializeFlags({ imu: this.mayBeOn.has('imu'), optical: this.mayBeOn.has('optical'), band: this.bandMayBeOn }));
  }

  private collect(conn: StreamConnection): void {
    if (this.collector?.session === conn.session) return;
    this.detach();
    const collector = new StreamCollector(conn.session);
    collector.onImu((second) => this.takeImu(conn, collector, second));
    collector.onOptical((second) => this.takeOptical(collector, second));
    this.collector = { session: conn.session, collector };
  }

  private takeImu(conn: StreamConnection, collector: StreamCollector, second: LiveImuSecond): void {
    if (!this.owners.active().includes('imu')) return;
    if (this.owners.has('developer')) this.devImu = keepLast(this.devImu, second, DEV_STREAM_SECONDS);
    if (this.owners.kindsOf('workout').includes('imu')) this.host.storeImu(conn.deviceId, second);
    const previous = this.state.imu;
    this.update({ imu: { rateHz: collector.measuredRate('imu'), seconds: (previous?.seconds ?? 0) + 1, tail: appendImuTail(previous?.tail ?? EMPTY_IMU_TAIL, second) } });
  }

  private takeOptical(collector: StreamCollector, second: LiveOpticalSecond): void {
    if (!this.owners.active().includes('optical')) return;
    if (this.owners.has('developer')) this.devOptical = keepLast(this.devOptical, second, DEV_STREAM_SECONDS);
    const previous = this.state.optical;
    this.update({ optical: { rateHz: collector.measuredRate('optical'), seconds: (previous?.seconds ?? 0) + 1, channels: opticalChannels(previous?.channels ?? [], second) } });
  }

  private clearLive(kinds: readonly StreamKind[]): void {
    this.update({
      owners: { developer: this.owners.kindsOf('developer'), workout: this.owners.kindsOf('workout') },
      imu: kinds.includes('imu') ? null : this.state.imu,
      optical: kinds.includes('optical') ? null : this.state.optical,
    });
  }

  private publishOwners(): void {
    this.update({ owners: { developer: this.owners.kindsOf('developer'), workout: this.owners.kindsOf('workout') } });
  }

  private update(change: Partial<RawLiveState>): void {
    this.state = { ...this.state, ...change };
    this.host.publish(this.state);
  }
}
