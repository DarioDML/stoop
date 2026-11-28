import type { EcgSummary, EcgSymptom } from '@openhoop/core';

export const ECG_STRIP_S = 5;


export interface TraceColumn {
  min: number;
  max: number;
}

export function traceColumns(samples: readonly number[], columns: number): TraceColumn[] {
  if (samples.length === 0 || columns < 1) return [];
  const count = Math.min(columns, samples.length);
  const out: TraceColumn[] = [];
  for (let c = 0; c < count; c++) {
    const from = Math.floor((c * samples.length) / count);
    const to = Math.max(from + 1, Math.floor(((c + 1) * samples.length) / count));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = from; i < to; i++) {
      const v = samples[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out.push({ min, max });
  }
  return out;
}

export interface TraceRange {
  low: number;
  high: number;
}

const RANGE_TAIL = 0.01;

export function stripLength(sampleCount: number, rateHz: number | null, durationMs: number): number {
  if (rateHz !== null && rateHz > 0) return Math.max(1, Math.round(rateHz * ECG_STRIP_S));
  return Math.max(1, Math.ceil(sampleCount / Math.max(1, Math.ceil(durationMs / 1000 / ECG_STRIP_S))));
}

export function ecgStrips(samples: readonly number[], rateHz: number | null, durationMs: number): number[][] {
  if (samples.length === 0) return [];
  const perStrip = stripLength(samples.length, rateHz, durationMs);
  const strips: number[][] = [];
  for (let at = 0; at < samples.length; at += perStrip) strips.push(samples.slice(at, at + perStrip));
  return strips;
}

export function traceRange(samples: readonly number[]): TraceRange | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0;
  const low = pick(RANGE_TAIL);
  const high = pick(1 - RANGE_TAIL);
  return high > low ? { low, high } : { low: low - 1, high: high + 1 };
}

function isoUtc(unixS: number): string {
  return new Date(unixS * 1000).toISOString();
}

export function ecgCsv(recording: EcgSummary, samples: readonly number[]): string {
  const rate = recording.rateHz;
  const lines = ['index,t_ms,value'];
  samples.forEach((value, i) => {
    const t = rate === null || rate <= 0 ? '' : String(Math.round((i * 1000) / rate));
    lines.push(`${i},${t},${Math.round(value)}`);
  });
  return `${lines.join('\r\n')}\r\n`;
}

export function ecgFileName(recording: EcgSummary): string {
  return `openhoop-ecg-${isoUtc(recording.t).slice(0, 19).replace(/[:T]/g, '-')}.csv`;
}

export type EcgContact = 'checking' | 'none' | 'weak' | 'good';

export const ECG_CONTACT = {
  minSamples: 50,
  flatSpan: 8,
  clipLimit: 32000,
  maxClipped: 0.02,
  maxRoughness: 0.2,
  bandGood: 3,
} as const;

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0;
}

function traceContact(tail: readonly number[]): Exclude<EcgContact, 'checking'> {
  const sorted = [...tail].sort((a, b) => a - b);
  const span = quantile(sorted, 0.99) - quantile(sorted, 0.01);
  if (span <= ECG_CONTACT.flatSpan) return 'none';
  const clipped = tail.filter((v) => Math.abs(v) >= ECG_CONTACT.clipLimit).length / tail.length;
  if (clipped > ECG_CONTACT.maxClipped) return 'weak';
  const steps = tail.slice(1).map((v, i) => Math.abs(v - (tail[i] ?? v))).sort((a, b) => a - b);
  return quantile(steps, 0.5) / span > ECG_CONTACT.maxRoughness ? 'weak' : 'good';
}

export function ecgContact(tail: readonly number[], bandQuality: number | null): EcgContact {
  if (bandQuality === 0) return 'none';
  if (tail.length < ECG_CONTACT.minSamples) return 'checking';
  const fromTrace = traceContact(tail);
  if (bandQuality === null || fromTrace !== 'good') return fromTrace;
  return bandQuality >= ECG_CONTACT.bandGood ? 'good' : 'weak';
}

export function toggleEcgSymptom(current: readonly EcgSymptom[], symptom: EcgSymptom): EcgSymptom[] {
  if (current.includes(symptom)) return current.filter((s) => s !== symptom);
  if (symptom === 'none') return ['none'];
  return [...current.filter((s) => s !== 'none'), symptom];
}

export type MovementBand = 'still' | 'some' | 'lots';

export const MOVEMENT_G = { still: 0.02, some: 0.08 } as const;

export function movementBand(g: number): MovementBand {
  if (g < MOVEMENT_G.still) return 'still';
  return g < MOVEMENT_G.some ? 'some' : 'lots';
}

export function movementMissing(recordingT: number, durationMs: number, lastSyncAt: number | null): 'awaitingSync' | 'noData' {
  return lastSyncAt === null || lastSyncAt < recordingT + durationMs / 1000 ? 'awaitingSync' : 'noData';
}
