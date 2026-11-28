import type { EcgSummary } from '@openhoop/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';

import { AppDataContext, LiveDataContext } from '@/data/context';
import { ECG_CONTACT, ecgContact, ecgCsv, ecgStrips, movementBand, movementMissing, stripLength, toggleEcgSymptom, traceColumns, traceRange } from '@/data/ecg';
import { ecgReportHtml } from '@/data/ecgReport';
import { shareEcgCsv } from '@/data/ecgShare';
import { createFixtureDevice } from '@/data/fixtureSource';
import { shareReportPdf } from '@/data/reportShare';
import type { LiveData, LiveDataStore } from '@/data/types';

import { FIXTURE_NOW, fixtureAppData, fixtureEcgActions, fixtureLiveData, withAppData } from './support/appData';

let mockParams: Record<string, string | undefined> = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (href: unknown) => mockPush(href), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  Link: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/data/ecgShare', () => ({ shareEcgCsv: jest.fn(async () => undefined), removeLeftoverEcgFiles: jest.fn() }));
jest.mock('@/data/reportShare', () => ({ shareReportPdf: jest.fn(async () => undefined), ShareUnavailableError: class extends Error {} }));

import EcgResultScreen from '@/app/health/ecg-result';
import EcgScreen from '@/app/health/ecg';
import BloodPressureScreen from '@/app/health/blood-pressure';
import IrregularRhythmScreen from '@/app/health/irregular-rhythm';

const MG = { ...createFixtureDevice(FIXTURE_NOW), model: 'MG' as const };
const RECORDING: EcgSummary = { id: 4, deviceId: 1, t: 1_795_700_000, durationMs: 30_000, sampleCount: 3840, rateHz: 128, wrist: 'left', symptoms: [], movementG: null };
const OLDER: EcgSummary = { ...RECORDING, id: 2, t: 1_795_600_000, wrist: 'right' };
const BEAT = Array.from({ length: 128 }, (_, i) => (i === 40 ? 1200 : i === 41 ? -300 : i > 70 && i < 90 ? 200 : 0));
const HEALTHY_TAIL = [...BEAT, ...BEAT, ...BEAT, ...BEAT];

function mutableLive(initial: LiveData): { store: LiveDataStore; set: (next: Partial<LiveData>) => void } {
  let data = initial;
  const listeners = new Set<() => void>();
  return {
    store: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => data,
    },
    set: (next) => {
      data = { ...data, ...next };
      listeners.forEach((listener) => listener());
    },
  };
}

beforeEach(() => {
  mockParams = {};
  mockPush.mockClear();
  jest.mocked(shareEcgCsv).mockClear();
  jest.mocked(shareReportPdf).mockClear();
});

describe('ECG recording screen', () => {
  it('records on the chosen wrist and opens the result', async () => {
    const start = jest.fn(async () => 9);
    await render(withAppData(<EcgScreen />, 'en', { device: MG, ecgActions: { ...fixtureEcgActions(), start } }));
    expect(screen.queryByTestId('needs-mg')).toBeNull();
    expect(screen.getByTestId('ecg-mg-ready')).toBeTruthy();
    expect(screen.getByTestId('ecg-countdown-value').props.children).toContain('30');
    await fireEvent.press(screen.getByText('Right wrist'));
    await fireEvent.press(screen.getByTestId('ecg-start'));
    expect(start).toHaveBeenCalledWith('right');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/health/ecg-result', params: { id: '9' } }));
  });

  it('starts on the wrist chosen last time', async () => {
    const start = jest.fn(async () => null);
    await render(withAppData(<EcgScreen />, 'en', { device: MG, ecgWrist: 'right', ecgActions: { ...fixtureEcgActions(), start } }));
    await fireEvent.press(screen.getByTestId('ecg-start'));
    expect(start).toHaveBeenCalledWith('right');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('cannot start on a band without the MG sensors', async () => {
    await render(withAppData(<EcgScreen />));
    expect(screen.getByTestId('needs-mg')).toBeTruthy();
    expect(screen.getByTestId('ecg-start').props.accessibilityState).toEqual({ disabled: true });
  });

  it('shows the countdown, samples, signal and a stop button while recording', async () => {
    const stop = jest.fn();
    await render(
      withAppData(<EcgScreen />, 'en', {
        device: MG,
        ecgActions: { ...fixtureEcgActions(), stop },
        ecgLive: { active: true, elapsedMs: 12_400, samples: 1500, tail: HEALTHY_TAIL, quality: 3 },
      }),
    );
    expect(screen.getByTestId('ecg-elapsed').props.children).toBe('Recording: 12 of 30 s');
    expect(screen.getByTestId('ecg-countdown-value').props.children).toContain('12');
    expect(screen.getByTestId('ecg-countdown-a11y').props.accessibilityLabel).toBe('Recording, 12 of 30 seconds');
    expect(screen.getByText('of 30 s')).toBeTruthy();
    expect(screen.getByTestId('ecg-samples-value').props.children).toContain('1500');
    expect(screen.getByTestId('ecg-signal-value').props.children).toContain('Good');
    expect(screen.getByText('contact')).toBeTruthy();
    expect(screen.queryByText(/bpm/)).toBeNull();
    await fireEvent.press(screen.getByTestId('ecg-stop'));
    expect(stop).toHaveBeenCalled();
  });

  it('says there is no contact when the band reports none', async () => {
    await render(withAppData(<EcgScreen />, 'en', { device: MG, ecgLive: { active: true, elapsedMs: 2_000, samples: 512, tail: HEALTHY_TAIL, quality: 0 } }));
    expect(screen.getByTestId('ecg-signal-value').props.children).toContain('No contact');
    expect(screen.getByText('touch the band')).toBeTruthy();
  });

  it('cancel stops the band and throws the recording away', async () => {
    let finish: (id: number | null) => void = () => undefined;
    const start = jest.fn(() => new Promise<number | null>((resolve) => (finish = resolve)));
    const stop = jest.fn();
    const remove = jest.fn(async () => true);
    const live = mutableLive(fixtureLiveData());
    const data = fixtureAppData('en', { device: MG, ecgActions: { ...fixtureEcgActions(), start, stop, remove } });
    await render(
      <LiveDataContext.Provider value={live.store}>
        <AppDataContext.Provider value={data}>
          <EcgScreen />
        </AppDataContext.Provider>
      </LiveDataContext.Provider>,
    );
    await fireEvent.press(screen.getByTestId('ecg-start'));
    await act(async () => live.set({ ecgLive: { active: true, elapsedMs: 4_000, samples: 400, tail: HEALTHY_TAIL, quality: 3 } }));
    await fireEvent.press(screen.getByTestId('ecg-cancel'));
    expect(stop).toHaveBeenCalled();
    await act(async () => {
      live.set({ ecgLive: { active: false, elapsedMs: 0, samples: 0, tail: [], quality: null } });
      finish(12);
    });
    await waitFor(() => expect(remove).toHaveBeenCalledWith(12));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('ECG result screen', () => {
  it('asks for a first recording when there is none', async () => {
    await render(withAppData(<EcgResultScreen />));
    expect(screen.getByTestId('ecg-none')).toBeTruthy();
  });

  it('draws the chosen recording in strips with the band heart rate and no verdict', async () => {
    mockParams = { id: '4' };
    const samples = jest.fn(async () => Array.from({ length: 3840 }, (_, i) => Math.round(Math.sin(i / 10) * 500)));
    const heartRateBetween = jest.fn(async () => [{ t: 1, hr: 60 }, { t: 2, hr: 64 }]);
    await render(
      withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [RECORDING, OLDER], ecgActions: { ...fixtureEcgActions(), samples }, heartRateBetween }),
    );
    await waitFor(() => expect(screen.getByTestId('ecg-strip-5')).toBeTruthy());
    expect(screen.queryByTestId('ecg-strip-6')).toBeNull();
    expect(screen.getByText('62 bpm average')).toBeTruthy();
    expect(screen.getByTestId('ecg-info')).toBeTruthy();
    expect(screen.getByTestId('ecg-hero-when').props.children).toContain('30 s');
    expect(heartRateBetween).toHaveBeenCalledWith(RECORDING.t, RECORDING.t + 30, 1);
    expect(screen.getByText('Left wrist')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ecg-item-2'));
    await waitFor(() => expect(screen.getByText('Right wrist')).toBeTruthy());
    expect(screen.queryByText(/normal|sinus|atrial|irregular/i)).toBeNull();
  });

  it('names wrist movement by its size', () => {
    expect(movementBand(0.0199)).toBe('still');
    expect(movementBand(0.02)).toBe('some');
    expect(movementBand(0.0799)).toBe('some');
    expect(movementBand(0.08)).toBe('lots');
  });

  it('waits for the next sync only while the last sync ended before the reading did', () => {
    expect(movementMissing(1_000, 30_000, null)).toBe('awaitingSync');
    expect(movementMissing(1_000, 30_000, 1_029)).toBe('awaitingSync');
    expect(movementMissing(1_000, 30_000, 1_030)).toBe('noData');
  });

  it('shows the wrist movement during the reading', async () => {
    mockParams = { id: '4' };
    await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [{ ...RECORDING, movementG: 0.01 }] }));
    expect(screen.getByTestId('ecg-movement-value').props.children).toBe('Still (0.01 g)');
  });

  it('says why a reading has no movement value', async () => {
    mockParams = { id: '4' };
    const base = fixtureAppData();
    const view = await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [RECORDING], device: { ...base.device, lastSyncAt: RECORDING.t - 10 } }));
    expect(screen.getByTestId('ecg-movement-value').props.children).toBe('After the next sync');
    await view.unmount();
    await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [RECORDING], device: { ...base.device, lastSyncAt: RECORDING.t + 3_600 } }));
    expect(screen.getByTestId('ecg-movement-value').props.children).toBe('No motion data for this reading');
  });

  it('puts a summary value under its label once it would wrap', async () => {
    mockParams = { id: '4' };
    await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [RECORDING] }));
    const direction = (id: string): ViewStyle['flexDirection'] => StyleSheet.flatten<ViewStyle>(screen.getByTestId(id).props.style)?.flexDirection;
    expect(direction('ecg-rate')).toBe('row');
    await fireEvent(screen.getByTestId('ecg-rate-value'), 'textLayout', { nativeEvent: { lines: [{ text: 'about 95,' }, { text: 'measured' }] } });
    expect(direction('ecg-rate')).toBeUndefined();
    expect(screen.getByTestId('ecg-rate-value')).toBeTruthy();
    expect(direction('ecg-length')).toBe('row');
  });

  it('stores how the wearer felt with the recording, with none on its own', async () => {
    const setSymptoms = jest.fn(async () => true);
    await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [{ ...RECORDING, symptoms: ['none'] }], ecgActions: { ...fixtureEcgActions(), setSymptoms } }));
    expect(screen.getByTestId('ecg-feel-none').props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByTestId('ecg-feel-palpitations'));
    expect(setSymptoms).toHaveBeenLastCalledWith(4, ['palpitations']);
    await fireEvent.press(screen.getByTestId('ecg-feel-dizzy'));
    expect(setSymptoms).toHaveBeenLastCalledWith(4, ['palpitations', 'dizzy']);
    await fireEvent.press(screen.getByTestId('ecg-feel-none'));
    expect(setSymptoms).toHaveBeenLastCalledWith(4, ['none']);
  });

  it('takes a tag back off when storing it fails', async () => {
    const setSymptoms = jest.fn(async () => false);
    await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [RECORDING], ecgActions: { ...fixtureEcgActions(), setSymptoms } }));
    await fireEvent.press(screen.getByTestId('ecg-feel-dizzy'));
    await waitFor(() => expect(screen.getByTestId('ecg-feel-dizzy').props.accessibilityState).toMatchObject({ checked: false }));
    expect(setSymptoms).toHaveBeenCalledWith(4, ['dizzy']);
  });

  it('exports the trace as a PDF and the raw samples as CSV', async () => {
    const samples = jest.fn(async () => Array.from({ length: 1280 }, (_, i) => (i % 128 === 40 ? 900 : 0)));
    await render(withAppData(<EcgResultScreen />, 'en', { ecgRecordings: [{ ...RECORDING, symptoms: ['dizzy'] }], ecgActions: { ...fixtureEcgActions(), samples } }));
    await waitFor(() => expect(screen.getByTestId('ecg-strip-0')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('ecg-export-pdf'));
    await waitFor(() => expect(shareReportPdf).toHaveBeenCalledTimes(1));
    const html = jest.mocked(shareReportPdf).mock.calls[0]?.[0] ?? '';
    expect(html).toContain('OpenHoop ECG recording');
    expect(html).toContain('Dizzy');
    expect(html).not.toMatch(/sinus|atrial|fibrillation|normal rhythm/i);
    await fireEvent.press(screen.getByTestId('ecg-share'));
    await waitFor(() => expect(shareEcgCsv).toHaveBeenCalledTimes(1));
  });
});

describe('ECG helpers', () => {
  it('splits into strips of five seconds, or evenly without a rate', () => {
    const samples = Array.from({ length: 1300 }, (_, i) => i);
    expect(ecgStrips(samples, 128, 10_000).map((s) => s.length)).toEqual([640, 640, 20]);
    expect(ecgStrips(samples, null, 10_000).map((s) => s.length)).toEqual([650, 650]);
    expect(ecgStrips([], 128, 0)).toEqual([]);
  });

  it('takes one amplitude range for all strips and ignores the extreme tails', () => {
    const samples = [-30000, ...Array.from({ length: 198 }, (_, i) => (i % 2 === 0 ? -100 : 100)), 30000];
    expect(traceRange(samples)).toEqual({ low: -100, high: 100 });
    expect(traceRange([5, 5, 5])).toEqual({ low: 4, high: 6 });
    expect(traceRange([])).toBeNull();
    expect(stripLength(1300, 128, 10_000)).toBe(640);
  });

  it('keeps the peaks when it reduces samples to columns', () => {
    expect(traceColumns([0, 9, 0, -9, 0, 0], 2)).toEqual([
      { min: 0, max: 9 },
      { min: -9, max: 0 },
    ]);
    expect(traceColumns([3], 10)).toEqual([{ min: 3, max: 3 }]);
  });

  it('reads contact from the band flag and the shape of the trace', () => {
    let seed = 7;
    const noise = Array.from({ length: 512 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed % 2001) - 1000;
    });
    const flat = Array.from({ length: 512 }, () => 12);
    const clipped = HEALTHY_TAIL.map((v, i) => (i % 20 === 0 ? 32767 : v));
    expect(ecgContact(HEALTHY_TAIL.slice(0, ECG_CONTACT.minSamples - 1), null)).toBe('checking');
    expect(ecgContact(HEALTHY_TAIL, 0)).toBe('none');
    expect(ecgContact(HEALTHY_TAIL, null)).toBe('good');
    expect(ecgContact(HEALTHY_TAIL, 3)).toBe('good');
    expect(ecgContact(HEALTHY_TAIL, 1)).toBe('weak');
    expect(ecgContact(flat, 3)).toBe('none');
    expect(ecgContact(noise, 3)).toBe('weak');
    expect(ecgContact(clipped, 3)).toBe('weak');
  });

  it('keeps none apart from the symptoms that were felt', () => {
    expect(toggleEcgSymptom([], 'dizzy')).toEqual(['dizzy']);
    expect(toggleEcgSymptom(['none'], 'dizzy')).toEqual(['dizzy']);
    expect(toggleEcgSymptom(['dizzy', 'chestPain'], 'none')).toEqual(['none']);
    expect(toggleEcgSymptom(['dizzy', 'chestPain'], 'dizzy')).toEqual(['chestPain']);
  });

  it('builds a PDF page with every strip and escaped text', () => {
    const html = ecgReportHtml({
      title: 'ECG <test>',
      rows: [{ label: 'Wrist', value: 'Left & right' }],
      stripsTitle: 'Strips',
      samples: Array.from({ length: 1300 }, (_, i) => i % 50),
      rateHz: 128,
      durationMs: 10_000,
      notes: ['Not a diagnosis'],
      language: 'en',
    });
    expect(html).toContain('ECG &lt;test&gt;');
    expect(html).toContain('Left &amp; right');
    expect(html.match(/class="strip"/g)?.length).toBe(3);
    expect(html).toContain('Not a diagnosis');
  });

  it('writes index, time and value per sample', () => {
    expect(ecgCsv(RECORDING, [10, -20])).toBe('index,t_ms,value\r\n0,0,10\r\n1,8,-20\r\n');
    expect(ecgCsv({ ...RECORDING, rateHz: null }, [1])).toBe('index,t_ms,value\r\n0,,1\r\n');
  });
});

describe('screens OpenHoop does not offer', () => {
  it.each([
    ['irregular rhythm', IrregularRhythmScreen],
    ['blood pressure', BloodPressureScreen],
  ])('%s says it is not part of OpenHoop', async (_name, Screen) => {
    await render(withAppData(<Screen />));
    expect(screen.getByTestId('not-offered')).toBeTruthy();
    expect(screen.queryByTestId('not-built-mg')).toBeNull();
  });
});
