import { ALGO } from './types';

export const STRENGTH_MOTION = {
  algo: ALGO.strengthMotion,
  gravityWindowS: 3,
  envelopeWindowS: 0.5,
  searchS: 120,
  mergeGapS: 2,
  activityRatio: 3,
  activityFloorG: 0.02,
  activityCeilingG: 0.1,
  quietPercentile: 0.1,
  ecgMovementPercentile: 0.75,
  gyroWeightGPerDps: 0.001,
  minBoutS: 1.5,
  maxLiftCadenceHz: 1.1,
  bandLowHz: 0.15,
  bandHighHz: 2.5,
  minRepGapS: 0.6,
  prominence: 0.35,
  minReps: 2,
  minAmplitudeG: 0.03,
  minCoverage: 0.8,
  referenceSets: 3,
  factorMin: 0.7,
  factorMax: 1.3,
} as const;

type Axes = [number[], number[], number[]];

export interface MotionSecond {
  t: number;
  rateHz: number;
  accel: Axes;
  gyro: Axes;
}

export interface Bout {
  start: number;
  end: number;
}

export interface SetMotion {
  status: 'readable' | 'unreadable' | 'none';
  reps: number | null;
  tutS: number | null;
  tempoS: number | null;
  velocityLoss: number | null;
  coverage: number;
}

interface Series {
  rate: number;
  time: number[];
  dx: number[];
  dy: number[];
  dz: number[];
  gyro: number[];
}

const C = STRENGTH_MOTION;

function movingAverage(x: readonly number[], window: number): number[] {
  const n = x.length;
  const half = Math.max(0, Math.floor(window / 2));
  const prefix = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] ?? 0) + (x[i] ?? 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(n, i + half + 1);
    out.push(((prefix[to] ?? 0) - (prefix[from] ?? 0)) / (to - from));
  }
  return out;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0;
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

function finite(v: number | undefined): number {
  return v !== undefined && Number.isFinite(v) ? v : 0;
}

function seriesBetween(seconds: readonly MotionSecond[], from: number, to: number): Series | null {
  const inRange = seconds.filter((s) => s.t + 1 > from && s.t < to).sort((a, b) => a.t - b.t);
  const first = inRange[0];
  if (first === undefined) return null;
  const rate = Math.max(1, first.rateHz);
  const time: number[] = [];
  const ax: number[] = [];
  const ay: number[] = [];
  const az: number[] = [];
  const gyro: number[] = [];
  for (const s of inRange) {
    const n = s.accel[0].length;
    for (let i = 0; i < n; i++) {
      time.push(s.t + i / rate);
      ax.push(finite(s.accel[0][i]));
      ay.push(finite(s.accel[1][i]));
      az.push(finite(s.accel[2][i]));
      gyro.push(Math.hypot(finite(s.gyro[0][i]), finite(s.gyro[1][i]), finite(s.gyro[2][i])));
    }
  }
  const window = Math.round(C.gravityWindowS * rate);
  const gx = movingAverage(ax, window);
  const gy = movingAverage(ay, window);
  const gz = movingAverage(az, window);
  return {
    rate,
    time,
    dx: ax.map((v, i) => v - (gx[i] ?? 0)),
    dy: ay.map((v, i) => v - (gy[i] ?? 0)),
    dz: az.map((v, i) => v - (gz[i] ?? 0)),
    gyro,
  };
}

function envelope(s: Series): number[] {
  const power = s.dx.map((x, i) => {
    const m = Math.hypot(x, s.dy[i] ?? 0, s.dz[i] ?? 0) + C.gyroWeightGPerDps * (s.gyro[i] ?? 0);
    return m * m;
  });
  return movingAverage(power, Math.round(C.envelopeWindowS * s.rate)).map(Math.sqrt);
}

function activityThreshold(s: Series, env: readonly number[]): number {
  const perSecond = new Map<number, number[]>();
  s.time.forEach((t, i) => {
    const key = Math.floor(t);
    const list = perSecond.get(key) ?? [];
    list.push(env[i] ?? 0);
    perSecond.set(key, list);
  });
  const means = [...perSecond.values()].map((list) => list.reduce((a, b) => a + b, 0) / list.length);
  const quiet = percentile(means, C.quietPercentile);
  return Math.min(C.activityCeilingG, Math.max(C.activityFloorG, C.activityRatio * quiet));
}

function principalAxis(dx: readonly number[], dy: readonly number[], dz: readonly number[]): [number, number, number] {
  const n = dx.length;
  const mean = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, n);
  const m: [number, number, number] = [mean(dx), mean(dy), mean(dz)];
  const cols = [dx, dy, dz];
  const cov: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const row = cov[a];
        if (row !== undefined) row[b] = (row[b] ?? 0) + ((cols[a]?.[i] ?? 0) - (m[a] ?? 0)) * ((cols[b]?.[i] ?? 0) - (m[b] ?? 0));
      }
    }
  }
  let v: [number, number, number] = [1, 1, 1];
  for (let k = 0; k < 50; k++) {
    const next: [number, number, number] = [0, 0, 0];
    for (let a = 0; a < 3; a++) next[a] = (cov[a]?.[0] ?? 0) * v[0] + (cov[a]?.[1] ?? 0) * v[1] + (cov[a]?.[2] ?? 0) * v[2];
    const norm = Math.hypot(...next);
    if (norm === 0) return [0, 0, 1];
    v = [next[0] / norm, next[1] / norm, next[2] / norm];
  }
  return v;
}

function findPeaks(x: readonly number[], minDistance: number, minProminence: number): number[] {
  const candidates: { i: number; h: number }[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    const h = x[i] ?? 0;
    if (h <= 0 || h <= (x[i - 1] ?? 0) || h < (x[i + 1] ?? 0)) continue;
    let leftMin = h;
    for (let j = i - 1; j >= 0 && (x[j] ?? 0) <= h; j--) leftMin = Math.min(leftMin, x[j] ?? 0);
    let rightMin = h;
    for (let j = i + 1; j < x.length && (x[j] ?? 0) <= h; j++) rightMin = Math.min(rightMin, x[j] ?? 0);
    if (h - Math.max(leftMin, rightMin) >= minProminence) candidates.push({ i, h });
  }
  const accepted: number[] = [];
  for (const c of [...candidates].sort((a, b) => b.h - a.h)) {
    if (accepted.every((i) => Math.abs(i - c.i) >= minDistance)) accepted.push(c.i);
  }
  return accepted.sort((a, b) => a - b);
}

interface BoutSignal {
  peaks: number[];
  heights: number[];
  amplitude: number;
  cadenceHz: number;
}

function boutSignal(seconds: readonly MotionSecond[], bout: Bout): BoutSignal | null {
  const s = seriesBetween(seconds, bout.start - C.gravityWindowS, bout.end + C.gravityWindowS);
  if (s === null) return null;
  const idx = s.time.map((t, i) => (t >= bout.start && t <= bout.end ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  const dx = idx.map((i) => s.dx[i] ?? 0);
  const dy = idx.map((i) => s.dy[i] ?? 0);
  const dz = idx.map((i) => s.dz[i] ?? 0);
  const amplitude = percentile(dx.map((x, k) => Math.hypot(x, dy[k] ?? 0, dz[k] ?? 0)), 0.9);
  const axis = principalAxis(dx, dy, dz);
  const raw = dx.map((x, k) => x * axis[0] + (dy[k] ?? 0) * axis[1] + (dz[k] ?? 0) * axis[2]);
  const projected = movingAverage(raw, Math.max(1, Math.round(s.rate / (2 * C.bandHighHz))));
  const mean = projected.reduce((a, b) => a + b, 0) / projected.length;
  let crossings = 0;
  for (let k = 1; k < projected.length; k++) if (((projected[k - 1] ?? 0) - mean) * ((projected[k] ?? 0) - mean) < 0) crossings += 1;
  const cadenceHz = crossings / 2 / Math.max(1e-6, bout.end - bout.start);
  const sign = percentile(projected, 0.9) >= percentile(projected.map((v) => -v), 0.9) ? 1 : -1;
  const oriented = projected.map((v) => sign * v);
  const scale = percentile(oriented.map(Math.abs), 0.9);
  const peaks = findPeaks(oriented, Math.round(C.minRepGapS * s.rate), C.prominence * scale);
  const troughBetween = (from: number, to: number): number => {
    let trough = Number.POSITIVE_INFINITY;
    for (let j = from; j < to; j++) trough = Math.min(trough, oriented[j] ?? 0);
    return trough;
  };
  const heights = peaks.map((k, n) => {
    const peak = oriented[k] ?? 0;
    const before = troughBetween(peaks[n - 1] ?? 0, k);
    const after = troughBetween(k + 1, peaks[n + 1] ?? oriented.length);
    return peak - Math.min(Number.isFinite(before) ? before : peak, Number.isFinite(after) ? after : peak);
  });
  return { peaks: peaks.map((k) => s.time[idx[k] ?? 0] ?? 0), heights, amplitude, cadenceHz };
}

function isLift(signal: BoutSignal | null): boolean {
  return signal !== null && signal.peaks.length >= C.minReps && signal.amplitude >= C.minAmplitudeG && signal.cadenceHz <= C.maxLiftCadenceHz;
}

export function findBouts(seconds: readonly MotionSecond[], from: number, to: number): Bout[] {
  const s = seriesBetween(seconds, from, to);
  if (s === null) return [];
  const env = envelope(s);
  const threshold = activityThreshold(s, env);
  const segments: Bout[] = [];
  s.time.forEach((t, i) => {
    if (t < from || t > to || (env[i] ?? 0) <= threshold) return;
    const last = segments[segments.length - 1];
    if (last !== undefined && t - last.end <= C.mergeGapS) last.end = t;
    else segments.push({ start: t, end: t });
  });
  return segments.filter((b) => b.end - b.start >= C.minBoutS && isLift(boutSignal(seconds, b)));
}

export function lastBoutBefore(seconds: readonly MotionSecond[], doneAt: number, after: number): Bout | null {
  const from = Math.max(doneAt - C.searchS, after);
  const bouts = findBouts(seconds, from, doneAt).filter((b) => b.start > after);
  return bouts[bouts.length - 1] ?? null;
}

function coverageOf(seconds: readonly MotionSecond[], bout: Bout): number {
  const first = Math.floor(bout.start);
  const last = Math.max(first, Math.ceil(bout.end) - 1);
  const present = new Set(seconds.map((s) => s.t));
  let have = 0;
  for (let t = first; t <= last; t++) if (present.has(t)) have += 1;
  return have / (last - first + 1);
}

export function analyseBout(seconds: readonly MotionSecond[], bout: Bout): SetMotion {
  const coverage = coverageOf(seconds, bout);
  const empty = { reps: null, tutS: null, tempoS: null, velocityLoss: null, coverage };
  if (coverage < C.minCoverage) return { status: 'none', ...empty };
  const signal = boutSignal(seconds, bout);
  if (signal === null || signal.amplitude < C.minAmplitudeG || signal.peaks.length < C.minReps) return { status: 'unreadable', ...empty };
  const reps = signal.peaks.length;
  const tutS = bout.end - bout.start;
  const h = signal.heights;
  const first = ((h[0] ?? 0) + (h[1] ?? 0)) / 2;
  const last = ((h[reps - 2] ?? 0) + (h[reps - 1] ?? 0)) / 2;
  return { status: 'readable', reps, tutS, tempoS: tutS / reps, velocityLoss: first > 0 ? 1 - last / first : null, coverage };
}

export function tempoFactor(tempoS: number | null, referenceTempos: readonly number[]): number {
  if (tempoS === null || referenceTempos.length < C.referenceSets) return 1;
  const reference = median(referenceTempos);
  if (reference <= 0) return 1;
  return Math.min(C.factorMax, Math.max(C.factorMin, tempoS / reference));
}

export function wristMovementG(seconds: readonly MotionSecond[], from: number, to: number): number | null {
  const s = seriesBetween(seconds, from - C.gravityWindowS, to + C.gravityWindowS);
  if (s === null) return null;
  const perSecond = new Map<number, { sum: number; n: number }>();
  s.time.forEach((t, i) => {
    if (t < from || t > to) return;
    const bucket = perSecond.get(Math.floor(t)) ?? { sum: 0, n: 0 };
    bucket.sum += (s.dx[i] ?? 0) ** 2 + (s.dy[i] ?? 0) ** 2 + (s.dz[i] ?? 0) ** 2;
    bucket.n += 1;
    perSecond.set(Math.floor(t), bucket);
  });
  const rms = [...perSecond.values()].map((b) => Math.sqrt(b.sum / b.n)).sort((a, b) => a - b);
  if (rms.length === 0) return null;
  return rms[Math.ceil(rms.length * C.ecgMovementPercentile) - 1] ?? null;
}
