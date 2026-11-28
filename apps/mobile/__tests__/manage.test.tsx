import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Linking } from 'react-native';

import { createFixtureDevice } from '@/data/fixtureSource';
import { pickDeviceState } from '@/ui/manage/deviceState';
import { serialCode } from '@/ui/manage/safetyCode';
import { donationUrl, parseDonationAmount } from '@/ui/manage/links';
import { checkMeasure, checkProfile, defaultMaxHr } from '@/ui/manage/validation';
import { PARITY } from '@/ui/parity';

import { FIXTURE_NOW, fixtureAppData, fixtureBandActions, fixtureMotionActions, withAppData } from './support/appData';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }));

jest.mock('@/selftest/runSelfTest', () => ({ runSelfTest: async () => [] }));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));

const openSheet = jest.mocked(WebBrowser.openBrowserAsync);

import CommunityScreen from '@/app/(tabs)/community';
import MoreScreen from '@/app/(tabs)/more';
import CalibrationScreen from '@/app/onboarding/calibration';
import SetupScreen from '@/app/onboarding/setup';
import WelcomeScreen from '@/app/onboarding/index';
import AboutScreen from '@/app/settings/about';
import AccuracyScreen from '@/app/settings/accuracy';
import AppSettingsScreen from '@/app/settings/app';
import BatteryPackScreen from '@/app/settings/battery-pack';
import ConnectProviderScreen from '@/app/settings/connect-provider';
import DeviceSettingsScreen from '@/app/settings/device';
import IntegrationsScreen from '@/app/settings/integrations';
import PrivacyScreen from '@/app/settings/privacy';
import SafetyLockScreen from '@/app/settings/safety-lock';
import StatesGalleryScreen from '@/app/settings/states';
import SupportScreen from '@/app/settings/support';

const NOW_S = Math.floor(FIXTURE_NOW.getTime() / 1000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('More', () => {
  it('shows the real device model and battery, and a neutral profile row without a name', async () => {
    const device = createFixtureDevice(FIXTURE_NOW);
    await render(withAppData(<MoreScreen />));
    expect(screen.getByTestId('more-device')).toBeTruthy();
    if (device.model !== null) expect(screen.getByText(new RegExp(device.model))).toBeTruthy();
    expect(screen.getByText('Your profile')).toBeTruthy();
    expect(screen.queryByText('Dario')).toBeNull();
  });

  it('greets by the stored name', async () => {
    const base = fixtureAppData();
    await render(withAppData(<MoreScreen />, 'en', { userData: { ...base.userData, name: 'Alex' } }));
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('opens Help on the terms page and shows the version under About', async () => {
    await render(withAppData(<MoreScreen />));
    expect(screen.getByText('v1.2.3 · open source')).toBeTruthy();
    expect(screen.getByText('Profile, level and streaks')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('more-help'));
    expect(router.push).toHaveBeenCalledWith('/settings/terms');
  });

  it('shows no device value when nothing is known', async () => {
    const base = fixtureAppData();
    await render(withAppData(<MoreScreen />, 'en', { device: { ...base.device, model: null, batteryPercent: null } }));
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe('Device settings', () => {
  it('syncs and links to pairing', async () => {
    const sync = jest.fn(async () => undefined);
    await render(withAppData(<DeviceSettingsScreen />, 'en', { sync }));
    await fireEvent.press(screen.getByTestId('sync-button'));
    expect(sync).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('pair-link'));
    expect(router.push).toHaveBeenCalledWith('/onboarding/pair');
    await fireEvent.press(screen.getByTestId('danger-entry'));
    expect(router.push).toHaveBeenCalledWith('/settings/safety-lock');
  });

  it('shows the locked card for a locked band', async () => {
    const base = fixtureAppData();
    await render(withAppData(<DeviceSettingsScreen />, 'en', { device: { ...base.device, lockState: 'locked' } }));
    expect(screen.getByText('The band is withholding its data')).toBeTruthy();
  });

  it('buzzes, finds and stops the band', async () => {
    const buzz = jest.fn(async () => true);
    const stopBuzz = jest.fn(async () => true);
    await render(withAppData(<DeviceSettingsScreen />, 'en', { bandActions: { ...fixtureBandActions(), buzz, stopBuzz } }));
    await fireEvent.press(screen.getByTestId('buzz-test'));
    expect(buzz).toHaveBeenLastCalledWith('test');
    expect(screen.queryByTestId('buzz-stop')).toBeNull();
    await fireEvent.press(screen.getByTestId('buzz-find'));
    expect(buzz).toHaveBeenLastCalledWith('find');
    await fireEvent.press(await screen.findByTestId('buzz-stop'));
    expect(stopBuzz).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('buzz-stop')).toBeNull());
  });

  it('switches the heart rate broadcast and shows what was last set here', async () => {
    const setHeartRateBroadcast = jest.fn(async () => true);
    const base = fixtureAppData();
    await render(
      withAppData(<DeviceSettingsScreen />, 'en', {
        bandActions: { ...fixtureBandActions(), setHeartRateBroadcast },
        device: { ...base.device, hrBroadcast: { on: false, at: Math.floor(Date.now() / 1000) - 120 } },
      }),
    );
    expect(screen.getByTestId('hr-broadcast-status').props.children).toBe('Last set here: Off, 2 min ago');
    expect(screen.getByTestId('hr-toggle').props.value).toBe(false);
    await fireEvent(screen.getByTestId('hr-toggle'), 'valueChange', true);
    expect(setHeartRateBroadcast).toHaveBeenCalledWith(true);
  });

  it('shows the serial and firmware in the hero, battery as a tile and battery health honestly', async () => {
    const base = fixtureAppData();
    await render(withAppData(<DeviceSettingsScreen />, 'en', { device: { ...base.device, serial: '4A01-77A7' } }));
    expect(screen.getByText(`SN 4A01-77A7 · FW ${base.device.firmware ?? ''}`)).toBeTruthy();
    expect(screen.getByTestId('device-battery-value')).toHaveTextContent(`${base.device.batteryPercent ?? ''}%`);
    expect(within(screen.getByTestId('device-battery-health')).getByText('Not reported')).toBeTruthy();
    expect(screen.getByText('Not read from the band yet')).toBeTruthy();
  });

  it('stores the wear location picked in the sheet', async () => {
    const updateUserData = jest.fn(async () => true);
    await render(withAppData(<DeviceSettingsScreen />, 'en', { updateUserData }));
    expect(within(screen.getByTestId('wear-row')).getByText('Not set')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('wear-row'));
    await fireEvent.press(screen.getByTestId('wear-bicep'));
    expect(updateUserData).toHaveBeenCalledWith({ wearLocation: 'bicep' });
  });

  it('counts the flags OpenHoop left unchanged', async () => {
    const base = fixtureAppData();
    const snapshot = JSON.stringify({
      version: 1,
      readAt: NOW_S - 600,
      source: 'band',
      flags: [
        { key: 'enable_r22_packets', valueText: '1', valueHex: null },
        { key: 'make_hrfm_visible', valueText: '2', valueHex: null },
      ],
      config: [],
      changes: [{ kind: 'flag', key: 'make_hrfm_visible', original: '1', at: NOW_S - 300 }],
    });
    await render(withAppData(<DeviceSettingsScreen />, 'en', { device: { ...base.device, configSnapshot: snapshot } }));
    expect(screen.getByText('1 of 2 unchanged by OpenHoop')).toBeTruthy();
  });

  it('says the band does not report the broadcast setting before OpenHoop changed it', async () => {
    const setHeartRateBroadcast = jest.fn(async () => true);
    await render(withAppData(<DeviceSettingsScreen />, 'en', { bandActions: { ...fixtureBandActions(), setHeartRateBroadcast } }));
    expect(screen.getByTestId('hr-broadcast-status').props.children).toMatch(/does not report/);
    expect(screen.queryByTestId('hr-toggle')).toBeNull();
    await fireEvent.press(screen.getByTestId('hr-off'));
    expect(setHeartRateBroadcast).toHaveBeenCalledWith(false);
  });

  it('switches high-rate motion during workouts', async () => {
    const setHighRate = jest.fn(async () => true);
    await render(withAppData(<DeviceSettingsScreen />, 'en', { motionActions: { ...fixtureMotionActions(), setHighRate } }));
    expect(screen.queryByTestId('motion-not-built')).toBeNull();
    await fireEvent(screen.getByTestId('motion-toggle'), 'valueChange', true);
    expect(setHighRate).toHaveBeenCalledWith(true);
    expect(screen.getByText(/while a strength session is open in the app/)).toBeTruthy();
  });
});

describe('Safety lock', () => {
  it('asks for the last four serial characters before the button turns on', async () => {
    const base = fixtureAppData();
    await render(withAppData(<SafetyLockScreen />, 'en', { device: { ...base.device, serial: '5B01-77A7', backlogPages: 12 } }));
    expect(screen.getByText('Unpair this band?')).toBeTruthy();
    expect(screen.getByTestId('safety-nothing-sent')).toBeTruthy();
    expect(screen.getByText('Confirm (sends nothing yet)')).toBeTruthy();
    expect(screen.getByText('Type 77A7 to confirm')).toBeTruthy();
    expect(screen.getByTestId('safety-backlog')).toBeTruthy();
    expect(screen.getByTestId('danger-confirm').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('danger-input'), '77A');
    expect(screen.getByTestId('danger-confirm').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('danger-input'), '77a7');
    expect(screen.getByTestId('danger-confirm').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('danger-confirm'));
    expect(router.back).toHaveBeenCalled();
  });

  it('falls back to the word when the serial number is not known', async () => {
    await render(withAppData(<SafetyLockScreen />));
    expect(screen.getByText('Type ERASE to confirm')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('danger-input'), 'ERASE');
    expect(screen.getByTestId('danger-confirm').props.accessibilityState.disabled).toBe(false);
  });

  it('takes the code from the end of the serial number', () => {
    expect(serialCode('5B01-77A7')).toBe('77A7');
    expect(serialCode('ab12')).toBe('AB12');
    expect(serialCode('12')).toBeNull();
    expect(serialCode(null)).toBeNull();
  });
});

describe('Not built screens', () => {
  it.each([
    ['community', CommunityScreen, 'not-built-community'],
  ])('%s shows the not built notice', async (_name, Screen, testID) => {
    await render(withAppData(<Screen />));
    expect(screen.getByTestId(testID)).toBeTruthy();
  });

  it.each([
    ['integrations', IntegrationsScreen, 'strava-row'],
    ['connect-provider', ConnectProviderScreen, 'provider-strava'],
  ])('%s links Strava instead of a not built notice', async (_name, Screen, testID) => {
    await render(withAppData(<Screen />));
    expect(screen.queryByTestId('not-built-integrations')).toBeNull();
    await fireEvent.press(screen.getByTestId(testID));
    expect(router.push).toHaveBeenCalledWith('/settings/strava');
  });
});

describe('Connect a provider', () => {
  it('lists the partner providers honestly and explains that plug-ins are not built', async () => {
    await render(withAppData(<ConnectProviderScreen />));
    expect(within(screen.getByTestId('provider-hero')).getByText('These need a partner')).toBeTruthy();
    const order = JSON.stringify(screen.toJSON()).match(/"testID":"provider-(teams|partner-note|add-plugin)"/g) ?? [];
    expect(order).toEqual(['"testID":"provider-teams"', '"testID":"provider-partner-note"', '"testID":"provider-add-plugin"']);
    expect(screen.getAllByText('No provider yet')).toHaveLength(3);
    await fireEvent.press(screen.getByTestId('provider-add-plugin'));
    expect(screen.getByTestId('provider-plugin-not-built')).toBeTruthy();
  });

  it('says teams need a server that is not built', async () => {
    await render(withAppData(<ConnectProviderScreen />));
    await fireEvent.press(screen.getByTestId('provider-teams'));
    expect(screen.getByTestId('provider-teams-not-built')).toBeTruthy();
  });
});

describe('Band status on the device screen', () => {
  const band = {
    wear: { phase: 'on' as const, since: NOW_S - 7_200 },
    charging: { charging: false, at: NOW_S - 600 },
    boot: { lastBootAt: NOW_S - 18_000, bootCount: 31, rebootReason: 0x1001, signalProcessingVersion: '12.0.6' },
  };

  it('shows the wear state, charging and band info with their times', async () => {
    const base = fixtureAppData();
    await render(withAppData(<DeviceSettingsScreen />, 'en', { device: { ...base.device, band } }));
    expect(within(screen.getByTestId('band-status-wear')).getByText('On your wrist')).toBeTruthy();
    expect(within(screen.getByTestId('band-status-wear-since')).getByText(/ago/)).toBeTruthy();
    expect(within(screen.getByTestId('band-status-charging')).getByText('Not charging')).toBeTruthy();
    expect(within(screen.getByTestId('band-info-signal')).getByText('12.0.6')).toBeTruthy();
    expect(within(screen.getByTestId('band-info-restarts')).getByText('31')).toBeTruthy();
    expect(within(screen.getByTestId('band-info-reason')).getByText('0x1001')).toBeTruthy();
  });

  it('says the band status is unknown for a band without these reports', async () => {
    const base = fixtureAppData();
    await render(withAppData(<DeviceSettingsScreen />, 'en', { device: { ...base.device, band: null } }));
    expect(within(screen.getByTestId('band-status-wear')).getByText('Unknown')).toBeTruthy();
    expect(within(screen.getByTestId('band-status-charging')).getByText('Unknown')).toBeTruthy();
    expect(screen.queryByTestId('band-status-wear-since')).toBeNull();
    expect(within(screen.getByTestId('band-info-restarts')).getByText('Unknown')).toBeTruthy();
  });

  it('shows the band status in Dutch', async () => {
    const base = fixtureAppData();
    await render(withAppData(<DeviceSettingsScreen />, 'nl', { device: { ...base.device, band } }));
    expect(within(screen.getByTestId('band-status-wear')).getByText('Om je pols')).toBeTruthy();
    expect(within(screen.getByTestId('band-status-charging')).getByText('Laadt niet op')).toBeTruthy();
  });
});

describe('Battery pack', () => {
  const report = {
    socPercent: 64.7,
    socAt: NOW_S - 120,
    info: { serial: 'TESTPACK0000001', hwFamily: 12, hwVersion: 13, firmware: { major: 3, minor: 30, patch: 5, build: 0 }, colourway: 1 },
    infoAt: NOW_S - 600,
  };

  it('says so when the band has not passed on a pack report, and shows no numbers', async () => {
    await render(withAppData(<BatteryPackScreen />));
    expect(screen.getByTestId('pack-empty')).toBeTruthy();
    expect(screen.queryByTestId('pack-status')).toBeNull();
    expect(screen.queryByTestId('not-built-battery')).toBeNull();
  });

  it('shows the last pack report as experimental, with its level', async () => {
    const base = fixtureAppData();
    await render(withAppData(<BatteryPackScreen />, 'en', { device: { ...base.device, batteryPack: report } }));
    expect(screen.getByTestId('pack-status')).toBeTruthy();
    expect(screen.getByTestId('pack-report-charge')).toHaveTextContent(/64\.7%$/);
    expect(screen.getByText('TESTPACK0000001')).toBeTruthy();
    expect(screen.getByText('3.30.5.0')).toBeTruthy();
    expect(screen.getByText('Experimental')).toBeTruthy();
    expect(screen.getByText('Last reported')).toBeTruthy();
    expect(screen.getByText(`Level ${PARITY.batteryPack}`)).toBeTruthy();
  });

  it('keeps the identity when the last report had no charge', async () => {
    const base = fixtureAppData();
    const noCharge = { ...report, socPercent: null, socAt: null };
    await render(withAppData(<BatteryPackScreen />, 'en', { device: { ...base.device, batteryPack: noCharge } }));
    expect(screen.getByText('TESTPACK0000001')).toBeTruthy();
    expect(screen.queryByTestId('pack-report-charge')).toBeNull();
  });

  it('shows the pack charge in the ring, charges per week and honest tiles', async () => {
    const base = fixtureAppData();
    const chargeHistory = jest.fn(async () => [NOW_S - 2 * 86_400, NOW_S - 9 * 86_400]);
    await render(withAppData(<BatteryPackScreen />, 'en', { device: { ...base.device, batteryPack: report }, chargeHistory }));
    expect(screen.getByTestId('pack-hero-value')).toHaveTextContent(/64\.7%$/);
    expect(screen.getByTestId('pack-charge-tile-value')).toHaveTextContent(/^64\.7/);
    expect(screen.getByTestId('pack-report-charge')).toHaveTextContent(/64\.7%$/);
    expect(within(screen.getByTestId('pack-cycles-tile')).getByText('Not reported')).toBeTruthy();
    expect(await screen.findByTestId('pack-charges-bars')).toBeTruthy();
    expect(chargeHistory).toHaveBeenCalled();
    expect(screen.getByText("Counted from the band's own charging events.")).toBeTruthy();
  });

  it('says when no charging was recorded and shows no pack charge without a report', async () => {
    await render(withAppData(<BatteryPackScreen />));
    expect(await screen.findByText('No charging was recorded in the last 30 days.')).toBeTruthy();
    expect(within(screen.getByTestId('pack-charge-tile')).getByText('No report yet')).toBeTruthy();
    expect(screen.getByTestId('pack-hero-missing')).toHaveTextContent('No report yet');
    expect(screen.getByTestId('pack-hero-status')).toHaveTextContent('Charging state not reported');
  });

  it('writes the charge the Dutch way', async () => {
    const base = fixtureAppData();
    await render(withAppData(<BatteryPackScreen />, 'nl', { device: { ...base.device, batteryPack: report } }));
    expect(screen.getByTestId('pack-report-charge')).toHaveTextContent(/64,7%$/);
    expect(screen.getByTestId('pack-hero-value')).toHaveTextContent(/64,7%$/);
    expect(screen.getByText('Experimenteel')).toBeTruthy();
  });
});

describe('App settings', () => {
  it('labels the notification level and explains both data sources without calling the band untested', async () => {
    await render(withAppData(<AppSettingsScreen />));
    expect(screen.getByTestId('notification-preset-label')).toHaveTextContent('How many notifications');
    expect(screen.getByTestId('source-hint-band')).toHaveTextContent(/Bluetooth/);
    expect(screen.getByTestId('source-hint-demo')).toHaveTextContent(/simulation/);
    expect(screen.queryByText(/untested|not arrived/i)).toBeNull();
  });

  it('switches language', async () => {
    const updateSettings = jest.fn(async () => undefined);
    await render(withAppData(<AppSettingsScreen />, 'en', { updateSettings }));
    await fireEvent.press(screen.getByText('Nederlands'));
    expect(updateSettings).toHaveBeenCalledWith({ language: 'nl' });
  });

  it('switches units and theme', async () => {
    const updateSettings = jest.fn(async () => undefined);
    const updateUserData = jest.fn(async () => true);
    await render(withAppData(<AppSettingsScreen />, 'en', { updateSettings, updateUserData }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Imperial' }));
    expect(updateSettings).toHaveBeenCalledWith({ units: 'imperial' });
    expect(screen.getByRole('tab', { name: 'System', selected: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Light' }));
    expect(updateUserData).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('applies a notification preset and saves the new switches', async () => {
    const updateUserData = jest.fn(async () => true);
    const base = fixtureAppData();
    const notifications = { ...base.userData.notifications, enabled: true };
    await render(
      withAppData(<AppSettingsScreen />, 'en', { updateUserData, notificationPermission: 'granted', userData: { ...base.userData, notifications } }),
    );
    expect(screen.getByRole('tab', { name: 'Standard', selected: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Everything' }));
    expect(updateUserData).toHaveBeenLastCalledWith({ notifications: { ...notifications, morningDigest: true, syncProblems: true, goals: true, coachCheckins: true } });
    await fireEvent(screen.getByTestId('toggle-goals'), 'valueChange', false);
    expect(updateUserData).toHaveBeenLastCalledWith({ notifications: { ...notifications, goals: false } });
    expect(screen.getByText('Turn on the coach under Data & privacy first')).toBeTruthy();
  });

  it('says when there is no earlier home layout', async () => {
    const updateUserData = jest.fn(async () => true);
    await render(withAppData(<AppSettingsScreen />, 'en', { updateUserData }));
    expect(screen.getByText('There is no earlier layout to go back to')).toBeTruthy();
    expect(screen.getByText('Classic · default')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('restore-layout'));
    expect(updateUserData).not.toHaveBeenCalled();
  });

  it('restores the previous home layout', async () => {
    const updateUserData = jest.fn(async () => true);
    const base = fixtureAppData();
    const userData = { ...base.userData, dashboardTiles: ['steps' as const], previousDashboardTiles: base.userData.dashboardTiles };
    await render(withAppData(<AppSettingsScreen />, 'en', { updateUserData, userData }));
    expect(screen.getByText('Classic · customised')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('restore-layout'));
    await waitFor(() => expect(updateUserData).toHaveBeenCalledWith({ dashboardTiles: base.userData.dashboardTiles, previousDashboardTiles: ['steps'] }));
    expect(await screen.findByText('The previous layout is back')).toBeTruthy();
  });
});

describe('Data and privacy', () => {
  it('exports on request, as everything or one format', async () => {
    const exportData = jest.fn(async () => undefined);
    await render(withAppData(<PrivacyScreen />, 'en', { exportData }));
    await fireEvent.press(screen.getByTestId('export-button'));
    await waitFor(() => expect(exportData).toHaveBeenCalledWith('all'));
    await waitFor(() => expect(screen.getByTestId('export-csv').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId('export-csv'));
    await waitFor(() => expect(exportData).toHaveBeenLastCalledWith('csv'));
    await waitFor(() => expect(screen.getByTestId('export-database').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId('export-database'));
    await waitFor(() => expect(exportData).toHaveBeenLastCalledWith('database'));
  });

  it('shows the database size and raw record count, and says when they are not read', async () => {
    const storageStats = jest.fn(async () => ({ databaseBytes: 1_400_000_000, rawChunks: 30, rawFrames: 412_345, oldestRawAt: 1 }));
    await render(withAppData(<PrivacyScreen />, 'en', { storageStats }));
    expect(await screen.findByTestId('privacy-database-value')).toHaveTextContent('1.4 GB');
    expect(screen.getByTestId('privacy-raw-value')).toHaveTextContent('412k');
    expect(screen.getByText('All raw kept')).toBeTruthy();
  });

  it('asks before keeping less raw data and saves the retention', async () => {
    const updateUserData = jest.fn(async () => true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => buttons?.[1]?.onPress?.());
    await render(withAppData(<PrivacyScreen />, 'en', { updateUserData }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Raw 30 d' }));
    expect(alert).toHaveBeenCalledWith('Remove older raw records?', expect.stringContaining('30 days'), expect.anything());
    expect(updateUserData).toHaveBeenCalledWith({ rawRetentionDays: 30 });
    alert.mockRestore();
  });

  it('says encrypted backup is not built and switches local-only mode', async () => {
    const updateUserData = jest.fn(async () => true);
    await render(withAppData(<PrivacyScreen />, 'en', { updateUserData }));
    expect(screen.getByTestId('backup-not-built')).toBeTruthy();
    expect(screen.getByText('Local only')).toBeTruthy();
    await fireEvent(screen.getByTestId('local-only-toggle'), 'valueChange', false);
    expect(updateUserData).toHaveBeenCalledWith({ network: expect.objectContaining({ enabled: true }) });
  });

  it('deletes all data only after the word is typed, then starts onboarding', async () => {
    const deleteAllData = jest.fn(async () => true);
    await render(withAppData(<PrivacyScreen />, 'en', { deleteAllData }));
    await fireEvent.press(screen.getByTestId('delete-all'));
    expect(screen.getByTestId('danger-confirm').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('danger-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('danger-confirm'));
    await waitFor(() => expect(deleteAllData).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/onboarding'));
  });

  it('rejects an invalid owner-since date and saves an earlier one without a prompt', async () => {
    const updateSettings = jest.fn(async () => undefined);
    const base = fixtureAppData();
    await render(withAppData(<PrivacyScreen />, 'en', { updateSettings, settings: { ...base.settings, ownerSince: '2026-05-01' } }));
    await fireEvent.changeText(screen.getByTestId('owner-since-input'), '2026-13-40');
    await fireEvent.press(screen.getByTestId('owner-since-save'));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid date that is not in the future.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('owner-since-input'), '2026-04-01');
    await fireEvent.press(screen.getByTestId('owner-since-save'));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ ownerSince: '2026-04-01' }));
  });
});

describe('About, accuracy and support', () => {
  it.each([
    ['about', () => <AboutScreen />, 'about-source'],
    ['support', () => <SupportScreen />, 'support-repo'],
  ])('labels the source code link on %s without a bare URL and still opens the repository', async (_name, make, id) => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(withAppData(make()));
    expect(within(screen.getByTestId(id)).getByText('DarioDML/OpenHoop on GitHub')).toBeTruthy();
    expect(within(screen.getByTestId(id)).queryByText(/https:/)).toBeNull();
    await fireEvent.press(screen.getByTestId(id));
    expect(open).toHaveBeenCalledWith('https://github.com/DarioDML/OpenHoop');
    open.mockRestore();
  });

  it('shows the app version from the config', async () => {
    await render(withAppData(<AboutScreen />));
    expect(screen.getByTestId('about-version')).toHaveTextContent(/^(Version 1\.2\.3|v1\.2\.3 · build \d+)$/);
    expect(screen.getByTestId('about-contributors')).toBeTruthy();
    expect(screen.getByText('Not affiliated with WHOOP')).toBeTruthy();
    expect(screen.getByTestId('about-terms')).toBeTruthy();
    expect(screen.getByTestId('about-developer')).toBeTruthy();
    expect(screen.getAllByText(/not a medical device/i).length).toBeGreaterThan(0);
  });

  it('lists every parity value as not measured, with no invented numbers', async () => {
    await render(withAppData(<AccuracyScreen />));
    for (const key of Object.keys(PARITY)) expect(screen.getByTestId(`accuracy-${key}`)).toBeTruthy();
    expect(screen.getAllByText('Not measured yet').length).toBeGreaterThanOrEqual(Object.keys(PARITY).length);
    expect(screen.queryByText(/±/)).toBeNull();
  });

  it('shows measured differences with their target once official values are imported', async () => {
    const base = fixtureAppData();
    const days = base.days.filter((day) => day.readiness.value !== null);
    const cycles = days.slice(0, 5).map((day) => ({
      startT: day.start,
      endT: day.end,
      tzOffsetS: day.tzOffsetS,
      day: day.day,
      recoveryPct: (day.readiness.value ?? 0) + 2,
      restingHr: null,
      hrvMs: null,
      skinTempC: null,
      spo2Pct: null,
      respiratoryRate: null,
      dayStrain: null,
    }));
    await render(withAppData(<AccuracyScreen />, 'en', { vendorData: { cycles, sleeps: [], workouts: [], journal: [] } }));
    expect(screen.getByTestId('accuracy-summary')).toHaveTextContent('1 of 1 metrics within target');
    expect(screen.getByTestId('accuracy-result-readiness-value')).toHaveTextContent('±2.0 pts');
    expect(screen.getByTestId('accuracy-result-readiness-target')).toHaveTextContent('✓ target 5');
    expect(within(screen.getByTestId('accuracy-stages')).getByText('Measured')).toBeTruthy();
    expect(within(screen.getByTestId('accuracy-result-hrv')).getByText('Not measured yet')).toBeTruthy();
    expect(within(screen.getByTestId('accuracy-readiness')).getByText('Measured')).toBeTruthy();
  });

  it('shows the skin temperature target in Fahrenheit with two decimals', async () => {
    const base = fixtureAppData();
    const days = base.days.filter((day) => day.skinTempC.value !== null);
    const cycles = days.slice(0, 4).map((day) => ({
      startT: day.start,
      endT: day.end,
      tzOffsetS: day.tzOffsetS,
      day: day.day,
      recoveryPct: null,
      restingHr: null,
      hrvMs: null,
      skinTempC: (day.skinTempC.value ?? 0) + 0.1,
      spo2Pct: null,
      respiratoryRate: null,
      dayStrain: null,
    }));
    await render(withAppData(<AccuracyScreen />, 'en', { vendorData: { cycles, sleeps: [], workouts: [], journal: [] }, settings: { ...base.settings, units: 'imperial' } }));
    expect(screen.getByTestId('accuracy-result-skinTemp-target')).toHaveTextContent('✓ target 0.36');
    expect(screen.getByTestId('accuracy-result-skinTemp-value')).toHaveTextContent('±0.18 °F');
  });

  it('says nothing is measured on your data before an import', async () => {
    await render(withAppData(<AccuracyScreen />));
    expect(screen.getByTestId('accuracy-summary')).toHaveTextContent('Not measured on your data yet');
    await fireEvent.press(screen.getByTestId('accuracy-import'));
    expect(router.push).toHaveBeenCalledWith('/settings/import');
  });

  it('builds GitHub Sponsors checkout links', () => {
    expect(donationUrl('one-time', 5)).toBe('https://github.com/sponsors/DarioDML/sponsorships?preview=false&frequency=one-time&amount=5');
    expect(donationUrl('monthly', 10)).toBe('https://github.com/sponsors/DarioDML/sponsorships?preview=false&frequency=recurring&amount=10');
  });

  it('accepts only whole dollar amounts from 1 to 12000', () => {
    expect(parseDonationAmount('7')).toBe(7);
    expect(parseDonationAmount(' 25 ')).toBe(25);
    expect(parseDonationAmount('12000')).toBe(12000);
    for (const bad of ['', '0', '12001', '7.5', '7,5', '-3', 'abc', '1e3', '123456']) expect(parseDonationAmount(bad)).toBeNull();
  });

  it('opens a one-off $5 checkout in a sheet over the app by default', async () => {
    openSheet.mockClear();
    await render(withAppData(<SupportScreen />));
    expect(screen.getByTestId('donate-amount-5')).toHaveProperty('props.accessibilityState.selected', true);
    expect(screen.getByTestId('donate-amount-3')).toHaveProperty('props.accessibilityState.selected', false);
    expect(screen.getByRole('tab', { name: 'One-off', selected: true })).toBeTruthy();
    expect(screen.queryByTestId('donate-custom-amount')).toBeNull();
    expect(screen.getByText('Donate $5 once')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('support-donate'));
    await waitFor(() => expect(openSheet).toHaveBeenCalledTimes(1));
    expect(openSheet).toHaveBeenCalledWith(donationUrl('one-time', 5), expect.objectContaining({ presentationStyle: 'pageSheet' }));
  });

  it('opens a monthly checkout for a preset or a typed amount', async () => {
    openSheet.mockClear();
    await render(withAppData(<SupportScreen />));
    await fireEvent.press(screen.getByRole('tab', { name: 'Monthly' }));
    await fireEvent.press(screen.getByTestId('donate-amount-10'));
    expect(screen.getByTestId('donate-amount-10')).toHaveProperty('props.accessibilityState.selected', true);
    expect(screen.getByTestId('donate-amount-5')).toHaveProperty('props.accessibilityState.selected', false);
    expect(screen.getByText('Donate $10 a month')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('support-donate'));
    await waitFor(() => expect(openSheet).toHaveBeenLastCalledWith(donationUrl('monthly', 10), expect.anything()));

    await fireEvent.press(screen.getByTestId('donate-amount-other'));
    expect(screen.getByTestId('support-donate')).toHaveProperty('props.accessibilityState.disabled', true);
    expect(screen.getByText('Whole dollars, from $1 to $12,000.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('donate-custom-amount'), '0');
    expect(screen.getByText('That amount cannot be used. Enter whole dollars, from $1 to $12,000.')).toBeTruthy();
    expect(screen.getByTestId('donate-custom-amount')).toHaveProperty(
      'props.accessibilityHint',
      'That amount cannot be used. Enter whole dollars, from $1 to $12,000.',
    );
    expect(screen.getByTestId('support-donate')).toHaveProperty('props.accessibilityState.disabled', true);
    await fireEvent.changeText(screen.getByTestId('donate-custom-amount'), '7');
    expect(screen.getByText('Donate $7 a month')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('support-donate'));
    await waitFor(() => expect(openSheet).toHaveBeenLastCalledWith(donationUrl('monthly', 7), expect.anything()));
    expect(openSheet).toHaveBeenCalledTimes(2);
  });

  it('falls back to the browser when the in-app sheet cannot open', async () => {
    openSheet.mockClear();
    openSheet.mockRejectedValueOnce(new Error('no browser supports custom tabs'));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(withAppData(<SupportScreen />));
    await fireEvent.press(screen.getByTestId('support-donate'));
    await waitFor(() => expect(open).toHaveBeenCalledWith(donationUrl('one-time', 5)));
    expect(screen.queryByTestId('support-open-failed')).toBeNull();
    open.mockRestore();
  });

  it('says so when neither the sheet nor the browser can open', async () => {
    openSheet.mockClear();
    openSheet.mockRejectedValueOnce(new Error('no browser supports custom tabs'));
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no handler'));
    await render(withAppData(<SupportScreen />));
    await fireEvent.press(screen.getByTestId('support-donate'));
    expect(await screen.findByText('GitHub could not be opened. Check that a web browser is installed and try again.')).toBeTruthy();
    expect(screen.getByTestId('support-donate')).toHaveProperty('props.accessibilityState.disabled', false);
    await fireEvent.press(screen.getByTestId('support-donate'));
    await waitFor(() => expect(screen.queryByTestId('support-open-failed')).toBeNull());
    open.mockRestore();
  });

  it('shows the donation choice in Dutch and keeps the GitHub links', async () => {
    await render(withAppData(<SupportScreen />, 'nl'));
    expect(screen.getByText('Doneer eenmalig $5')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Maandelijks' }));
    expect(screen.getByText('Doneer $5 per maand')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('donate-amount-other'));
    await fireEvent.changeText(screen.getByTestId('donate-custom-amount'), '15');
    expect(screen.getByText('Doneer $15 per maand')).toBeTruthy();
    expect(screen.getByTestId('support-issues')).toBeTruthy();
    expect(screen.getByTestId('support-repo')).toBeTruthy();
  });
});

describe('System states', () => {
  it('shows every example state labelled as an example', async () => {
    await render(withAppData(<StatesGalleryScreen />));
    for (const id of ['notConnected', 'waitingForData', 'syncing', 'lowBattery', 'charging', 'calibrating', 'noData', 'needsMg', 'offline', 'dataAtRisk', 'firstDay']) {
      expect(screen.getByTestId(`state-example-${id}`)).toBeTruthy();
    }
    expect(screen.getAllByText('Example')).toHaveLength(11);
    expect(screen.getByText("Honest when there's nothing to show")).toBeTruthy();
    expect(screen.getByTestId('states-board')).toBeTruthy();
  });

  it('picks the right device state', () => {
    const device = createFixtureDevice(FIXTURE_NOW);
    const days = fixtureAppData().days;
    const base = { device: { ...device, connection: 'connected' as const, batteryPercent: 80, lastSyncAt: NOW_S - 60 }, days, syncProgress: null, nowS: NOW_S };
    expect(pickDeviceState(base)).toBeNull();
    expect(pickDeviceState({ ...base, device: { ...base.device, lastSyncAt: NOW_S - 8 * 86400 } })).toBe('dataAtRisk');
    expect(pickDeviceState({ ...base, device: { ...base.device, batteryPercent: 10 } })).toBe('lowBattery');
    expect(pickDeviceState({ ...base, device: { ...base.device, name: null, lastSyncAt: null }, days: [] })).toBe('notConnected');
    expect(pickDeviceState({ ...base, device: { ...base.device, lastSyncAt: null }, days: [] })).toBe('waitingForData');
    expect(pickDeviceState({ ...base, days: [] })).toBe('waitingForData');
    expect(pickDeviceState({ ...base, days: days.slice(0, 1) })).toBe('firstDay');
    expect(pickDeviceState({ ...base, device: { ...base.device, connection: 'syncing' } })).toBe('syncing');
  });

  it('shows Charging when the band was charging at a sync under 15 minutes ago, before low battery', () => {
    const device = createFixtureDevice(FIXTURE_NOW);
    const days = fixtureAppData().days;
    const band = { wear: null, charging: { charging: true, at: NOW_S - 650 }, boot: { lastBootAt: null, bootCount: null, rebootReason: null, signalProcessingVersion: null } };
    const charging = { ...device, connection: 'connected' as const, batteryPercent: 10, lastSyncAt: NOW_S - 600, band };
    expect(pickDeviceState({ device: charging, days, syncProgress: null, nowS: NOW_S })).toBe('charging');
    expect(pickDeviceState({ device: { ...charging, lastSyncAt: NOW_S - 901 }, days, syncProgress: null, nowS: NOW_S })).toBe('lowBattery');
    expect(pickDeviceState({ device: { ...charging, band: { ...band, charging: { charging: false, at: NOW_S - 650 } } }, days, syncProgress: null, nowS: NOW_S })).toBe('lowBattery');
  });

  it('does not show Charging from an old charging report after a fresh but partial sync', () => {
    const device = createFixtureDevice(FIXTURE_NOW);
    const days = fixtureAppData().days;
    const band = { wear: null, charging: { charging: true, at: NOW_S - 86_400 }, boot: { lastBootAt: null, bootCount: null, rebootReason: null, signalProcessingVersion: null } };
    const stale = { ...device, connection: 'connected' as const, batteryPercent: 10, lastSyncAt: NOW_S - 60, band };
    expect(pickDeviceState({ device: stale, days, syncProgress: null, nowS: NOW_S })).toBe('lowBattery');
  });
});

describe('Onboarding', () => {
  it('lets the demo band finish the flow from the welcome screen', async () => {
    const updateSettings = jest.fn(async () => undefined);
    const updateUserData = jest.fn(async () => true);
    await render(withAppData(<WelcomeScreen />, 'en', { updateSettings, updateUserData }));
    await fireEvent.press(screen.getByTestId('welcome-demo'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(updateSettings).toHaveBeenCalledWith({ dataSource: 'demo' });
    expect(updateUserData).toHaveBeenCalledWith({ onboardingDone: true });
  });

  it('says how many readings the first sync saved and how many it left out', async () => {
    const device = { ...createFixtureDevice(FIXTURE_NOW), lastSyncCounts: { saved: 0, discarded: 5200 } };
    await render(withAppData(<SetupScreen />, 'en', { device, sync: jest.fn(async () => undefined) }));
    await waitFor(() => expect(screen.getByTestId('setup-counts')).toBeTruthy());
    expect(screen.getByTestId('setup-counts')).toHaveTextContent(/No readings were saved yet/);
    expect(screen.getByTestId('setup-discarded')).toHaveTextContent('5200 readings were from before the date you entered and were not kept.');
  });

  it('marks onboarding done on the calibration screen', async () => {
    const updateUserData = jest.fn(async () => true);
    await render(withAppData(<CalibrationScreen />, 'en', { updateUserData }));
    await fireEvent.press(screen.getByTestId('calibration-finish'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(updateUserData).toHaveBeenCalledWith({ onboardingDone: true });
  });
});

describe('Body validation', () => {
  it('validates birth year and max heart rate', () => {
    expect(checkProfile('1990', '185', 2026)).toEqual({ ok: true, birthYear: 1990, maxHeartRate: 185 });
    expect(checkProfile('', '', 2026)).toEqual({ ok: true, birthYear: null, maxHeartRate: null });
    expect(checkProfile('1800', '', 2026).ok).toBe(false);
    expect(checkProfile('2090', '', 2026).ok).toBe(false);
    expect(checkProfile('1990', '300', 2026).ok).toBe(false);
    expect(checkProfile('abc', '', 2026).ok).toBe(false);
    expect(defaultMaxHr('1990', 2026)).toBe(183);
    expect(defaultMaxHr('', 2026)).toBeNull();
  });

  it('validates body measures', () => {
    expect(checkMeasure('180,5', { min: 80, max: 250 })).toEqual({ ok: true, value: 180.5 });
    expect(checkMeasure('', { min: 80, max: 250 })).toEqual({ ok: true, value: null });
    expect(checkMeasure('30', { min: 80, max: 250 }).ok).toBe(false);
    expect(checkMeasure('1e5', { min: 80, max: 250 }).ok).toBe(false);
  });
});
