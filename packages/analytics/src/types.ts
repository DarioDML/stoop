export type BandStateName = 'WAKE' | 'STILL' | 'SLEEP' | 'UP';

export interface Sample {
  t: number;
  hr: number | null;
  rr: number[];
  steps: number | null;
  skinTempC: number | null;
  spo2Raw: number | null;
  state: BandStateName | null;
  motionG: number | null;
}

export type Reason = 'no-data' | 'low-coverage' | 'no-sleep' | 'missing-signal' | 'needs-history' | 'no-profile';

export type Outcome<T> =
  | { ok: true; value: T; coverage: number; algo: string }
  | { ok: false; reason: Reason; algo: string };

export interface SleepPeriod {
  onset: number;
  offset: number;
  asleepS: number;
  inBedS: number;
  hrMin: number | null;
  hrMean: number | null;
  bedOnset?: number;
  bedOffset?: number;
  sleepOnset?: number;
}

export interface Night<P extends SleepPeriod = SleepPeriod> {
  periods: P[];
  onset: number;
  offset: number;
  asleepS: number;
  inBedS: number;
}

export const ALGO = {
  hrv: 'hrv.rmssd5m@1',
  restingHr: 'rhr.min5m@1',
  respiratory: 'resp.rsa@1',
  spo2: 'spo2.window-median@1',
  skinTemp: 'temp.night-mean@1',
  sleep: 'sleep.band-state@1',
  sleepNeed: 'sleep.need@1',
  sleepConsistency: 'sleep.consistency@1',
  sleepScore: 'sleep.score@1',
  readiness: 'readiness.rec-rhr@1',
  load: 'load.dse-hrr@1',
  zones: 'zones.hrr@1',
  workouts: 'workouts.hrr50@1',
  energy: 'energy.keytel-mifflin@1',
  stress: 'stress.hr-hrv-z5m@1',
  stages: 'stages.lr-hmm30s@1',
  strengthMotion: 'strength.motion@1',
  ecgMovement: 'ecg.movement-p75@1',
} as const;

export type AlgoId = (typeof ALGO)[keyof typeof ALGO];

export function fail<T>(reason: Reason, algo: string): Outcome<T> {
  return { ok: false, reason, algo };
}

export function succeed<T>(value: T, coverage: number, algo: string): Outcome<T> {
  return { ok: true, value, coverage: Math.min(1, Math.max(0, coverage)), algo };
}
