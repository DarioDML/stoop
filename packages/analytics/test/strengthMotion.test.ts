import { describe, expect, it } from 'vitest';
import { STRENGTH_MOTION, analyseBout, findBouts, lastBoutBefore, tempoFactor, wristMovementG } from '../src/index';
import type { MotionSecond } from '../src/index';

const T0 = 1_000;
const RATE = 100;
const LIFT_AXIS: [number, number, number] = [0.6, 0.3, 0.74];

type Segment =
  | { kind: 'walk'; s: number }
  | { kind: 'still'; s: number }
  | { kind: 'lift'; reps: number; periodS: number; ampG: number; decay?: number };

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648 - 0.5;
  };
}

function synthSession(segments: readonly Segment[]): MotionSecond[] {
  const noise = seeded(7);
  const norm = Math.hypot(...LIFT_AXIS);
  const u = LIFT_AXIS.map((v) => v / norm);
  const ax: number[] = [];
  const ay: number[] = [];
  const az: number[] = [];
  const gx: number[] = [];
  const gy: number[] = [];
  const gz: number[] = [];
  const push = (dyn: [number, number, number], gyro: [number, number, number]): void => {
    ax.push(dyn[0] + 0.005 * noise());
    ay.push(dyn[1] + 0.005 * noise());
    az.push(1 + dyn[2] + 0.005 * noise());
    gx.push(gyro[0] + 0.5 * noise());
    gy.push(gyro[1] + 0.5 * noise());
    gz.push(gyro[2] + 0.5 * noise());
  };
  for (const seg of segments) {
    if (seg.kind === 'still') {
      for (let i = 0; i < seg.s * RATE; i++) push([0, 0, 0], [0, 0, 0]);
    } else if (seg.kind === 'walk') {
      for (let i = 0; i < seg.s * RATE; i++) {
        const t = i / RATE;
        push([0.1 * Math.sin(2 * Math.PI * 0.9 * t), 0, 0.15 * Math.sin(2 * Math.PI * 1.8 * t)], [80 * Math.cos(2 * Math.PI * 0.9 * t), 0, 0]);
      }
    } else {
      const n = Math.round(seg.reps * seg.periodS * RATE);
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const rep = Math.floor(t / seg.periodS);
        const a = seg.ampG * (seg.decay ?? 1) ** rep * Math.sin((2 * Math.PI * t) / seg.periodS);
        const w = 60 * Math.cos((2 * Math.PI * t) / seg.periodS);
        push([a * (u[0] ?? 0), a * (u[1] ?? 0), a * (u[2] ?? 0)], [w, 0.3 * w, 0]);
      }
    }
  }
  const seconds: MotionSecond[] = [];
  for (let s = 0; s * RATE < ax.length; s++) {
    const slice = (arr: number[]): number[] => arr.slice(s * RATE, (s + 1) * RATE);
    seconds.push({ t: T0 + s, rateHz: RATE, accel: [slice(ax), slice(ay), slice(az)], gyro: [slice(gx), slice(gy), slice(gz)] });
  }
  return seconds;
}

function jolt(seconds: readonly MotionSecond[], from: number, count: number, ampG: number): void {
  for (const second of seconds) {
    if (second.t < from || second.t >= from + count) continue;
    second.accel[0].forEach((v, i, axis) => {
      axis[i] = v + ampG * Math.sin((2 * Math.PI * 3 * i) / RATE);
    });
  }
}

function endOf(seconds: readonly MotionSecond[]): number {
  return (seconds[seconds.length - 1]?.t ?? T0) + 1;
}

describe('strength motion constants', () => {
  it('uses the first-version values from the design', () => {
    expect(STRENGTH_MOTION).toMatchObject({
      algo: 'strength.motion@1',
      gravityWindowS: 3,
      envelopeWindowS: 0.5,
      searchS: 120,
      mergeGapS: 2,
      activityRatio: 3,
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
    });
  });
});

describe('bouts and reps', () => {
  it('counts 8 reps after a walk and setup', () => {
    const seconds = synthSession([{ kind: 'walk', s: 60 }, { kind: 'still', s: 10 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.3 }, { kind: 'still', s: 5 }]);
    const bout = lastBoutBefore(seconds, endOf(seconds), T0);
    expect(bout).not.toBeNull();
    if (bout === null) return;
    expect(bout.start).toBeGreaterThan(T0 + 65);
    expect(bout.end).toBeLessThanOrEqual(T0 + 92);
    const result = analyseBout(seconds, bout);
    expect(result.status).toBe('readable');
    expect(result.reps).toBe(8);
    expect(result.tempoS).toBeGreaterThan(2);
    expect(result.tempoS).toBeLessThan(3);
    expect(result.coverage).toBe(1);
  });

  it('counts slow 4 s reps', () => {
    const seconds = synthSession([{ kind: 'still', s: 10 }, { kind: 'lift', reps: 6, periodS: 4, ampG: 0.2 }, { kind: 'still', s: 5 }]);
    const bout = lastBoutBefore(seconds, endOf(seconds), T0);
    expect(bout).not.toBeNull();
    if (bout === null) return;
    expect(analyseBout(seconds, bout).reps).toBe(6);
    expect(STRENGTH_MOTION.gravityWindowS).toBe(3);
  });

  it('still wrist is unreadable', () => {
    const seconds = synthSession([{ kind: 'still', s: 30 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.01 }, { kind: 'still', s: 5 }]);
    const result = analyseBout(seconds, { start: T0 + 30, end: T0 + 50 });
    expect(result.status).toBe('unreadable');
    expect(result.reps).toBeNull();
    expect(lastBoutBefore(seconds, endOf(seconds), T0)).toBeNull();
  });

  it('missing seconds lower coverage', () => {
    const full = synthSession([{ kind: 'still', s: 10 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.3 }, { kind: 'still', s: 5 }]);
    const bout = { start: T0 + 10, end: T0 + 30 };
    const dropThree = full.filter((s) => ![T0 + 12, T0 + 18, T0 + 24].includes(s.t));
    const partial = analyseBout(dropThree, bout);
    expect(partial.coverage).toBeLessThan(0.9);
    expect(partial.coverage).toBeGreaterThanOrEqual(0.8);
    const dropSix = full.filter((s) => ![T0 + 11, T0 + 13, T0 + 15, T0 + 17, T0 + 19, T0 + 21].includes(s.t));
    const sparse = analyseBout(dropSix, bout);
    expect(sparse.status).toBe('none');
    expect(sparse.reps).toBeNull();
  });

  it('velocity loss rises with fatigue', () => {
    const tiring = synthSession([{ kind: 'still', s: 10 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.4, decay: 0.9 }, { kind: 'still', s: 5 }]);
    const steady = synthSession([{ kind: 'still', s: 10 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.4 }, { kind: 'still', s: 5 }]);
    const bout = { start: T0 + 10, end: T0 + 30 };
    expect(analyseBout(tiring, bout).velocityLoss).toBeGreaterThan(0.3);
    expect(Math.abs(analyseBout(steady, bout).velocityLoss ?? 1)).toBeLessThan(0.05);
  });

  it('findBouts finds 3 bouts in 3 sets separated by walks', () => {
    const set: Segment[] = [{ kind: 'walk', s: 30 }, { kind: 'still', s: 5 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.3 }, { kind: 'still', s: 5 }];
    const seconds = synthSession([...set, ...set, ...set]);
    const bouts = findBouts(seconds, T0, endOf(seconds));
    expect(bouts).toHaveLength(3);
    expect(bouts.map((b) => analyseBout(seconds, b).reps)).toEqual([8, 8, 8]);
  });

  it('a quick set cannot take the previous set bout', () => {
    const seconds = synthSession([{ kind: 'still', s: 20 }, { kind: 'lift', reps: 8, periodS: 2.5, ampG: 0.3 }, { kind: 'still', s: 25 }]);
    expect(lastBoutBefore(seconds, T0 + 60, T0 + 40)).toBeNull();
    expect(lastBoutBefore(seconds, T0 + 60, T0)).not.toBeNull();
  });
});

describe('tempo factor', () => {
  it('slower set gets the higher factor', () => {
    expect(tempoFactor(3.5, [2.5, 2.4, 2.6])).toBeGreaterThan(1);
    expect(tempoFactor(2.0, [2.5, 2.4, 2.6])).toBeLessThan(1);
  });

  it('factor 1 below three references or without a tempo', () => {
    expect(tempoFactor(3.5, [2.5, 2.4])).toBe(1);
    expect(tempoFactor(null, [2.5, 2.4, 2.6])).toBe(1);
  });

  it('factor clamps to 0.7-1.3', () => {
    expect(tempoFactor(10, [2.5, 2.5, 2.5])).toBe(1.3);
    expect(tempoFactor(0.5, [2.5, 2.5, 2.5])).toBe(0.7);
  });
});

describe('wrist movement', () => {
  it('is near zero for a still wrist and grows with motion', () => {
    const still = synthSession([{ kind: 'still', s: 40 }]);
    const moving = synthSession([{ kind: 'still', s: 5 }, { kind: 'lift', reps: 12, periodS: 2.5, ampG: 0.3 }, { kind: 'still', s: 5 }]);
    expect(wristMovementG(still, T0 + 5, T0 + 35)).toBeLessThan(0.01);
    expect(wristMovementG(moving, T0 + 5, T0 + 35)).toBeGreaterThan(0.15);
    expect(wristMovementG(still, T0 + 100, T0 + 130)).toBeNull();
  });

  it('stays still when the hand only settles in the first seconds', () => {
    const seconds = synthSession([{ kind: 'still', s: 40 }]);
    jolt(seconds, T0 + 5, 3, 0.5);
    expect(wristMovementG(seconds, T0 + 5, T0 + 35)).toBeLessThan(0.02);
  });

  it('is not still when the wrist moves for a third of the reading', () => {
    const seconds = synthSession([{ kind: 'still', s: 40 }]);
    jolt(seconds, T0 + 5, 10, 0.3);
    expect(wristMovementG(seconds, T0 + 5, T0 + 35)).toBeGreaterThan(0.08);
  });
});
