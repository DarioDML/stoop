import type { StrengthData, StrengthSession, StrengthSet, StrengthTemplate } from '@openhoop/core';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react-native';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { defaultCoachPrefs } from '@/coach/prefs';
import { AppDataContext } from '@/data/context';
import { createFixtureDays, createFixtureSettings } from '@/data/fixtureSource';
import { defaultUserData } from '@/data/userData';
import { defaultPlan } from '@/data/weeklyPlan';
import type { HeartRatePoint, StrengthActions } from '@/data/types';
import { defaultNetworkPrefs } from '@/net/features';
import type { GatedFetch } from '@/net/gate';
import { WeekCard } from '@/ui/daily/cards';
import { useSessionHeartRate } from '@/ui/strength/useSessionHeartRate';

import { FIXTURE_NOW, fixtureAppData, fixtureBandActions, fixtureMotionActions, fixtureStrengthActions, withAppData, type AppDataOverrides } from './support/appData';
import { TEST_KEY, jsonResponse, makeController, messageBody, withCoach } from './support/coach';

let mockParams: Record<string, string | string[] | undefined> = {};
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (href: unknown) => mockPush(href), back: jest.fn(), replace: (href: unknown) => mockReplace(href), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  Link: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockLoadKey = jest.fn<Promise<string | null>, []>(async () => TEST_KEY);
const mockNetFetch = jest.fn<Promise<Response>, Parameters<GatedFetch>>(async () => new Response('{}', { status: 500 }));

jest.mock('@/coach/keyStore', () => ({
  secureKeyStore: { load: () => mockLoadKey(), save: async () => true, remove: async () => undefined },
  cleanApiKey: (text: string) => text,
}));

jest.mock('@/net', () => ({
  netFetch: (...args: Parameters<GatedFetch>) => mockNetFetch(...args),
}));

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;
    constructor(...parts: Array<string | MockDirectory>) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists(): boolean {
      return false;
    }
    create(): void {}
    delete(): void {}
  }
  class MockFile {
    uri: string;
    constructor(folder: MockDirectory, name: string) {
      this.uri = `${folder.uri}/${name}`;
    }
    async write(): Promise<void> {
      await Promise.resolve();
    }
  }
  return { Directory: MockDirectory, File: MockFile, Paths: { cache: new MockDirectory('cache') } };
});

import StrengthBuilderScreen from '@/app/strength/builder';
import StrengthExerciseScreen from '@/app/strength/exercise';
import StrengthHomeScreen from '@/app/strength/index';
import StrengthLiveScreen from '@/app/strength/live';
import StrengthSummaryScreen from '@/app/strength/summary';
import StrengthTrendsScreen from '@/app/strength/trends';

const NOW_S = Math.floor(FIXTURE_NOW.getTime() / 1000);
let nextId = 1;

function set(session: number, key: string, name: string, muscle: StrengthSet['muscle'], reps: number, weightKg: number, rpe: number | null = null): StrengthSet {
  return { id: nextId++, sessionId: session, exerciseKey: key, exerciseName: name, muscle, reps, weightKg, rpe, doneAt: NOW_S };
}

function finished(id: number, day: string, startedAt: number, sets: StrengthSet[], name = `Push ${id}`): StrengthSession {
  return { id, templateId: null, name, day, startedAt, endedAt: startedAt + 3_000, exercises: [], sets };
}

const DAY_1 = finished(1, '2026-11-18', NOW_S - 7 * 86_400, [
  set(1, 'lib:bench_press', 'Bench press', 'chest', 5, 80),
  set(1, 'lib:bench_press', 'Bench press', 'chest', 5, 80),
]);
const DAY_2 = finished(2, '2026-11-24', NOW_S - 86_400, [
  set(2, 'lib:bench_press', 'Bench press', 'chest', 5, 85),
  set(2, 'lib:bench_press', 'Bench press', 'chest', 3, 90),
  set(2, 'lib:back_squat', 'Back squat', 'quads', 5, 100),
  set(2, 'lib:crunch', 'Crunch', 'core', 15, 0),
]);

const TEMPLATE: StrengthTemplate = {
  id: 7,
  name: 'Push day',
  createdAt: 1,
  updatedAt: 2,
  items: [{ exerciseKey: 'lib:bench_press', exerciseName: 'Bench press', muscle: 'chest', sets: 3, reps: 8, weightKg: 60 }],
};

function data(overrides: Partial<StrengthData> = {}): StrengthData {
  return { customExercises: [], templates: [], sessions: [], ...overrides };
}

function actions(overrides: Partial<StrengthActions> = {}): StrengthActions {
  return { ...fixtureStrengthActions(), ...overrides };
}

function app(strength: StrengthData, strengthActions: StrengthActions, extra: AppDataOverrides = {}): AppDataOverrides {
  return { strength, strengthActions, ...extra };
}

function steadyHeartRate(fromS: number, toS: number, hr = 150): HeartRatePoint[] {
  return Array.from({ length: Math.max(0, toS - fromS) }, (_, i) => ({ t: fromS + i, hr }));
}

beforeEach(() => {
  mockParams = {};
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNetFetch.mockClear();
  mockLoadKey.mockClear();
  jest.spyOn(Date, 'now').mockReturnValue(FIXTURE_NOW.getTime());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('strength home', () => {
  it('shows honest empty states with no invented numbers', async () => {
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data(), actions())));
    expect(screen.getByTestId('strength-templates-empty')).toBeTruthy();
    expect(screen.getByTestId('strength-recent-empty')).toBeTruthy();
    expect(screen.getByTestId('strength-exercises-empty')).toBeTruthy();
    expect(within(screen.getByTestId('strength-week-count')).getByText(/0/)).toBeTruthy();
  });

  it('lists templates and sessions and counts the sessions of this week', async () => {
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ templates: [TEMPLATE], sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByText('Push day')).toBeTruthy();
    expect(within(screen.getByTestId('strength-week-count')).getByText(/1/)).toBeTruthy();
    expect(screen.getByTestId('session-2')).toBeTruthy();
    expect(screen.getAllByText(/4 sets · 1195 kg/).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('session-2'));
  });

  it('starts an empty workout and opens the live screen', async () => {
    const startSession = jest.fn(async () => 5);
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data(), actions({ startSession }))));
    await fireEvent.press(screen.getByTestId('strength-start-empty'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/strength/live'));
    expect(startSession).toHaveBeenCalledWith(null, 'Workout', []);
  });

  it('starts a template with its exercises', async () => {
    const startSession = jest.fn(async () => 5);
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ templates: [TEMPLATE] }), actions({ startSession }))));
    await fireEvent.press(screen.getByTestId('template-start-7'));
    await waitFor(() => expect(startSession).toHaveBeenCalledWith(7, 'Push day', TEMPLATE.items));
  });

  it('offers to resume a running workout instead of starting another', async () => {
    const running: StrengthSession = { ...DAY_1, id: 9, endedAt: null, name: 'Legs' };
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ templates: [TEMPLATE], sessions: [running] }), actions())));
    expect(screen.getByTestId('strength-active')).toBeTruthy();
    expect(screen.queryByTestId('strength-start-empty')).toBeNull();
    await fireEvent.press(screen.getByTestId('strength-resume'));
    expect(mockPush).toHaveBeenCalledWith('/strength/live');
  });

  it('exports the data through the existing export', async () => {
    const exportData = jest.fn(async () => undefined);
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data(), actions(), { exportData })));
    await fireEvent.press(screen.getByTestId('strength-export'));
    expect(exportData).toHaveBeenCalled();
  });

  it('is available in Dutch', async () => {
    await render(withAppData(<StrengthHomeScreen />, 'nl', app(data(), actions())));
    expect(screen.getByText('Sessies deze week')).toBeTruthy();
  });

  it('opens a saved workout for editing and shows its usual length', async () => {
    const done: StrengthSession = { ...DAY_1, templateId: 7 };
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ templates: [TEMPLATE], sessions: [done] }), actions())));
    expect(within(screen.getByTestId('template-edit-7')).getByText(/~50 min/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('template-edit-7'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/strength/builder', params: { id: '7' } });
  });

  it('opens the builder with the coach from the Build with coach card', async () => {
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data(), actions())));
    await fireEvent.press(screen.getByTestId('strength-coach-card'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/strength/builder', params: { coach: '1' } });
  });

  it('adds a preset as the person’s own templates', async () => {
    const saveTemplate = jest.fn(async () => 1);
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ templates: [{ ...TEMPLATE, name: 'Upper body' }] }), actions({ saveTemplate }))));
    await fireEvent.press(screen.getByTestId('preset-upperLower'));
    await waitFor(() => expect(screen.getByTestId('strength-preset-notice')).toHaveTextContent('Added: Lower body. Set the weights before you start. Already saved: Upper body.'));
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(saveTemplate).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ name: 'Lower body', items: expect.arrayContaining([expect.objectContaining({ exerciseKey: 'lib:back_squat', exerciseName: 'Back squat', weightKg: 0 })]) }),
    );
  });

  it('does not copy a preset that is already saved', async () => {
    const saveTemplate = jest.fn(async () => 1);
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ templates: [{ ...TEMPLATE, name: 'Full body' }] }), actions({ saveTemplate }))));
    await fireEvent.press(screen.getByTestId('preset-fullBody'));
    await waitFor(() => expect(screen.getByTestId('strength-preset-notice')).toHaveTextContent(/Already in your saved workouts: Full body\./));
    expect(saveTemplate).not.toHaveBeenCalled();
  });

  it('says so when a preset could not be saved', async () => {
    const saveTemplate = jest.fn(async () => null);
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data(), actions({ saveTemplate }))));
    await fireEvent.press(screen.getByTestId('preset-kettlebell'));
    await waitFor(() => expect(screen.getByTestId('strength-preset-notice')).toHaveTextContent(/could not be added/));
  });

  it('shows the Load of a recent session from its heart rate, or why there is none', async () => {
    const heartRateBetween = jest.fn(async (fromS: number, toS: number) => (fromS === DAY_2.startedAt ? steadyHeartRate(fromS, toS) : []));
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions(), { heartRateBetween })));
    await waitFor(() => expect(within(screen.getByTestId('session-2')).getByText(/Load \d+\.\d/)).toBeTruthy());
    expect(within(screen.getByTestId('session-1')).getByText(/no Load: no heart rate recorded/)).toBeTruthy();
    expect(heartRateBetween).toHaveBeenCalledWith(DAY_2.startedAt, DAY_2.endedAt, 1);
  });

  it('queries each session’s heart rate once and only the newly shown ones after See all', async () => {
    const many = Array.from({ length: 7 }, (_, i) => finished(40 + i, '2026-11-20', NOW_S - (i + 2) * 86_400, [set(40 + i, 'lib:crunch', 'Crunch', 'core', 10, 0)]));
    const heartRateBetween = jest.fn(async (): Promise<HeartRatePoint[]> => []);
    const view = await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ sessions: many }), actions(), { heartRateBetween })));
    await waitFor(() => expect(within(screen.getByTestId('session-46')).getByText(/no Load/)).toBeTruthy());
    expect(heartRateBetween).toHaveBeenCalledTimes(5);
    await view.rerender(withAppData(<StrengthHomeScreen />, 'en', app(data({ sessions: many }), actions(), { heartRateBetween })));
    await fireEvent.press(screen.getByTestId('strength-show-all'));
    await waitFor(() => expect(within(screen.getByTestId('session-40')).getByText(/no Load/)).toBeTruthy());
    expect(heartRateBetween).toHaveBeenCalledTimes(7);
  });

  it('lists every session after See all', async () => {
    const many = Array.from({ length: 7 }, (_, i) => finished(20 + i, '2026-11-20', NOW_S - (i + 2) * 86_400, [set(20 + i, 'lib:crunch', 'Crunch', 'core', 10, 0)]));
    await render(withAppData(<StrengthHomeScreen />, 'en', app(data({ sessions: many }), actions())));
    expect(screen.queryByTestId('session-20')).toBeNull();
    await fireEvent.press(screen.getByTestId('strength-show-all'));
    expect(screen.getByTestId('session-20')).toBeTruthy();
  });
});

describe('workout builder', () => {
  it('asks for a name, an exercise and valid targets before saving', async () => {
    const saveTemplate = jest.fn(async () => 1);
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data(), actions({ saveTemplate }))));
    await fireEvent.press(screen.getByTestId('builder-save'));
    expect(screen.getByTestId('builder-error')).toHaveTextContent(/name of 1 to 60/);
    await fireEvent.changeText(screen.getByTestId('builder-name'), 'Leg day');
    await fireEvent.press(screen.getByTestId('builder-save'));
    expect(screen.getByTestId('builder-error')).toHaveTextContent(/at least one exercise/);

    await fireEvent.press(screen.getByTestId('builder-add'));
    await fireEvent.press(screen.getByTestId('pick-lib:back_squat'));
    await fireEvent.changeText(screen.getByTestId('builder-sets-0'), '0');
    await fireEvent.changeText(screen.getByTestId('builder-reps-0'), '101');
    await fireEvent.changeText(screen.getByTestId('builder-weight-0'), '-3');
    await fireEvent.press(screen.getByTestId('builder-save'));
    expect(screen.getByTestId('builder-error')).toHaveTextContent(/Check the highlighted numbers/);
    expect(saveTemplate).not.toHaveBeenCalled();
  });

  it('saves a template with parsed numbers in the chosen order', async () => {
    const saveTemplate = jest.fn(async () => 1);
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data(), actions({ saveTemplate }))));
    await fireEvent.changeText(screen.getByTestId('builder-name'), '  Leg   day ');
    await fireEvent.press(screen.getByTestId('builder-add'));
    await fireEvent.press(screen.getByTestId('pick-lib:back_squat'));
    await fireEvent.press(screen.getByTestId('builder-add'));
    await fireEvent.press(screen.getByTestId('pick-lib:leg_curl'));
    await fireEvent.changeText(screen.getByTestId('builder-sets-0'), '4');
    await fireEvent.changeText(screen.getByTestId('builder-reps-0'), '6');
    await fireEvent.changeText(screen.getByTestId('builder-weight-0'), '102,5');
    expect(screen.getByTestId('builder-summary-0')).toHaveTextContent('4 × 6 · 102.5 kg');
    await fireEvent.press(screen.getByText('Reorder'));
    await fireEvent.press(screen.getByTestId('builder-up-1'));
    await fireEvent.press(screen.getByTestId('builder-save'));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledTimes(1));
    expect(saveTemplate).toHaveBeenCalledWith(null, {
      name: 'Leg day',
      items: [
        { exerciseKey: 'lib:leg_curl', exerciseName: 'Leg curl', muscle: 'hamstrings', sets: 3, reps: 8, weightKg: 0 },
        { exerciseKey: 'lib:back_squat', exerciseName: 'Back squat', muscle: 'quads', sets: 4, reps: 6, weightKg: 102.5 },
      ],
    });
  });

  it('edits and deletes an existing template', async () => {
    mockParams = { id: '7' };
    const saveTemplate = jest.fn(async () => 7);
    const removeTemplate = jest.fn(async () => true);
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data({ templates: [TEMPLATE] }), actions({ saveTemplate, removeTemplate }))));
    expect(screen.getByTestId('builder-name').props.value).toBe('Push day');
    expect(screen.getByTestId('builder-summary-0')).toHaveTextContent('3 × 8 · 60 kg');
    expect(screen.queryByTestId('builder-weight-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('builder-edit-0'));
    expect(screen.getByTestId('builder-weight-0').props.value).toBe('60');
    await fireEvent.changeText(screen.getByTestId('builder-weight-0'), '62.5');
    await fireEvent.press(screen.getByTestId('builder-save'));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(7, { name: 'Push day', items: [{ ...TEMPLATE.items[0], weightKg: 62.5 }] }));
    await fireEvent.press(screen.getByTestId('builder-delete'));
    await fireEvent.press(screen.getByTestId('builder-confirm-delete'));
    await waitFor(() => expect(removeTemplate).toHaveBeenCalledWith(7));
  });

  it('creates a custom exercise and refuses a duplicate name', async () => {
    const saveExercise = jest.fn(async () => true);
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data(), actions({ saveExercise }))));
    await fireEvent.press(screen.getByTestId('builder-add'));
    await fireEvent.changeText(screen.getByTestId('picker-name'), 'bench PRESS');
    await fireEvent.press(screen.getByTestId('picker-create'));
    expect(screen.getByText('An exercise with that name exists already.')).toBeTruthy();
    expect(saveExercise).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('picker-name'), 'Sled push');
    await fireEvent.press(screen.getByTestId('picker-muscle-quads'));
    await fireEvent.press(screen.getByTestId('picker-create'));
    await waitFor(() => expect(saveExercise).toHaveBeenCalledWith({ name: 'Sled push', muscle: 'quads' }));
  });

  it('does not offer save-and-start while a workout is running', async () => {
    const running: StrengthSession = { ...DAY_1, id: 9, endedAt: null };
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data({ sessions: [running] }), actions())));
    expect(screen.getByTestId('builder-save-start').props.accessibilityState.disabled).toBe(true);
  });

  it('saves once when the save button is tapped twice', async () => {
    mockParams = { id: '7' };
    let release: (id: number) => void = () => undefined;
    const saveTemplate = jest.fn(() => new Promise<number | null>((resolve) => (release = resolve)));
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data({ templates: [TEMPLATE] }), actions({ saveTemplate }))));
    await fireEvent.press(screen.getByTestId('builder-save-icon'));
    await fireEvent.press(screen.getByTestId('builder-save-icon'));
    await fireEvent.press(screen.getByTestId('builder-save'));
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('builder-save-icon').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      release(7);
    });
    expect(saveTemplate).toHaveBeenCalledWith(7, { name: 'Push day', items: TEMPLATE.items });
  });

  it('says so when the template no longer exists', async () => {
    mockParams = { id: '99' };
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data(), actions())));
    expect(screen.getByTestId('builder-missing')).toBeTruthy();
  });

  it('shows and stores weights in pounds when the person uses imperial units', async () => {
    mockParams = { id: '7' };
    const saveTemplate = jest.fn(async () => 7);
    const settings = { ...createFixtureSettings('en', FIXTURE_NOW), units: 'imperial' as const };
    const heavy: StrengthTemplate = { ...TEMPLATE, items: TEMPLATE.items.map((item) => ({ ...item, weightKg: 102.058 })) };
    await render(withAppData(<StrengthBuilderScreen />, 'en', app(data({ templates: [heavy] }), actions({ saveTemplate }), { settings })));
    expect(screen.getByTestId('builder-summary-0')).toHaveTextContent('3 × 8 · 225 lb');
    await fireEvent.press(screen.getByTestId('builder-edit-0'));
    await fireEvent.changeText(screen.getByTestId('builder-weight-0'), '135');
    await fireEvent.press(screen.getByTestId('builder-save'));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(7, { name: 'Push day', items: TEMPLATE.items.map((item) => ({ ...item, weightKg: 61.235 })) }));
  });
});

describe('workout builder with the coach', () => {
  const network = { ...defaultNetworkPrefs(), enabled: true, features: { ...defaultNetworkPrefs().features, coach: true } };
  const withNetwork = (on: boolean): AppDataOverrides => ({ userData: { ...defaultUserData(), onboardingDone: true, network: on ? network : defaultNetworkPrefs() } });
  const coachReply = (body: object): Response => jsonResponse(200, messageBody(JSON.stringify(body)));

  it('asks for a coach key when none is set', async () => {
    const { controller } = makeController({ key: null });
    await controller.load();
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data(), actions()), ...withNetwork(true) }));
    expect(screen.getByTestId('builder-coach-off')).toHaveTextContent(/Add your own Anthropic API key/);
    await fireEvent.press(screen.getByTestId('builder-coach-settings'));
    expect(mockPush).toHaveBeenCalledWith('/coach/settings');
    expect(screen.queryByTestId('builder-describe')).toBeNull();
  });

  it('says so when network access for the coach is off', async () => {
    const { controller } = makeController();
    await controller.load();
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data(), actions()), ...withNetwork(false) }));
    expect(screen.getByTestId('builder-coach-off')).toHaveTextContent(/Network access for the coach is off/);
  });

  it('hides the builder while the coach is switched off', async () => {
    const { controller } = makeController();
    await controller.load();
    const userData = { ...defaultUserData(), onboardingDone: true, network, coach: { ...defaultCoachPrefs(), enabled: false } };
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data(), actions()), userData }));
    expect(screen.getByTestId('builder-coach-off')).toHaveTextContent(/Switch it on in Coach settings/);
    expect(screen.queryByTestId('builder-describe')).toBeNull();
  });

  it('fills the editor from a description and never saves on its own', async () => {
    const saveTemplate = jest.fn(async () => 1);
    mockNetFetch.mockImplementation(async () =>
      coachReply({
        name: 'Push A',
        exercises: [
          { exercise: 'lib:bench_press', sets: 4, reps: 8, weightKg: 70 },
          { exercise: 'lib:overhead_press', sets: 3, reps: 8, weightKg: 40 },
          { exercise: 'lib:unknown', sets: 3, reps: 8, weightKg: 0 },
        ],
      }),
    );
    const { controller } = makeController();
    await controller.load();
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data({ sessions: [DAY_2] }), actions({ saveTemplate })), ...withNetwork(true) }));
    await fireEvent.changeText(screen.getByTestId('builder-describe'), '45 min push, shoulder-friendly');
    await fireEvent.press(screen.getByTestId('builder-describe-send'));
    await waitFor(() => expect(screen.getByTestId('builder-summary-1')).toHaveTextContent('3 × 8 · 40 kg'));
    expect(screen.getByTestId('builder-summary-0')).toHaveTextContent('4 × 8 · 70 kg');
    expect(screen.getByTestId('builder-name').props.value).toBe('Push A');
    expect(screen.getByTestId('builder-coach-status')).toHaveTextContent(/Exercises filled in by the coach: 2.*left out.*: 1\./);
    expect(saveTemplate).not.toHaveBeenCalled();
    const [feature, , init] = mockNetFetch.mock.calls[0] ?? [];
    expect(feature).toBe('coach');
    expect(String(init?.body)).toContain('45 min push, shoulder-friendly');
    expect(String(init?.body)).toContain('lib:bench_press: 90 kg × 3 on 2026-11-24');
    await fireEvent.press(screen.getByTestId('builder-save'));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(null, expect.objectContaining({ name: 'Push A' })));
  });

  it('undoes the coach’s changes', async () => {
    mockNetFetch.mockImplementation(async () => coachReply({ name: 'Legs', exercises: [{ exercise: 'lib:back_squat', sets: 5, reps: 5, weightKg: 100 }] }));
    mockParams = { id: '7' };
    const { controller } = makeController();
    await controller.load();
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data({ templates: [TEMPLATE] }), actions()), ...withNetwork(true) }));
    await fireEvent.changeText(screen.getByTestId('builder-describe'), 'legs please');
    await fireEvent.press(screen.getByTestId('builder-describe-send'));
    await waitFor(() => expect(screen.getByTestId('builder-summary-0')).toHaveTextContent('5 × 5 · 100 kg'));
    expect(screen.getByTestId('builder-name').props.value).toBe('Push day');
    await fireEvent.press(screen.getByTestId('builder-coach-undo'));
    expect(screen.getByTestId('builder-summary-0')).toHaveTextContent('3 × 8 · 60 kg');
  });

  it('shows the coach error and keeps the editor as it was', async () => {
    mockNetFetch.mockImplementation(async () => jsonResponse(401, {}));
    const { controller } = makeController();
    await controller.load();
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data(), actions()), ...withNetwork(true) }));
    await fireEvent.press(screen.getByTestId('builder-describe-send'));
    expect(screen.getByTestId('builder-coach-status')).toHaveTextContent(/3 to 300 characters/);
    expect(mockNetFetch).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('builder-describe'), 'full body');
    await fireEvent.press(screen.getByTestId('builder-describe-send'));
    await waitFor(() => expect(screen.getByTestId('builder-coach-status')).toHaveTextContent(/did not accept the API key/));
    expect(screen.getByTestId('builder-items-empty')).toBeTruthy();
  });

  it('reports a reply it cannot read', async () => {
    mockNetFetch.mockImplementation(async () => jsonResponse(200, messageBody('not json')));
    const { controller } = makeController();
    await controller.load();
    await render(withCoach(<StrengthBuilderScreen />, controller, { ...app(data(), actions()), ...withNetwork(true) }));
    await fireEvent.changeText(screen.getByTestId('builder-describe'), 'full body');
    await fireEvent.press(screen.getByTestId('builder-describe-send'));
    await waitFor(() => expect(screen.getByTestId('builder-coach-status')).toHaveTextContent(/could not be turned into exercises/));
  });
});

describe('motion during a session', () => {
  const benchSet: StrengthSet = { id: 901, sessionId: 4, exerciseKey: 'lib:bench_press', exerciseName: 'Bench press', muscle: 'chest', reps: 8, weightKg: 60, rpe: null, doneAt: NOW_S - 60 };
  const running: StrengthSession = {
    id: 4,
    templateId: 7,
    name: 'Push day',
    day: '2026-11-25',
    startedAt: NOW_S - 300,
    endedAt: null,
    exercises: [{ id: 12, sessionId: 4, position: 0, exerciseKey: 'lib:bench_press', exerciseName: 'Bench press', muscle: 'chest', sets: 3, reps: 8, weightKg: 60 }],
    sets: [benchSet],
  };
  const readable = { status: 'readable' as const, repsDetected: 8, tutS: 21, tempoS: 2.6, velocityLoss: 0.1, factor: 1.08 };
  const motionOn = (sets: Record<number, typeof readable | { status: 'unreadable' | 'unmatched' | 'none'; repsDetected: null; tutS: null; tempoS: null; velocityLoss: null; factor: number }>) => ({
    highRate: true,
    bandRecording: false,
    sets,
  });

  it('shows what the band measured under a logged set', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { motion: motionOn({ 901: readable }) })));
    expect(screen.getByText('Band: 8 reps · 21 s under tension · 2.6 s per rep')).toBeTruthy();
  });

  it('says when motion could not be read or matched', async () => {
    const unreadable = { status: 'unreadable' as const, repsDetected: null, tutS: null, tempoS: null, velocityLoss: null, factor: 1 };
    const view = await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { motion: motionOn({ 901: unreadable }) })));
    expect(screen.getByText('Motion not readable for this exercise')).toBeTruthy();
    await view.unmount();
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { motion: motionOn({ 901: { ...unreadable, status: 'unmatched' } }) })));
    expect(screen.getByText('Motion recorded, but it could not be matched to your sets')).toBeTruthy();
  });

  it('offers the band-counted reps for the set in progress without overwriting them', async () => {
    const motionActions = { ...fixtureMotionActions(), liveReps: jest.fn(async () => 7) };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { motion: motionOn({}), motionActions })));
    expect(screen.getByTestId('live-reps-lib:bench_press').props.value).toBe('8');
    const chip = await screen.findByText('Band counted 7 · Use');
    expect(screen.getByTestId('live-reps-lib:bench_press').props.value).toBe('8');
    await fireEvent.press(chip);
    expect(screen.getByTestId('live-reps-lib:bench_press').props.value).toBe('7');
    expect(screen.queryByText('Band counted 7 · Use')).toBeNull();
  });

  it('does not read band reps while the app is in the background', async () => {
    const motionActions = { ...fixtureMotionActions(), liveReps: jest.fn(async () => 7) };
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    try {
      await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { motion: motionOn({}), motionActions })));
      await act(async () => {
        await Promise.resolve();
      });
      expect(motionActions.liveReps).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) Object.defineProperty(AppState, 'currentState', original);
    }
  });

  it('records on the band only when asked, and says what it costs', async () => {
    const motionActions = { ...fixtureMotionActions(), setBandRecording: jest.fn(async () => true) };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { motion: motionOn({}), motionActions })));
    expect(screen.getByText(/adds about 13 minutes to the next sync per hour/)).toBeTruthy();
    await fireEvent(screen.getByTestId('live-band-recording'), 'valueChange', true);
    expect(motionActions.setBandRecording).toHaveBeenCalledWith(true);
  });

  it('shows no motion card while high-rate motion is off', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions())));
    expect(screen.queryByTestId('live-motion')).toBeNull();
  });

  it('marks the muscle rows that had motion and keeps plain volume until the factor is switched on', async () => {
    const done: StrengthSession = { ...running, endedAt: NOW_S, sets: [benchSet] };
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [done] }), actions(), { motion: motionOn({ 901: readable }) })));
    expect(screen.getByText('1 of 1 sets with motion')).toBeTruthy();
    expect(within(screen.getByTestId('summary-load-rows')).getByText(/480/)).toBeTruthy();
    expect(screen.getByText(/weighted by rep tempo/)).toBeTruthy();
  });
});

describe('live session', () => {
  const running: StrengthSession = {
    id: 3,
    templateId: 7,
    name: 'Push day',
    day: '2026-11-25',
    startedAt: NOW_S - 125,
    endedAt: null,
    exercises: [{ id: 11, sessionId: 3, position: 0, exerciseKey: 'lib:bench_press', exerciseName: 'Bench press', muscle: 'chest', sets: 3, reps: 8, weightKg: 60 }],
    sets: [],
  };

  it('shows a calm state without a running workout', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data(), actions())));
    expect(screen.getByTestId('live-none')).toBeTruthy();
  });

  it('works without a band: no heart rate invented, offer to show it', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions())));
    expect(within(screen.getByTestId('live-hr')).getByText(/–/)).toBeTruthy();
    expect(screen.getByTestId('live-hr-off')).toBeTruthy();
    expect(within(screen.getByTestId('live-elapsed')).getByText(/2:05/)).toBeTruthy();
  });

  it('shows the live heart rate when the live path is active', async () => {
    const live = { active: true, heartRate: 128, lastRrMs: 470, updatedAt: 1 };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { live })));
    expect(within(screen.getByTestId('live-hr')).getByText(/128/)).toBeTruthy();
    expect(screen.queryByTestId('live-hr-off')).toBeNull();
  });

  it('starts the live heart rate on request', async () => {
    const startLive = jest.fn(async () => undefined);
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { startLive })));
    await fireEvent.press(screen.getByTestId('live-hr-start'));
    expect(startLive).toHaveBeenCalled();
  });

  it('prefills the plan, rejects bad numbers and logs a valid set', async () => {
    const logSet = jest.fn(async () => true);
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions({ logSet }))));
    expect(screen.getByTestId('live-reps-lib:bench_press').props.value).toBe('8');
    expect(screen.getByTestId('live-weight-lib:bench_press').props.value).toBe('60');
    await fireEvent.changeText(screen.getByTestId('live-reps-lib:bench_press'), '0');
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    expect(logSet).not.toHaveBeenCalled();
    expect(screen.getByText('Check the highlighted numbers.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('live-reps-lib:bench_press'), '7');
    await fireEvent.changeText(screen.getByTestId('live-rpe-lib:bench_press'), '12');
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    expect(logSet).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('live-rpe-lib:bench_press'), '8.5');
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await waitFor(() =>
      expect(logSet).toHaveBeenCalledWith(3, { exerciseKey: 'lib:bench_press', exerciseName: 'Bench press', muscle: 'chest', reps: 7, weightKg: 60, rpe: 8.5 }),
    );
  });

  it('starts the rest timer after a logged set and lets you skip it', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions())));
    expect(screen.getByTestId('live-rest-state')).toHaveTextContent(/Starts after each logged set/);
    await fireEvent.press(screen.getByTestId('live-rest-120'));
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await waitFor(() => expect(screen.getByTestId('live-rest-value')).toHaveTextContent('2:00'));
    expect(screen.getByTestId('live-rest-state')).toHaveTextContent(/Resting/);
    await fireEvent.press(screen.getByTestId('live-rest-skip'));
    expect(screen.getByTestId('live-rest-state')).toHaveTextContent(/Starts after/);
  });

  it('lists logged sets, follows the last one and deletes a set', async () => {
    const removeSet = jest.fn(async () => true);
    const withSet: StrengthSession = { ...running, sets: [set(3, 'lib:bench_press', 'Bench press', 'chest', 6, 62.5, 8)] };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [withSet] }), actions({ removeSet }))));
    expect(screen.getByLabelText('Set 1: 6 × 62.5 kg · RPE 8')).toBeTruthy();
    expect(screen.getByTestId('live-reps-lib:bench_press').props.value).toBe('6');
    await fireEvent.press(screen.getByTestId(`live-delete-set-${withSet.sets[0]?.id}`));
    expect(removeSet).toHaveBeenCalledWith(withSet.sets[0]?.id);
  });

  it('cannot finish without a set, then finishes and opens the summary', async () => {
    const finishSession = jest.fn(async () => true);
    const view = await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions({ finishSession }))));
    expect(screen.getByTestId('live-finish-hint')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('live-finish'));
    expect(finishSession).not.toHaveBeenCalled();
    const withSet: StrengthSession = { ...running, sets: [set(3, 'lib:bench_press', 'Bench press', 'chest', 6, 62.5)] };
    await view.rerender(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [withSet] }), actions({ finishSession }))));
    await fireEvent.press(screen.getByTestId('live-finish'));
    await waitFor(() => expect(finishSession).toHaveBeenCalledWith(3));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/strength/summary', params: { id: '3' } }));
  });

  it('discards after a confirmation', async () => {
    const removeSession = jest.fn(async () => true);
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions({ removeSession }))));
    await fireEvent.press(screen.getByTestId('live-discard'));
    expect(removeSession).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('live-confirm-discard'));
    await waitFor(() => expect(removeSession).toHaveBeenCalledWith(3));
  });

  it('adds an exercise from the library mid-session', async () => {
    const addSessionExercise = jest.fn(async () => true);
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions({ addSessionExercise }))));
    await fireEvent.press(screen.getByTestId('live-add'));
    await fireEvent.press(screen.getByTestId('pick-lib:pull_up'));
    await waitFor(() =>
      expect(addSessionExercise).toHaveBeenCalledWith(3, { exerciseKey: 'lib:pull_up', exerciseName: 'Pull-up', muscle: 'back', sets: 3, reps: 8, weightKg: 0 }),
    );
  });

  const twoExercises: StrengthSession = {
    ...running,
    exercises: [
      ...running.exercises,
      { id: 12, sessionId: 3, position: 1, exerciseKey: 'lib:back_squat', exerciseName: 'Back squat', muscle: 'quads', sets: 4, reps: 5, weightKg: 100 },
    ],
  };

  it('shows one exercise at a time with its position and moves to the next', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [twoExercises] }), actions())));
    expect(screen.getByTestId('live-position')).toHaveTextContent('Exercise 1 of 2');
    expect(screen.getByTestId('live-exercise-name')).toHaveTextContent('Bench press');
    expect(screen.queryByTestId('live-exercise-lib:back_squat')).toBeNull();
    expect(screen.getByTestId('live-plan-reps-lib:bench_press-3').props.value).toBe('8');
    await fireEvent.press(screen.getByTestId('live-next'));
    expect(screen.getByTestId('live-position')).toHaveTextContent('Exercise 2 of 2');
    expect(screen.getByTestId('live-exercise-lib:back_squat')).toBeTruthy();
    expect(screen.getByTestId('live-next').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('live-jump-lib:bench_press'));
    expect(screen.getByTestId('live-position')).toHaveTextContent('Exercise 1 of 2');
  });

  it('changes reps and weight with the steppers and logs them', async () => {
    const logSet = jest.fn(async () => true);
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions({ logSet }))));
    await fireEvent.press(screen.getByTestId('live-reps-lib:bench_press-more'));
    await fireEvent.press(screen.getByTestId('live-weight-lib:bench_press-more'));
    await fireEvent.press(screen.getByTestId('live-weight-lib:bench_press-more'));
    await fireEvent.press(screen.getByTestId('live-weight-lib:bench_press-less'));
    expect(screen.getByTestId('live-reps-lib:bench_press').props.value).toBe('9');
    expect(screen.getByTestId('live-weight-lib:bench_press').props.value).toBe('62.5');
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await waitFor(() =>
      expect(logSet).toHaveBeenCalledWith(3, { exerciseKey: 'lib:bench_press', exerciseName: 'Bench press', muscle: 'chest', reps: 9, weightKg: 62.5, rpe: null }),
    );
  });

  it('adds and removes 15 seconds of rest', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions())));
    expect(screen.getByTestId('live-rest-plus').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await waitFor(() => expect(screen.getByTestId('live-rest-value')).toHaveTextContent('1:30'));
    await fireEvent.press(screen.getByTestId('live-rest-plus'));
    expect(screen.getByTestId('live-rest-value')).toHaveTextContent('1:45');
    await fireEvent.press(screen.getByTestId('live-rest-minus'));
    await fireEvent.press(screen.getByTestId('live-rest-minus'));
    expect(screen.getByTestId('live-rest-value')).toHaveTextContent('1:15');
  });

  it('buzzes the connected band once when rest is over, only when asked', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXTURE_NOW);
    jest.spyOn(Date, 'now').mockImplementation(() => new Date().getTime());
    const buzz = jest.fn(async () => true);
    const buzzIfConnected = jest.fn(async () => true);
    const device = { ...fixtureAppData().device, connection: 'connected' as const };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { device, bandActions: { ...fixtureBandActions(), buzz, buzzIfConnected } })));
    expect(screen.getByText(/buzzes once when the countdown ends/)).toBeTruthy();
    await fireEvent(screen.getByTestId('live-rest-buzz'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('live-rest-60'));
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await act(async () => {
      jest.advanceTimersByTime(59_000);
    });
    expect(buzzIfConnected).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(buzzIfConnected).toHaveBeenCalledTimes(1);
    expect(buzzIfConnected).toHaveBeenCalledWith('target');
    expect(buzz).not.toHaveBeenCalled();
    expect(screen.getByTestId('live-rest-state')).toHaveTextContent(/Rest is over/);
    jest.useRealTimers();
  });

  it('does not buzz a band that is not connected', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXTURE_NOW);
    jest.spyOn(Date, 'now').mockImplementation(() => new Date().getTime());
    const buzz = jest.fn(async () => true);
    const buzzIfConnected = jest.fn(async () => true);
    const device = { ...fixtureAppData().device, connection: 'disconnected' as const };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions(), { device, bandActions: { ...fixtureBandActions(), buzz, buzzIfConnected } })));
    expect(screen.getByText(/not connected right now/)).toBeTruthy();
    await fireEvent(screen.getByTestId('live-rest-buzz'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('live-rest-60'));
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    expect(buzz).not.toHaveBeenCalled();
    expect(buzzIfConnected).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('keeps every live beat while the same heart rate repeats', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXTURE_NOW);
    const fresh: StrengthSession = { ...running, startedAt: NOW_S };
    const value = fixtureAppData('en', { heartRateBetween: async () => [] });
    const wrapper = ({ children }: { children: ReactNode }) => <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
    const hook = await renderHook(({ at }: { at: number }) => useSessionHeartRate(fresh, 150, at), { initialProps: { at: 0 }, wrapper });
    for (let at = 1; at <= 10; at++) {
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      await hook.rerender({ at });
    }
    expect(hook.result.current).toHaveLength(11);
    expect(new Set(hook.result.current.map((point) => point.hr))).toEqual(new Set([150]));
    jest.useRealTimers();
  });

  it('shows live Load from the heart rate and the volume so far', async () => {
    const withSet: StrengthSession = { ...running, sets: [set(3, 'lib:bench_press', 'Bench press', 'chest', 6, 62.5)] };
    const heartRateBetween = jest.fn(async (fromS: number, toS: number) => steadyHeartRate(fromS, toS, 160));
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [withSet] }), actions(), { heartRateBetween })));
    await waitFor(() => expect(screen.getByTestId('live-load-value')).toHaveTextContent(/^\d+\.\d$/));
    expect(screen.getByTestId('live-volume-value')).toHaveTextContent('375 kg');
    expect(heartRateBetween).toHaveBeenCalledWith(running.startedAt, expect.any(Number), 1);
  });

  it('says why there is no live Load without heart rate', async () => {
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions())));
    await waitFor(() => expect(screen.getByTestId('live-load-missing')).toHaveTextContent('Needs heart rate'));
  });

  it('suggests and logs weights in pounds for imperial units', async () => {
    const logSet = jest.fn(async () => true);
    const settings = { ...createFixtureSettings('en', FIXTURE_NOW), units: 'imperial' as const };
    const heavy: StrengthSession = { ...running, exercises: running.exercises.map((item) => ({ ...item, weightKg: 102.058 })) };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [heavy] }), actions({ logSet }), { settings })));
    expect(screen.getByTestId('live-weight-lib:bench_press').props.value).toBe('225');
    await fireEvent.press(screen.getByTestId('live-weight-lib:bench_press-more'));
    expect(screen.getByTestId('live-weight-lib:bench_press').props.value).toBe('230');
    await fireEvent.press(screen.getByTestId('live-log-lib:bench_press'));
    await waitFor(() => expect(logSet).toHaveBeenCalledWith(3, expect.objectContaining({ weightKg: 104.326 })));
  });

  it('keeps the elapsed time visible next to a long workout name', async () => {
    const long: StrengthSession = { ...running, name: 'A very long workout name that will not fit on one line at all' };
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [long] }), actions())));
    expect(within(screen.getByTestId('live-elapsed')).getByText(' · 2:05')).toBeTruthy();
  });

  it('keeps counting time', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXTURE_NOW);
    jest.spyOn(Date, 'now').mockImplementation(() => new Date().getTime());
    await render(withAppData(<StrengthLiveScreen />, 'en', app(data({ sessions: [running] }), actions())));
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(within(screen.getByTestId('live-elapsed')).getByText(/2:10/)).toBeTruthy();
    jest.useRealTimers();
  });
});

describe('workout summary', () => {
  it('shows volume per exercise, muscular load (level C) and a new record', async () => {
    mockParams = { id: '2' };
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(within(screen.getByTestId('summary-sets')).getByText(/4/)).toBeTruthy();
    expect(within(screen.getByTestId('summary-reps')).getByText(/28/)).toBeTruthy();
    expect(within(screen.getByTestId('summary-volume')).getByText(/1195/)).toBeTruthy();
    expect(within(screen.getByTestId('summary-duration')).getByText('50:00')).toBeTruthy();
    expect(screen.getByTestId('summary-exercise-lib:bench_press')).toBeTruthy();
    expect(screen.getByTestId('summary-record-lib:bench_press')).toBeTruthy();
    expect(screen.queryByTestId('summary-record-lib:back_squat')).toBeNull();
    const chest = screen.getByTestId('summary-load-rows-chest');
    expect(within(chest).getByText('2 sets · 695 kg')).toBeTruthy();
    expect(within(screen.getByTestId('summary-load-rows-core')).getByText('1 sets · 0 kg')).toBeTruthy();
    expect(screen.getByText(/not a measure of physiological strain/)).toBeTruthy();
  });

  it('lists the records set in this workout', async () => {
    mockParams = { id: '2' };
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByTestId('summary-pr-heaviest-lib:bench_press')).toHaveTextContent('Bench press 90 kg × 3');
    expect(screen.queryByTestId('summary-pr-volume-lib:bench_press')).toBeNull();
    expect(screen.queryByTestId('summary-records-none')).toBeNull();
  });

  it('says so when there is no new record', async () => {
    mockParams = { id: '2' };
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByTestId('summary-records-none')).toHaveTextContent('No new records this time.');
  });

  it('shades the trained muscles on the body figure from the session volume', async () => {
    mockParams = { id: '2' };
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByLabelText('Muscle map. Most volume on: Chest, Quadriceps, Core.')).toBeTruthy();
    expect(screen.getByTestId('summary-figure-front-chest-0').props.fillOpacity).toBe(1);
    expect(screen.getByTestId('summary-figure-front-quads-6').props.fillOpacity).toBeCloseTo(0.24 + 0.76 * (500 / 695), 5);
    expect(screen.getByTestId('summary-figure-front-core-1').props.fillOpacity).toBeCloseTo(0.24 + 0.76 * 0.15, 5);
    expect(screen.getByTestId('summary-figure-back-back-0').props.fillOpacity).toBe(1);
    expect(screen.getByText('Not trained')).toBeTruthy();
  });

  it('shows the workout Load from its heart rate, or why there is none', async () => {
    mockParams = { id: '2' };
    const heartRateBetween = jest.fn(async (fromS: number, toS: number, bucketS?: number) => (bucketS === 1 ? steadyHeartRate(fromS, toS) : []));
    const view = await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions(), { heartRateBetween })));
    await waitFor(() => expect(screen.getByTestId('summary-load-value')).toHaveTextContent(/^\d+\.\d$/));
    await view.rerender(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    await waitFor(() => expect(screen.getByTestId('summary-load-missing')).toHaveTextContent('no Load: no heart rate recorded'));
  });

  it('shares the summary as an image through the existing share path', async () => {
    mockParams = { id: '2' };
    jest.mocked(isAvailableAsync).mockResolvedValue(true);
    jest.mocked(captureRef).mockResolvedValue('aGk=');
    jest.mocked(shareAsync).mockResolvedValue();
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    await fireEvent.press(screen.getByTestId('summary-share'));
    expect(screen.getByText('Push 2 · new records: 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('summary-share-sheet-send'));
    await waitFor(() => expect(shareAsync).toHaveBeenCalledWith(expect.stringContaining('openhoop-strength.png'), expect.objectContaining({ mimeType: 'image/png' })));
  });

  it('shows heart-rate stats from the samples in the session window', async () => {
    mockParams = { id: '2' };
    const heartRateBetween = jest.fn(async () => [
      { t: 1, hr: 100 },
      { t: 11, hr: 140 },
    ]);
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions(), { heartRateBetween })));
    await waitFor(() => expect(within(screen.getByTestId('summary-hr-avg')).getByText(/120/)).toBeTruthy());
    expect(within(screen.getByTestId('summary-hr-max')).getByText(/140/)).toBeTruthy();
    expect(heartRateBetween).toHaveBeenCalledWith(DAY_2.startedAt, DAY_2.endedAt, 10);
  });

  it('says so when there are no heart-rate samples', async () => {
    mockParams = { id: '2' };
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    await waitFor(() => expect(screen.getByTestId('summary-hr-none')).toBeTruthy());
  });

  it('falls back to the latest finished session and to an empty state', async () => {
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByText(/Push 2/)).toBeTruthy();
  });

  it('shows an empty state without a finished session', async () => {
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data(), actions())));
    expect(screen.getByTestId('summary-empty')).toBeTruthy();
  });

  it('deletes the workout after a confirmation', async () => {
    mockParams = { id: '2' };
    const removeSession = jest.fn(async () => true);
    await render(withAppData(<StrengthSummaryScreen />, 'en', app(data({ sessions: [DAY_2] }), actions({ removeSession }))));
    await fireEvent.press(screen.getByTestId('summary-delete'));
    expect(removeSession).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('summary-confirm-delete'));
    await waitFor(() => expect(removeSession).toHaveBeenCalledWith(2));
  });
});

describe('exercise details', () => {
  it('shows the estimated 1RM with its formula, history and heaviest set', async () => {
    mockParams = { key: 'lib:bench_press' };
    await render(withAppData(<StrengthExerciseScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByTestId('exercise-rm-value')).toHaveTextContent('99.2 kg');
    expect(screen.getByText('Estimate')).toBeTruthy();
    expect(screen.getByText(/Epley’s formula \(1985\)/)).toBeTruthy();
    expect(within(screen.getByTestId('exercise-heaviest')).getByText(/90/)).toBeTruthy();
    expect(within(screen.getByTestId('exercise-total-sets')).getByText(/4/)).toBeTruthy();
    expect(screen.getByTestId('exercise-entry-2')).toBeTruthy();
    expect(screen.getByTestId('exercise-entry-1')).toBeTruthy();
  });

  it('leads with the best set and lists personal records', async () => {
    mockParams = { key: 'lib:bench_press' };
    await render(withAppData(<StrengthExerciseScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByTestId('exercise-best-value')).toHaveTextContent('85 × 5 kg');
    expect(screen.getByText(/Est\. 1-rep max 99\.2 kg/)).toBeTruthy();
    expect(screen.getByTestId('exercise-heaviest')).toHaveTextContent(/90 kg × 3/);
    expect(screen.getByTestId('exercise-pr-reps')).toHaveTextContent(/Most reps at 80 kg.*5/);
    expect(screen.getByTestId('exercise-pr-volume')).toHaveTextContent(/Best volume.*800 kg/);
    expect(screen.getByTestId('exercise-entry-2')).toHaveTextContent(/5 × 85 kg · 3 × 90 kg/);
    expect(screen.getByTestId('exercise-entry-1')).toHaveTextContent(/2 × 5 · 80 kg/);
  });

  it('gives no estimate for bodyweight work', async () => {
    mockParams = { key: 'lib:crunch' };
    await render(withAppData(<StrengthExerciseScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByTestId('exercise-rm-none')).toBeTruthy();
    expect(screen.queryByTestId('exercise-rm-value')).toBeNull();
    expect(screen.getByTestId('exercise-best-value')).toHaveTextContent('15 reps');
    expect(screen.getByTestId('exercise-heaviest')).toHaveTextContent(/No weighted set yet/);
    expect(screen.getByTestId('exercise-pr-volume')).toHaveTextContent(/No volume yet/);
    expect(screen.getByTestId('exercise-pr-reps')).toHaveTextContent(/Most reps at bodyweight.*15/);
  });

  it('lists trained exercises without a key and handles an unknown key', async () => {
    await render(withAppData(<StrengthExerciseScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByTestId('exercise-pick-lib:back_squat')).toBeTruthy();
    mockParams = { key: 'lib:deadlift' };
    await render(withAppData(<StrengthExerciseScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByTestId('exercise-not-found')).toBeTruthy();
  });
});

describe('strength trends', () => {
  it('shows weekly sessions, volume and volume per muscle group', async () => {
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(within(screen.getByTestId('trends-total')).getByText(/2/)).toBeTruthy();
    expect(screen.getByTestId('trends-sessions-chart')).toBeTruthy();
    expect(screen.getByTestId('trends-volume-chart')).toBeTruthy();
    expect(screen.getByTestId('trends-volume-total')).toHaveTextContent(/1995 kg/);
    expect(screen.getByTestId('trends-muscle-rows-chest')).toBeTruthy();
    expect(screen.getByTestId('trends-total')).toHaveTextContent(/last 4 weeks/);
    await fireEvent.press(screen.getByTestId('trends-range-1w'));
    expect(screen.getByTestId('trends-total-value')).toHaveTextContent('1');
    expect(screen.getByTestId('trends-total')).toHaveTextContent(/this week/);
    expect(screen.getByText('Sessions per day')).toBeTruthy();
    expect(within(screen.getByTestId('trends-sessions-chart')).getByText('Mon')).toBeTruthy();
    expect(within(screen.getByTestId('trends-sessions-chart')).getByText('Sun')).toBeTruthy();
    expect(screen.getByTestId('trends-volume-total')).toHaveTextContent(/1195 kg/);
    expect(screen.queryByTestId('trends-muscle-rows-quads')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('trends-range-6m'));
    expect(screen.getByTestId('trends-total-value')).toHaveTextContent('2');
    expect(screen.getByText('Sessions per month')).toBeTruthy();
    expect(within(screen.getByTestId('trends-sessions-chart')).getByText('Jun')).toBeTruthy();
    expect(within(screen.getByTestId('trends-sessions-chart')).getByText('Nov')).toBeTruthy();
    expect(screen.getByTestId('trends-volume-total')).toHaveTextContent(/1995 kg/);
  });

  it('names each range in full for screen readers', async () => {
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByTestId('trends-range-1w').props.accessibilityLabel).toBe('This week');
    expect(screen.getByTestId('trends-range-1m').props.accessibilityLabel).toBe('Last 4 weeks');
    expect(screen.getByTestId('trends-range-6m').props.accessibilityLabel).toBe('Last 6 months');
  });

  it('shows strength minutes per week, day or month with values', async () => {
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByText('Strength time per week')).toBeTruthy();
    expect(screen.getByTestId('trends-minutes-2026-11-23').props.accessibilityLabel).toBe('W48, minutes: 50');
    expect(screen.getByTestId('trends-minutes-2026-11-16').props.accessibilityLabel).toBe('W47, minutes: 50');
    expect(screen.getByTestId('trends-minutes-2026-11-09').props.accessibilityLabel).toBe('W46, minutes: 0');
    await fireEvent.press(screen.getByTestId('trends-range-1w'));
    expect(screen.getByText('Strength time per day')).toBeTruthy();
    expect(screen.getByTestId('trends-minutes-2026-11-24').props.accessibilityLabel).toBe('Tue, minutes: 50');
    expect(screen.getByTestId('trends-minutes-2026-11-27').props.accessibilityLabel).toBe('Fri, still to come: –');
    await fireEvent.press(screen.getByTestId('trends-range-6m'));
    expect(screen.getByText('Strength time per month')).toBeTruthy();
    expect(screen.getByTestId('trends-minutes-2026-11-01').props.accessibilityLabel).toBe('Nov, minutes: 100');
  });

  it('measures this week against the weekly plan’s strength goal', async () => {
    const userData = { ...defaultUserData(), onboardingDone: true, weeklyPlan: { ...defaultPlan(null), goals: ['strength' as const], strengthMinutes: 90 } };
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions(), { userData })));
    expect(screen.getByTestId('trends-goal-value')).toHaveTextContent('50 / 90 min');
    expect(screen.getByTestId('trends-goal-text')).toHaveTextContent('40 min left this week. About 1 of your usual sessions does it.');
    await fireEvent.press(screen.getByTestId('trends-goal-plan'));
    expect(mockPush).toHaveBeenCalledWith('/plan');
  });

  it('is honest without a plan or without a strength goal', async () => {
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_2] }), actions())));
    expect(screen.getByTestId('trends-goal-none')).toHaveTextContent(/no weekly plan yet/);
    await fireEvent.press(screen.getByTestId('trends-goal-setup'));
    expect(mockPush).toHaveBeenCalledWith('/plan/setup');
    const userData = { ...defaultUserData(), onboardingDone: true, weeklyPlan: { ...defaultPlan(null), goals: ['loadDays' as const] } };
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_2] }), actions(), { userData })));
    expect(screen.getByTestId('trends-goal-none')).toHaveTextContent(/no strength goal/);
    expect(screen.getByText('Add a strength goal')).toBeTruthy();
  });

  it('compares the volume with the period before', async () => {
    const earlier = finished(6, '2026-10-20', NOW_S - 36 * 86_400, [set(6, 'lib:bench_press', 'Bench press', 'chest', 10, 150)]);
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [earlier, DAY_1, DAY_2] }), actions())));
    expect(screen.getByTestId('trends-volume-tile-value')).toHaveTextContent('1995 kg');
    expect(screen.getByTestId('trends-volume-tile-chip')).toHaveTextContent('↑ 33%');
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.queryByTestId('trends-volume-tile-chip')).toBeNull();
    expect(screen.getByTestId('trends-volume-tile')).toHaveTextContent(/No volume in the same days of the period before/);
  });

  it('leaves out sessions older than the chosen period', async () => {
    const old = finished(5, '2026-08-01', NOW_S - 100 * 86_400, [set(5, 'lib:bench_press', 'Bench press', 'chest', 5, 80)]);
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data({ sessions: [old] }), actions())));
    expect(screen.getByTestId('trends-empty')).toBeTruthy();
  });

  it('shows an empty state without sessions', async () => {
    await render(withAppData(<StrengthTrendsScreen />, 'en', app(data(), actions())));
    expect(screen.getByTestId('trends-empty')).toBeTruthy();
  });
});

describe('home week card', () => {
  it('shows the Strength row with this week’s sessions', async () => {
    const days = createFixtureDays(FIXTURE_NOW);
    await render(withAppData(<WeekCard days={days} index={days.length - 1} />, 'en', app(data({ sessions: [DAY_1, DAY_2] }), actions())));
    expect(screen.getByTestId('week-strength')).toHaveTextContent(/^1× · \d+ min$/);
    expect(screen.getByText('Strength')).toBeTruthy();
    expect(screen.queryByTestId('week-strength-bar')).toBeNull();
  });

  it('shows strength minutes as a bar against the weekly goal and seals a met goal', async () => {
    const days = createFixtureDays(FIXTURE_NOW);
    const minutes = 50;
    const withGoal = (goal: number): AppDataOverrides =>
      app(data({ sessions: [DAY_1, DAY_2] }), actions(), {
        userData: { ...defaultUserData(), onboardingDone: true, weeklyPlan: { ...defaultPlan(null), goals: ['strength'], strengthMinutes: goal } },
      });
    await render(withAppData(<WeekCard days={days} index={days.length - 1} />, 'en', withGoal(minutes + 30)));
    expect(screen.getByTestId('week-strength')).toHaveTextContent(`${minutes}/${minutes + 30} min`);
    expect(screen.queryByTestId('week-load')).toBeNull();
    expect(screen.getByTestId('week-strength-bar')).toBeTruthy();
    expect(screen.queryByTestId('week-strength-seal')).toBeNull();
    await render(withAppData(<WeekCard days={days} index={days.length - 1} />, 'en', withGoal(Math.max(1, minutes))));
    expect(screen.getByTestId('week-strength-seal')).toBeTruthy();
  });

  it('shows zero when there is no session this week', async () => {
    const days = createFixtureDays(FIXTURE_NOW);
    await render(withAppData(<WeekCard days={days} index={days.length - 1} />, 'en', app(data(), actions())));
    expect(screen.getByTestId('week-strength')).toHaveTextContent('0× · 0 min');
  });
});
