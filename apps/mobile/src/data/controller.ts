import {
  ActivityInputError,
  RouteInputError,
  Session,
  bindActivityStore,
  bindStore,
  checkActivityInput,
  computeActivityMetrics,
  addStrengthSessionExercise,
  addStrengthSet,
  deleteCustomExercise,
  deleteStrengthSession,
  deleteStrengthSet,
  deleteStrengthTemplate,
  emptyStrengthData,
  finishStrengthSession,
  insertCustomExercise,
  listStrengthData,
  removeStrengthSessionExercise,
  saveStrengthTemplate,
  startStrengthSession,
  deleteBodyMeasurement,
  deleteJournalNote,
  deleteDataBefore,
  exportJson,
  pruneRawBefore,
  chargeStartsSince,
  storageStats as readStorageStats,
  wipeAllData,
  type StorageStats,
  deleteLabResult,
  deleteCuffReading,
  insertCuffReading,
  listCuffReadings,
  setEcgSymptoms,
  type CuffReading,
  type CuffReadingInput,
  type EcgSymptom,
  consoleLinesCsv,
  exportCsv,
  importBodyMeasurements,
  emptyVendorData,
  insertBodyMeasurement,
  insertJournalNote,
  insertLabResult,
  listBodyMeasurements,
  listJournalNotes,
  listLabResults,
  listRoute,
  loadReference,
  listVendorData,
  clearPregnancy,
  deleteAllCycleData,
  deletePeriod,
  deleteSymptom,
  emptyCycleData,
  insertPeriod,
  loadCycleData,
  needsLockProbe,
  probeLock,
  readDeviceInformation,
  latestBandStatus,
  latestBatteryPack,
  readKeys,
  buzz,
  stopBuzz,
  setHeartRateProfile,
  writeConfigValue,
  configWriteCommand,
  ConfigWriteError,
  TEST_BUZZ_LOOPS,
  FIND_BAND_LOOPS,
  WARN_BUZZ_LOOPS,
  type KeyKind,
  AlarmError,
  armAlarm,
  cancelAlarm,
  recentAlarmEvents,
  ringAlarm,
  ringAlarmUntilDone,
  EcgError,
  deleteEcgRecording,
  ecgSamples,
  insertEcgRecording,
  listEcgRecordings,
  recordEcg,
  readNightNow,
  stopEcg,
  type EcgSummary,
  rebuildStaleSamples,
  recomputeStaleDays,
  recomputeDays,
  recordHeartRate,
  setPregnancy,
  saveRoute,
  syncHistory,
  validateSleepEdit,
  EDITED_SLEEP_MAX_S,
  MANUAL_NAP_MAX_S,
  updateBodyMeasurement,
  updateLabResult,
  type ActivityInput,
  type ActivityMetricsRecord,
  type ActivityRow,
  type ActivityStore,
  upsertVendorData,
  clearVendorData,
  updatePeriod,
  upsertSymptom,
  updateJournalNote,
  type BandModel,
  type BandStatus,
  type StageEpochRow,
  type BatteryPackState,
  type HeldChunk,
  type BodyImportResult,
  type BodyMeasurement,
  type BodyMeasurementInput,
  type JournalNote,
  type JournalNoteInput,
  type CycleData,
  type CustomExerciseInput,
  type PlannedExercise,
  type StrengthData,
  type StrengthSetInput,
  type StrengthTemplateInput,
  type DayRecord,
  type DeviceRow,
  type ImportedBodyMeasurement,
  type LabResult,
  type LabResultInput,
  type PeriodInput,
  type RoutePoint,
  type SleepEditRow,
  type VendorData,
  type SymptomInput,
  type SyncProgress,
  type SyncStop,
  type Transport,
  buildDonation as buildDonationParts,
  donationCode,
  listDonationDays as listStoredDonationDays,
  type DonationDay,
  type DonationProgress,
} from '@openhoop/core';
import { RawStreamError, afterSignals, computeSessionMotion, imuBetween, insertSignals, listSetMotion, toMotionSecond } from '@openhoop/core';
import type { StrengthSession } from '@openhoop/core';
import { STRENGTH_MOTION, analyseBout, lastBoutBefore } from '@openhoop/analytics';
import type { StreamKind } from '@openhoop/core';
import { spo2Windows } from '@openhoop/analytics';
import type { Profile as AnalyticsProfile } from '@openhoop/analytics';
import { commandName, formatFirmware, type Wrist } from '@openhoop/protocol';
import { SimBand } from '@openhoop/sim';
import Constants from 'expo-constants';
import { getRandomBytes } from 'expo-crypto';
import { Directory } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import { AppState, Platform } from 'react-native';

import { dayEntries, DELETE_UNDO_MS } from './activities';
import { BleManagerTransport } from '@/ble/bleManagerTransport';
import { describePacket, loggedTransport, packetLog } from '@/ble/packetLog';
import { BleError } from '@/ble/errors';
import { detectLanguage, translate, type TranslationKey } from '@/i18n';
import { deviceTzOffsetS, isoDaysAgo, ownerSinceToUnix, todayIsoDate, unixToIsoDate } from '@/lib/dates';
import { isExportType, permissionFor, permissionKey, wantedPermissions, type HcDataType } from '@/lib/healthConnectMapping';
import { digestFacts, goalFacts, localDay, planAlerts, reconcile, stepsGoalFacts, syncFailedAlert, windDownAlert, type Alert, type InboxEntry } from '@/lib/notificationPlan';
import { setThemePreference } from '@/lib/themePreference';
import { alertText } from '@/lib/notificationText';
import { buildWidgetFile } from '@/lib/widgetSnapshot';
import { androidWidgetBridge, type WidgetBridge } from '@/widgets/bridge';
import { setNetworkPrefs } from '@/net';
import { coachActive } from '@/coach/prefs';
import { strictestPrefs } from '@/net/features';

import { applyConfigWrite, buildSnapshot, carryOver, changeFor, parseBandConfig, recordOriginal, serializeSnapshot, type ConfigKind, type WritableValue } from './bandConfig';
import { hrBroadcastKey, parseHrBroadcast, serializeHrBroadcast, type HrBroadcastState } from './hrBroadcast';
import {
  ALARM_PLAN_KEY,
  DEFAULT_ALARM_PLAN,
  alarmTask,
  armedAlarmKey,
  parseAlarmPlan,
  confirmedAlarm,
  followingWakeAt,
  parseArmedAlarm,
  rangForThisAlarm,
  serializeAlarmPlan,
  serializeArmedAlarm,
  type AlarmPlan,
  type ArmedAlarm,
  type WakeOverride,
} from './alarm';
import { CHECK_EVERY_S, LEAVE_TO_BAND_S, REARM_AFTER_S, rearmDue, smartWakeDecision, wakeJob, windowStart } from './smartWake';
import { jetLagWakeOverrides } from './jetLag';
import { smartWakeScheduler, type SmartWakeScheduler } from '@/lib/smartWakeNative';
import { newestChanged } from './bodyComposition';
import { historyDays, pagesRead, RECORDS_PER_PAGE } from './onboarding';
import { openAppStore, type AppStore } from './appStore';
import { storageProblemOf, type StorageProblem } from './storageProblem';
import { readinessNightsLeft } from './progress';
import { loadTargetBand } from './activityDerived';
import { planInputFor } from './planInput';
import { AppError, toAppError } from './errors';
import { exportAll, removeLeftoverExports, type ExportContent } from './exportData';
import { applyRawRetention, retentionChanged } from './rawRetention';
import { deleteAllRawSessions, rawSessionExports } from './rawSessions';
import { OPENHOOP_PACKAGE, nativeHealthConnect, type HealthConnectApi } from './healthConnectApi';
import {
  HEALTH_CONNECT_STATE_KEY,
  defaultHealthConnectState,
  parseHealthConnectState,
  serializeHealthConnectState,
  type HealthConnectState,
} from './healthConnectState';
import { runHealthConnectSync } from './healthConnectSync';
import { switchHealthConnectTypes } from './healthConnectSwitch';
import { removeLeftoverReports } from './reportFiles';
import { removeLeftoverCuffFiles } from './cuffShare';
import { removeLeftoverEcgFiles } from './ecgShare';
import { wipedState } from './wipe';
import {
  NOTIFICATION_STATE_KEY,
  emptyNotificationState,
  parseNotificationState,
  refreshesNotifications,
  serializeNotificationState,
  type NotificationState,
} from './notificationState';
import { expoNotifier, type Notifier, type PermissionState } from './notifier';
import { otherSleepSpans, recomputeFrom, type SleepEditRequest, type EditableSleep } from './sleepEditForm';
import { vendorFrom } from './vendorExport/preview';
import { parseVendorSources } from './vendorExport/sources';
import type { FileReport } from './vendorExport/parse';
import type { SourceFile } from './vendorExport/sources';
import { summariseImport, type VendorImportResult } from './vendorExport/summary';
import { USER_DATA_KEY, defaultUserData, parseUserData, serializeUserData, type UserData } from './userData';
import { buzzIfConnected } from './bandBuzz';
import { LoadBuzzRunner } from './loadBuzzRunner';
import { loadTargetsHidden } from './pregnancyPrefs';
import { changesAppData } from './liveData';
import { IDLE_RAW_LIVE } from './rawLive';
import { activeSession } from './strength';
import type { RawLiveState } from './rawLive';
import { RawStreamManager, StreamBusyError } from './rawStreamManager';
import type { StreamOwner } from './rawStreamPolicy';
import { SETTING_KEYS, parseDataSource, parseLanguage, parseProfile, parseProfileDetails, parseUnits, storeProfile } from './settingsCodec';
import { analyticsProfileOf, emptyProfile, mergeProfile } from './profile';
import { createDonationWorkspace, filePartSink, removeLeftoverDonations, saveDonationParts, sharePartFile, type SaveOutcome } from './donation/files';
import type {
  ActivityDraft,
  AlarmActions,
  AlarmSaveOutcome,
  EcgActions,
  MotionActions,
  MotionState,
  RawStreamActions,
  SetMotionView,
  EcgLiveState,
  AlarmView,
  AppData,
  BandActions,
  BandBuzz,
  BuiltDonation,
  ConnectionState,
  DataSource,
  DeleteTarget,
  DeviceStatus,
  DiscoveredBand,
  HealthConnectView,
  HeartRatePoint,
  Spo2Point,
  LiveState,
  LockState,
  Notice,
  PendingDelete,
  Profile,
  Settings,
  SleepEditOutcome,
  StrengthActions,
  SyncCounts,
  SyncProgressView,
} from './types';

export const DEMO_SEED = 20261125;
export const DEMO_BLE_ID = `sim:${DEMO_SEED}`;
export const DEMO_OWNER_SINCE_DAYS = 10;
export const DEMO_HISTORY_DAYS = 1;
const DAY_S = 86_400;
const SCAN_MS = 6_000;
const PROGRESS_INTERVAL_MS = 250;
const EARLIEST_DAY = '0000-01-01';
const LATEST_DAY = '9999-12-31';
const INCREMENTAL_RECOMPUTE_BACK_S = 2 * DAY_S;
const MAX_DEMO_BACKLOG_DAYS = 20;
export const UNDO_MS = DELETE_UNDO_MS;
const PIN_WAIT_ATTEMPTS = 60;
const PIN_WAIT_MS = 1_000;
const NO_METRICS: ActivityMetricsRecord = { activeS: 0, load: null, loadReason: 'no-data', zoneSeconds: [0, 0, 0, 0, 0, 0], avgHr: null, maxHr: null, hrSeconds: 0, activeMinutes: null };
const STOP_NOTICES: Readonly<Partial<Record<SyncStop, TranslationKey>>> = {
  clock: 'sync.stop.clock',
  corrupt: 'sync.stop.corrupt',
  pending: 'sync.stop.pending',
};

const SPO2_CACHE_NIGHTS = 14;

export interface Snapshot {
  ready: boolean;
  storageProblem: StorageProblem | null;
  days: DayRecord[];
  sleepEdits: SleepEditRow[];
  device: DeviceStatus;
  live: LiveState;
  profile: Profile;
  settings: Settings;
  userData: UserData;
  bodyMeasurements: BodyMeasurement[];
  journalNotes: JournalNote[];
  labResults: LabResult[];
  cuffReadings: CuffReading[];
  vendorData: VendorData;
  cycle: CycleData;
  strength: StrengthData;
  syncProgress: SyncProgressView | null;
  notice: Notice | null;
  inbox: InboxEntry[];
  notificationPermission: PermissionState;
  healthConnect: HealthConnectView;
  activities: ActivityRow[];
  pendingDelete: PendingDelete | null;
  alarm: AlarmView;
  ecgRecordings: EcgSummary[];
  ecgWrist: Wrist;
  ecgLive: EcgLiveState;
  rawLive: RawLiveState;
  motion: MotionState;
}

interface Connection {
  transport: Transport;
  session: Session;
  deviceId: number;
  heldChunk: HeldChunk | null;
}

interface TransferPages {
  total: number | null;
  newestOnBandS: number | null;
  firstSampleS: number | null;
}

export interface SyncTimings {
  transferMs: number;
  computeMs: number;
  samples: number;
  chunks: number;
}

const SYNC_FAILURES_NOT_ALERTED = new Set<TranslationKey>(['error.noBandPaired', 'error.ownerSinceMissing']);

const IDLE_LIVE: LiveState = { active: false, heartRate: null, lastRrMs: null, updatedAt: null, dayLoad: null };
const BUZZ_LOOPS: Readonly<Record<BandBuzz, number>> = { test: TEST_BUZZ_LOOPS, target: TEST_BUZZ_LOOPS, top: WARN_BUZZ_LOOPS, find: FIND_BAND_LOOPS };
const IDLE_ECG: EcgLiveState = { active: false, elapsedMs: 0, samples: 0, tail: [], quality: null };
const ECG_PROGRESS_MS = 200;
const RING_WAIT_MS = 40_000;

const ECG_WRIST_KEY = 'ecg.wrist';

const STREAM_CAP_CHECK_MS = 1_000;
const HIGH_RATE_MOTION_KEY = 'strength.highRateMotion';
const WORKOUT_STREAM_MAX_S = 4 * 3600;
const SET_MOTION_DELAY_MS = 1_500;

function streamProblem(error: unknown): unknown {
  if (error instanceof StreamBusyError) return new AppError('error.streamsBusy');
  if (error instanceof RawStreamError) return new AppError('error.streamRefused');
  return error;
}

function ecgCleanupKey(deviceId: number): string {
  return `ecg.cleanup.${deviceId}`;
}

function emptyDevice(): DeviceStatus {
  return {
    name: null,
    model: null,
    firmware: null,
    batteryPercent: null,
    lastSyncAt: null,
    backlogPages: null,
    lastSyncCounts: null,
    lockState: 'unknown',
    connection: 'disconnected',
    configSnapshot: null,
    batteryPack: null,
    band: null,
    hrBroadcast: null,
  };
}

const CORE_KIND: Readonly<Record<ConfigKind, KeyKind>> = { flag: 'featureFlags', config: 'deviceConfig' };

function alarmProblem(error: unknown): Notice {
  if (error instanceof AlarmError) {
    if (error.reason === 'rejected') return { key: 'alarm.problem.rejected', params: { status: error.status ?? '?' } };
    return { key: error.reason === 'clock-unknown' ? 'alarm.problem.clock' : error.reason === 'too-soon' ? 'alarm.problem.tooSoon' : 'alarm.problem.notArmed' };
  }
  const appError = toAppError(error);
  return { key: appError.key, params: appError.params };
}

function toModel(text: string | null): BandModel | null {
  if (text === null) return null;
  if (/MG/i.test(text)) return 'MG';
  if (/5\.0/.test(text)) return '5.0';
  return null;
}

const DONATION_FOLDER_KEY = 'donation.folderUri';

function removeWorkspace(uri: string): void {
  try {
    const workspace = new Directory(uri);
    if (workspace.exists) workspace.delete();
  } catch {
    // removeLeftoverDonations deletes it on the next start
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class AppController {
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private app: AppStore | null = null;
  private deviceRow: DeviceRow | null = null;
  private spo2Cache: { days: DayRecord[]; nights: Map<string, Spo2Point[]> } | null = null;
  private conn: Connection | null = null;
  private demoBand: SimBand | null = null;
  private bleTransport: BleManagerTransport | null = null;
  private lockState: LockState = 'unknown';
  private connection: ConnectionState = 'disconnected';
  private battery: number | null = null;
  private batteryPack: BatteryPackState | null = null;
  private bandStatus: BandStatus | null = null;
  private hrBroadcast: HrBroadcastState | null = null;
  private backlogPages: number | null = null;
  private lastSyncAt: number | null = null;
  private lastSyncCounts: SyncCounts | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private userDataChain: Promise<void> = Promise.resolve();
  private syncRun: Promise<void> | null = null;
  private liveAbort: AbortController | null = null;
  private liveRun: Promise<void> | null = null;
  private readonly loadBuzz = new LoadBuzzRunner({
    connected: () => this.conn !== null && this.conn.session.isConnected,
    syncing: () => this.syncRun !== null,
    days: () => this.snapshot.days,
    prefs: () => (loadTargetsHidden(this.snapshot.userData.pregnancyPrefs, this.snapshot.cycle) ? { ...this.snapshot.userData.loadBuzz, atTarget: false, overTop: false } : this.snapshot.userData.loadBuzz),
    buzz: (kind) => this.bandActionSet.buzz(kind),
    save: (last) => this.updateUserData({ loadBuzz: { ...this.snapshot.userData.loadBuzz, ...last } }),
    nowMs: () => Date.now(),
    tzOffsetS: (atS) => deviceTzOffsetS(new Date(atS * 1000)),
  });
  private lastProgressAt = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCreated = false;
  private started = false;
  private notificationState: NotificationState = emptyNotificationState();
  private notificationChain: Promise<void> = Promise.resolve();
  private widgetChain: Promise<void> = Promise.resolve();
  private healthConnectChain: Promise<void> = Promise.resolve();
  private healthConnectRun: Promise<void> | null = null;
  lastTimings: SyncTimings | null = null;
  private appDataCache: AppData | null = null;

  constructor(
    private readonly notifier: Notifier = expoNotifier,
    private readonly healthConnect: HealthConnectApi = nativeHealthConnect,
    private readonly widgets: WidgetBridge = androidWidgetBridge,
    private readonly smartWake: SmartWakeScheduler = smartWakeScheduler,
  ) {
    const language = detectLanguage(getLocales()[0]?.languageCode);
    this.snapshot = {
      ready: false,
      storageProblem: null,
      days: [],
      sleepEdits: [],
      device: emptyDevice(),
      live: IDLE_LIVE,
      profile: emptyProfile(),
      settings: { language, dataSource: 'demo', ownerSince: null, units: 'metric' },
      userData: defaultUserData(),
      bodyMeasurements: [],
      journalNotes: [],
      labResults: [],
      cuffReadings: [],
      vendorData: emptyVendorData(),
      cycle: emptyCycleData(),
      strength: emptyStrengthData(),
      syncProgress: null,
      notice: null,
      inbox: [],
      notificationPermission: 'undetermined',
      healthConnect: { availability: 'checking', granted: [], state: defaultHealthConnectState(), syncing: false },
      activities: [],
      pendingDelete: null,
      alarm: { plan: DEFAULT_ALARM_PLAN, armed: null, events: [], problem: null, smartAvailable: false },
      ecgRecordings: [],
      ecgWrist: 'left',
      ecgLive: IDLE_ECG,
      rawLive: IDLE_RAW_LIVE,
      motion: { highRate: false, bandRecording: false, sets: {} },
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  getAppData = (): AppData => {
    this.appDataCache ??= this.appData();
    return this.appDataCache;
  };

  private patch(change: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    if (changesAppData(change)) this.appDataCache = null;
    for (const listener of [...this.listeners]) listener();
  }

  private patchDevice(): void {
    const row = this.deviceRow;
    const source = this.snapshot.settings.dataSource;
    const language = this.snapshot.settings.language;
    this.patch({
      device: {
        name: source === 'demo' ? translate(language, 'band.demoName') : (row?.name ?? null),
        model: row?.model ?? null,
        firmware: row?.firmware ?? null,
        serial: row?.serial ?? null,
        batteryPercent: this.battery,
        lastSyncAt: this.lastSyncAt,
        backlogPages: this.backlogPages,
        lastSyncCounts: this.lastSyncCounts,
        lockState: this.lockState,
        connection: this.connection,
        configSnapshot: row?.configSnapshot ?? null,
        batteryPack: this.batteryPack,
        band: this.bandStatus,
        hrBroadcast: this.hrBroadcast,
      },
    });
  }

  private setConnection(state: ConnectionState): void {
    this.connection = state;
    this.patchDevice();
  }

  private fail(error: unknown): AppError {
    const appError = toAppError(error);
    this.patch({ notice: { key: appError.key, params: appError.params } });
    return appError;
  }

  clearNotice = (): void => {
    this.patch({ notice: null });
  };

  private requireApp(): AppStore {
    if (this.app === null) throw new AppError('error.storage');
    return this.app;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  start(): Promise<void> {
    this.startRun ??= this.startOnce();
    return this.startRun;
  }

  private async startOnce(): Promise<void> {
    if (this.started) return;
    this.started = true;
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void this.streams.background();
    });
    setInterval(() => {
      if (this.streams.active().length > 0) void this.streams.checkCaps();
      if ((this.streams.hasOwner('workout') || this.streams.bandRequested()) && this.workoutSession() === null) void this.syncWorkoutStream();
    }, STREAM_CAP_CHECK_MS);
    try {
      removeLeftoverExports();
      removeLeftoverReports();
      removeLeftoverEcgFiles();
      removeLeftoverCuffFiles();
      removeLeftoverDonations();
    } catch {
      // a leftover export or report is removed again before the next one
    }
    try {
      this.app = await openAppStore();
    } catch (error) {
      this.patch({ ready: true, storageProblem: storageProblemOf(error) });
      this.fail(error instanceof AppError ? error : new AppError('error.storage', undefined, { cause: error }));
      return;
    }
    const { store } = this.app;
    await this.activityStore().purgeDeleted(null);
    const language = parseLanguage(await store.getSetting(SETTING_KEYS.language)) ?? this.snapshot.settings.language;
    const dataSource = parseDataSource(await store.getSetting(SETTING_KEYS.dataSource));
    const units = parseUnits(await store.getSetting(SETTING_KEYS.units));
    const baseProfile = parseProfile(
      await store.getSetting(SETTING_KEYS.birthYear),
      await store.getSetting(SETTING_KEYS.maxHeartRate),
      new Date().getFullYear(),
    );
    const profileDetails = parseProfileDetails(
      {
        birthDate: await store.getSetting(SETTING_KEYS.birthDate),
        restingHeartRate: await store.getSetting(SETTING_KEYS.restingHeartRate),
        zoneMode: await store.getSetting(SETTING_KEYS.zoneMode),
        zoneFloors: await store.getSetting(SETTING_KEYS.zoneFloors),
      },
      todayIsoDate(),
    );
    const profile = mergeProfile(baseProfile, profileDetails);
    const rawUserData = await store.getSetting(USER_DATA_KEY);
    const userData = parseUserData(rawUserData);
    if (rawUserData === null && (await store.listDevices()).length > 0) userData.onboardingDone = true;
    this.notificationState = parseNotificationState(await store.getSetting(NOTIFICATION_STATE_KEY));
    setNetworkPrefs(userData.network);
    setThemePreference(userData.theme);
    const bodyMeasurements = await listBodyMeasurements(this.app.driver);
    const healthConnectState = parseHealthConnectState(await store.getSetting(HEALTH_CONNECT_STATE_KEY));
    const labResults = await listLabResults(this.app.driver);
    const cuffReadings = await listCuffReadings(this.app.driver);
    const vendorData = await listVendorData(this.app.driver);
    const cycle = await loadCycleData(this.app.driver);
    const strength = await listStrengthData(this.app.driver);
    const journalNotes = await listJournalNotes(this.app.driver);
    this.patch({
      settings: { ...this.snapshot.settings, language, dataSource, units },
      profile,
      userData,
      bodyMeasurements,
      journalNotes,
      labResults,
      cuffReadings,
      vendorData,
      cycle,
      inbox: this.notificationState.inbox,
      healthConnect: { ...this.snapshot.healthConnect, state: healthConnectState },
      strength,
      alarm: { ...this.snapshot.alarm, plan: parseAlarmPlan(await store.getSetting(ALARM_PLAN_KEY)), smartAvailable: this.smartWake.available() },
      ecgWrist: (await store.getSetting(ECG_WRIST_KEY)) === 'right' ? 'right' : 'left',
      motion: { ...this.snapshot.motion, highRate: (await store.getSetting(HIGH_RATE_MOTION_KEY)) === '1' },
    });
    if (dataSource === 'band') await this.purgeDemoRecordings();
    await this.loadActiveDevice();
    this.patch({ ready: true });
    void this.refreshSetMotion();
    void this.syncWorkoutStream();
    void this.exclusive(() => this.redecodeStoredSamples());
    void this.exclusive(() => this.pruneRaw());
    void this.refreshNotifications();
    void this.refreshHealthConnect();
    if (dataSource === 'demo') void this.sync();
  }

  private async loadBandReports(deviceId: number): Promise<void> {
    const { store } = this.requireApp();
    this.batteryPack = await latestBatteryPack(store, deviceId);
    this.bandStatus = await latestBandStatus(store, deviceId);
  }

  private async redecodeStoredSamples(): Promise<void> {
    try {
      const { store } = this.requireApp();
      const rebuilt = await rebuildStaleSamples(store, (deviceId) => this.recompute(deviceId, null));
      const recomputed = await recomputeStaleDays(store, (deviceId) => (rebuilt.includes(deviceId) ? Promise.resolve() : this.recompute(deviceId, null)));
      for (const deviceId of rebuilt) {
        await this.afterSignalsFor(deviceId, { from: 0, to: nowSeconds() + DAY_S }, 0).catch((error: unknown) => {
          this.fail(error);
        });
      }
      if (rebuilt.length === 0 && recomputed.length === 0) return;
      if (this.deviceRow !== null) await this.loadBandReports(this.deviceRow.id);
      this.patch({ syncProgress: null });
      this.patchDevice();
    } catch (error) {
      this.patch({ syncProgress: null });
      this.fail(error);
    }
  }

  private async purgeDemoRecordings(): Promise<void> {
    const { store } = this.requireApp();
    const demo = (await store.listDevices()).find((row) => row.bleId === DEMO_BLE_ID);
    if (demo !== undefined) await store.deleteRecordings(demo.id);
  }

  private async activeBleId(): Promise<string | null> {
    if (this.snapshot.settings.dataSource === 'demo') return DEMO_BLE_ID;
    return this.requireApp().store.getSetting(SETTING_KEYS.bandBleId);
  }

  private async loadActiveDevice(): Promise<void> {
    const { store } = this.requireApp();
    const bleId = await this.activeBleId();
    const rows = await store.listDevices();
    this.deviceRow = rows.find((row) => row.bleId === bleId) ?? null;
    this.lockState = 'unknown';
    this.battery = null;
    this.backlogPages = null;
    this.lastSyncAt = null;
    this.lastSyncCounts = null;
    this.batteryPack = null;
    this.bandStatus = null;
    this.hrBroadcast = null;
    let armed: ArmedAlarm | null = null;
    let alarmEvents: AlarmView['events'] = [];
    let ecgRecordings: EcgSummary[] = [];
    let ownerSince: string | null = null;
    if (this.deviceRow !== null) {
      await this.loadBandReports(this.deviceRow.id);
      this.hrBroadcast = parseHrBroadcast(await store.getSetting(hrBroadcastKey(this.deviceRow.id)));
      armed = parseArmedAlarm(await store.getSetting(armedAlarmKey(this.deviceRow.id)));
      alarmEvents = await recentAlarmEvents(store, this.deviceRow.id);
      ecgRecordings = await listEcgRecordings(store.driver, this.deviceRow.id);
      const state = await store.getSyncState(this.deviceRow.id);
      this.lastSyncAt = state?.lastSyncAt ?? null;
      const savedLock = await store.getSetting(this.lockKey(this.deviceRow.id));
      if (savedLock === 'open' || savedLock === 'locked' || savedLock === 'no-data') this.lockState = savedLock;
      if (this.deviceRow.ownerSince !== null) {
        ownerSince = unixToIsoDate(this.deviceRow.ownerSince, deviceTzOffsetS(new Date()));
      }
    }
    this.patch({ settings: { ...this.snapshot.settings, ownerSince }, alarm: { ...this.snapshot.alarm, armed, events: alarmEvents, problem: null }, ecgRecordings });
    this.patchDevice();
    await this.refreshDays();
  }

  private lockKey(deviceId: number): string {
    return `lock.${deviceId}`;
  }

  private async refreshDays(): Promise<void> {
    const { store } = this.requireApp();
    const row = this.deviceRow;
    const days = row === null ? [] : await store.listDays(row.id, EARLIEST_DAY, LATEST_DAY);
    const sleepEdits = row === null ? [] : await store.listSleepEdits(row.id);
    const activities = row === null ? [] : await this.activityStore().list(row.id);
    this.patch({ days, sleepEdits, activities });
    void this.refreshWidgets();
  }

  private activityStore(): ActivityStore {
    return bindActivityStore(this.requireApp().store.driver);
  }

  private async loadActivities(): Promise<void> {
    const activities = this.deviceRow === null ? [] : await this.activityStore().list(this.deviceRow.id);
    this.patch({ activities });
  }

  private async metricsFor(deviceId: number, input: ActivityInput, days: readonly DayRecord[]): Promise<ActivityMetricsRecord> {
    const year = new Date(input.start * 1000).getFullYear();
    const ref = loadReference(days, this.analyticsProfile(), input.start, year);
    return computeActivityMetrics(this.requireApp().store, deviceId, { start: input.start, end: input.end }, input.paused, ref);
  }

  private async refreshActivityMetrics(deviceId: number, from: number | null): Promise<void> {
    const activities = this.activityStore();
    const stale = (await activities.list(deviceId)).filter((row) => row.deletedAt === null && (from === null || row.end >= from));
    if (stale.length === 0) return;
    const days = await this.requireApp().store.listDays(deviceId, EARLIEST_DAY, LATEST_DAY);
    for (const row of stale) await activities.setMetrics(row.id, await this.metricsFor(deviceId, row, days));
  }

  private analyticsProfile(): AnalyticsProfile {
    return analyticsProfileOf(this.snapshot.profile);
  }

  private createDemoBand(newestSampleT: number | null): SimBand {
    const nowS = nowSeconds();
    const earliest = nowS - MAX_DEMO_BACKLOG_DAYS * DAY_S;
    const wanted =
      newestSampleT === null ? nowS - DEMO_HISTORY_DAYS * DAY_S + 1 : Math.max(newestSampleT + 1, earliest);
    const historyDays = (nowS - wanted + 1.5) / DAY_S;
    return new SimBand({ seed: DEMO_SEED, now: () => Date.now() / 1000, historyDays });
  }

  private async transportFor(source: DataSource): Promise<Transport> {
    if (source === 'demo') {
      if (this.demoBand === null) {
        const { store } = this.requireApp();
        const state = this.deviceRow === null ? null : await store.getSyncState(this.deviceRow.id);
        this.demoBand = this.createDemoBand(state?.newestSampleT ?? null);
      }
      return this.demoBand;
    }
    if (this.bleTransport === null) this.bleTransport = new BleManagerTransport();
    return this.bleTransport;
  }

  private async dropConnection(): Promise<void> {
    const conn = this.conn;
    this.conn = null;
    this.streams.detach();
    if (conn === null) return;
    try {
      await conn.session.close();
      await conn.transport.disconnect();
    } catch {
      // the link is already gone
    }
  }

  private async openConnection(bleId: string, ownerSinceUnix: number | null): Promise<Connection> {
    const { store } = this.requireApp();
    const source = this.snapshot.settings.dataSource;
    const existing = (await store.listDevices()).find((row) => row.bleId === bleId) ?? null;
    const ownerSince = ownerSinceUnix ?? existing?.ownerSince ?? null;
    if (source === 'band' && ownerSince === null) throw new AppError('error.ownerSinceMissing');
    this.setConnection('connecting');
    const transport = await this.transportFor(source);
    try {
      await transport.connect(bleId);
      if ((await transport.bond()) === 'refused') throw new BleError('bond-refused');
      const info = await readDeviceInformation(transport);
      const logged = loggedTransport(transport);
      const session = new Session(logged, { now: () => Date.now() });
      session.onPacket((packet, raw) => {
        packetLog.record('rx', describePacket(packet), raw);
        this.streams.onPacket(session, packet);
      });
      const hello = await session.open();
      const row = await store.upsertDevice({
        bleId,
        name: source === 'demo' ? 'WHOOP SIM' : (info.model ?? existing?.name ?? null),
        model: toModel(info.model) ?? existing?.model ?? null,
        firmware: formatFirmware(hello.firmware),
        serial: info.serial ?? existing?.serial ?? null,
        ownerSince,
        configSnapshot: existing?.configSnapshot ?? null,
      });
      this.deviceRow = row;
      if (row.ownerSince !== null) {
        const ownerSinceIso = unixToIsoDate(row.ownerSince, deviceTzOffsetS(new Date()));
        this.patch({ settings: { ...this.snapshot.settings, ownerSince: ownerSinceIso } });
      }
      session.onDisconnect(() => {
        if (this.conn?.session === session) this.conn = null;
        this.connection = 'disconnected';
        this.patchDevice();
      });
      const conn: Connection = { transport: logged, session, deviceId: row.id, heldChunk: null };
      this.conn = conn;
      if ((await store.getSetting(ecgCleanupKey(row.id))) === '1' && (await stopEcg(session))) {
        await store.setSetting(ecgCleanupKey(row.id), '');
      }
      await this.streams.attach(conn);
      this.battery = await session.battery().catch(() => hello.batteryPercent);
      this.setConnection('connected');
      return conn;
    } catch (error) {
      this.conn = null;
      try {
        await transport.disconnect();
      } catch {
        // nothing to clean up
      }
      this.setConnection('disconnected');
      throw error;
    }
  }

  private async ensureConnection(): Promise<Connection> {
    if (this.conn !== null && this.conn.session.isConnected) return this.conn;
    await this.dropConnection();
    const bleId = await this.activeBleId();
    if (bleId === null) throw new AppError('error.noBandPaired');
    const ownerSince =
      this.deviceRow === null && this.snapshot.settings.dataSource === 'demo'
        ? (ownerSinceToUnix(isoDaysAgo(nowSeconds(), DEMO_OWNER_SINCE_DAYS, deviceTzOffsetS(new Date())), deviceTzOffsetS(new Date())))
        : null;
    const firmwareBefore = this.deviceRow?.bleId === bleId ? this.deviceRow.firmware : null;
    const conn = await this.openConnection(bleId, ownerSince);
    if (needsLockProbe(this.lockState, firmwareBefore, this.deviceRow?.firmware ?? null)) await this.probe(conn);
    return conn;
  }

  private async probe(conn: Connection): Promise<void> {
    this.patch({ syncProgress: this.progressView('probing', 0, null, 0, 0) });
    try {
      const result = await probeLock(conn.session);
      conn.heldChunk = result.heldChunk;
      this.lockState = result.state;
      await this.requireApp().store.setSetting(this.lockKey(conn.deviceId), result.state);
      this.backlogPages = result.pagesBehind;
    } finally {
      this.patch({ syncProgress: null });
      this.patchDevice();
    }
  }

  private progressView(
    phase: SyncProgressView['phase'],
    chunks: number,
    percent: number | null,
    daysDone: number,
    daysTotal: number,
  ): SyncProgressView {
    return { phase, chunks, percent, daysDone, daysTotal };
  }

  sync = (): Promise<void> => {
    if (this.syncRun !== null) return this.syncRun;
    if (this.streams.hasOwner('developer')) {
      this.fail(new AppError('error.syncStreamsOn'));
      return Promise.resolve();
    }
    const run = this.exclusive(() => this.runSync()).then(
      () => {
        if (this.snapshot.healthConnect.state.afterBandSync && this.snapshot.settings.dataSource === 'band') void this.syncHealthConnect();
      },
      () => undefined,
    ).finally(() => {
      this.syncRun = null;
      void this.loadBuzz.check(this.loadBuzz.todayLoad());
    });
    this.syncRun = run;
    return run;
  };

  private async runSync(): Promise<void> {
    await this.stopLiveInternal();
    const { store } = this.requireApp();
    let failed = false;
    try {
      this.lastSyncCounts = null;
      this.patch({ notice: null, syncProgress: this.progressView('connecting', 0, null, 0, 0) });
      await this.requireOwnerSince();
      const conn = await this.ensureConnection();
      const deviceId = conn.deviceId;
      const before = await store.getSyncState(deviceId);
      const previousNewest = before?.newestSampleT ?? null;
      let backlogRecords: number | null = null;
      const pages: TransferPages = { total: null, newestOnBandS: null, firstSampleS: null };
      try {
        const range = await conn.session.dataRange();
        this.backlogPages = range.pagesBehind;
        pages.total = range.pagesBehind;
        pages.newestOnBandS = range.newestUnix;
        backlogRecords = range.pagesBehind === null ? null : range.pagesBehind * RECORDS_PER_PAGE;
      } catch {
        backlogRecords = null;
      }
      this.setConnection('syncing');
      const startedAt = Date.now();
      this.patch({ syncProgress: this.progressView('transfer', 0, 0, 0, 0) });
      const heldChunk = conn.heldChunk;
      conn.heldChunk = null;
      const result = await syncHistory(conn.session, store, {
        deviceId,
        heldChunk,
        onProgress: (progress) => this.onTransferProgress(progress, backlogRecords, pages),
      });
      const transferMs = Date.now() - startedAt;
      this.lastSyncCounts = { saved: result.samples, discarded: result.discardedBeforeOwner };
      if (result.stoppedBy === 'locked') {
        this.lockState = 'locked';
        await store.setSetting(this.lockKey(deviceId), 'locked');
      } else if (result.stoppedBy === 'complete') {
        this.backlogPages = 0;
      }
      const computeStarted = Date.now();
      await this.recompute(deviceId, previousNewest === null ? null : previousNewest - INCREMENTAL_RECOMPUTE_BACK_S);
      await this.pruneRaw();
      await this.loadBandReports(deviceId);
      await this.syncAlarm(conn);
      if (result.signalRange !== null) {
        await this.afterSignalsFor(deviceId, result.signalRange, conn.session.clockOffsetS() ?? 0).catch((error: unknown) => {
          this.fail(error);
        });
      }
      const computeMs = Date.now() - computeStarted;
      const after = await store.getSyncState(deviceId);
      this.lastSyncAt = after?.lastSyncAt ?? this.lastSyncAt;
      this.lastTimings = { transferMs, computeMs, samples: result.samples, chunks: result.chunks };
      if (__DEV__) console.log(`openhoop sync timings: ${JSON.stringify(this.lastTimings)}`);
      if (conn.session.isConnected) this.battery = await conn.session.battery().catch(() => this.battery);
      if (result.stoppedBy === 'disconnect') throw new AppError('error.disconnected');
      if (result.stoppedBy === 'idle' && result.chunks === 0) throw new AppError('sync.stop.idle');
      const stopNotice = STOP_NOTICES[result.stoppedBy];
      if (stopNotice !== undefined) throw new AppError(stopNotice);
    } catch (error) {
      const appError = this.fail(error);
      failed = !this.quietSync && this.snapshot.settings.dataSource === 'band' && !SYNC_FAILURES_NOT_ALERTED.has(appError.key);
      throw appError;
    } finally {
      void this.refreshNotifications({ syncFailed: failed });
      void this.refreshWidgets();
      if (this.connection === 'syncing') this.connection = this.conn?.session.isConnected === true ? 'connected' : 'disconnected';
      this.patch({ syncProgress: null });
      this.patchDevice();
    }
  }

  private async requireOwnerSince(): Promise<void> {
    if (this.snapshot.settings.dataSource !== 'band') return;
    const bleId = await this.activeBleId();
    if (bleId === null) return;
    const row = (await this.requireApp().store.listDevices()).find((device) => device.bleId === bleId) ?? null;
    if (row !== null && row.ownerSince === null) throw new AppError('error.ownerSinceMissing');
  }

  private onTransferProgress(progress: SyncProgress, backlogRecords: number | null, pages: TransferPages): void {
    if (pages.firstSampleS === null && progress.newestSampleT !== null) pages.firstSampleS = progress.newestSampleT;
    const now = Date.now();
    if (now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.lastProgressAt = now;
    const processed = progress.frames + progress.discardedBeforeOwner;
    const percent =
      backlogRecords === null || backlogRecords === 0 ? null : Math.min(99, Math.floor((processed / backlogRecords) * 100));
    this.patch({
      syncProgress: {
        ...this.progressView('transfer', progress.chunks, percent, 0, 0),
        pagesRead: pagesRead(processed, pages.total),
        pagesTotal: pages.total,
        historyDays: historyDays(pages.firstSampleS, pages.newestOnBandS ?? nowSeconds()),
      },
    });
  }

  private async recompute(deviceId: number, from: number | null): Promise<void> {
    const { store } = this.requireApp();
    this.patch({ syncProgress: this.progressView('compute', this.snapshot.syncProgress?.chunks ?? 0, null, 0, 0) });
    await recomputeDays(store, {
      deviceId,
      from: from ?? 0,
      to: Number.MAX_SAFE_INTEGER,
      profile: this.analyticsProfile(),
      tzOffsetS: deviceTzOffsetS(new Date()),
    });
    await this.refreshActivityMetrics(deviceId, from);
    await this.refreshDays();
  }

  scan = async (): Promise<DiscoveredBand[]> => {
    try {
      const source = this.snapshot.settings.dataSource;
      const transport = await this.transportFor(source);
      const found = await transport.scan(SCAN_MS);
      return found.map((device) => ({ id: device.id, name: device.name ?? device.id, rssi: device.rssi ?? 0 }));
    } catch (error) {
      throw toAppError(error);
    }
  };

  pair = (bandId: string, ownerSince: string): Promise<void> =>
    this.exclusive(async () => {
      const tz = deviceTzOffsetS(new Date());
      const ownerSinceUnix = ownerSinceToUnix(ownerSince, tz);
      if (ownerSinceUnix === null) throw new AppError('pairing.sinceInvalid');
      const { store } = this.requireApp();
      await this.stopLiveInternal();
      await this.dropConnection();
      try {
        const conn = await this.openConnection(bandId, ownerSinceUnix);
        if (this.snapshot.settings.dataSource === 'band') await store.setSetting(SETTING_KEYS.bandBleId, bandId);
        await this.loadActiveDevice();
        await this.probe(conn);
      } catch (error) {
        throw toAppError(error);
      }
    });

  private async stopLiveInternal(): Promise<void> {
    const abort = this.liveAbort;
    if (abort === null) return;
    abort.abort();
    try {
      await this.liveRun;
    } catch {
      // the recorder already reported its failure through the live state
    }
  }

  startLive = async (): Promise<void> => {
    if (this.liveAbort !== null) return;
    if (this.syncRun !== null) {
      this.fail(new AppError('error.busySyncing'));
      return;
    }
    const abort = new AbortController();
    this.liveAbort = abort;
    try {
      const conn = await this.exclusive(() => this.ensureConnection());
      const { store } = this.requireApp();
      this.patch({ live: { active: true, heartRate: null, lastRrMs: null, updatedAt: null, dayLoad: null } });
      this.liveRun = recordHeartRate(conn.transport, store, {
        deviceId: conn.deviceId,
        signal: abort.signal,
        onBeat: (heartRate, rrMs) =>
          this.patch({
            live: { active: true, heartRate, lastRrMs: rrMs[rrMs.length - 1] ?? null, updatedAt: Date.now(), dayLoad: this.snapshot.live.dayLoad ?? null },
          }),
      }).then(
        () => undefined,
        (error: unknown) => {
          this.fail(error);
        },
      );
      void this.liveRun.finally(() => {
        if (this.liveAbort === abort) this.liveAbort = null;
        this.patch({ live: IDLE_LIVE });
      });
    } catch (error) {
      this.liveAbort = null;
      this.patch({ live: IDLE_LIVE });
      this.fail(error);
    }
  };

  reportLiveLoad = (dayLoad: number | null): void => {
    if (this.liveAbort === null) return;
    const value = this.loadBuzz.live(dayLoad);
    if ((this.snapshot.live.dayLoad ?? null) !== value) this.patch({ live: { ...this.snapshot.live, dayLoad: value } });
  };

  readBandConfig = async (): Promise<void> => {
    if (this.syncRun !== null || this.liveAbort !== null) {
      this.fail(new AppError('error.bandConfigBusy'));
      return;
    }
    try {
      await this.exclusive(async () => {
        const conn = await this.ensureConnection();
        const flags = await readKeys(conn.session, 'featureFlags');
        const config = await readKeys(conn.session, 'deviceConfig');
        if (flags.length + config.length === 0) throw new AppError('error.bandConfigEmpty');
        const fresh = buildSnapshot(nowSeconds(), this.snapshot.settings.dataSource, flags, config);
        const previous = parseBandConfig(this.deviceRow?.configSnapshot ?? null);
        await this.storeConfigSnapshot(serializeSnapshot(carryOver(previous.status === 'ok' ? previous.snapshot : null, fresh)));
      });
    } catch (error) {
      this.fail(error);
    }
  };

  private async storeConfigSnapshot(json: string): Promise<void> {
    const row = this.deviceRow;
    if (row === null) throw new AppError('error.noBandPaired');
    this.deviceRow = await this.requireApp().store.upsertDevice({
      bleId: row.bleId,
      name: row.name,
      model: row.model,
      firmware: row.firmware,
      serial: row.serial,
      ownerSince: row.ownerSince,
      configSnapshot: json,
    });
    this.patchDevice();
  }

  private async onBand(task: (conn: Connection) => Promise<void>, blockDuringLive: boolean): Promise<boolean> {
    if (this.syncRun !== null || (blockDuringLive && this.liveAbort !== null)) {
      this.fail(new AppError('error.bandBusy'));
      return false;
    }
    try {
      await this.exclusive(async () => task(await this.ensureConnection()));
      return true;
    } catch (error) {
      if (error instanceof AlarmError) this.patch({ notice: alarmProblem(error) });
      else this.fail(error instanceof ConfigWriteError ? new AppError(error.reason === 'not-writable' ? 'error.configNotWritable' : 'error.configNotApplied') : error);
      return false;
    }
  }

  private async syncAlarm(conn: Connection): Promise<void> {
    const { store } = this.requireApp();
    if (conn.session.isConnected) {
      try {
        await this.applyAlarm(conn);
      } catch (error) {
        this.patchAlarm({ problem: alarmProblem(error) });
      }
    }
    this.patchAlarm({ events: await recentAlarmEvents(store, conn.deviceId) });
  }

  private async applyAlarm(conn: Connection): Promise<void> {
    const { store } = this.requireApp();
    const { plan, armed } = this.snapshot.alarm;
    const task = alarmTask(plan, armed, new Date(), this.alarmOverrides());
    if (task.kind === 'arm') {
      const attempt: ArmedAlarm = { wakeAt: task.wakeAt, armedAt: nowSeconds(), confirmed: false, rangEarlyAt: null };
      await store.setSetting(armedAlarmKey(conn.deviceId), serializeArmedAlarm(attempt));
      this.patchAlarm({ armed: attempt });
      const reading = await armAlarm(conn.session, task.wakeAt, nowSeconds());
      const next: ArmedAlarm = { wakeAt: reading.wakeAt, armedAt: nowSeconds(), confirmed: true, rangEarlyAt: null };
      await store.setSetting(armedAlarmKey(conn.deviceId), serializeArmedAlarm(next));
      this.patchAlarm({ armed: next, problem: null });
    } else if (task.kind === 'cancel') {
      await cancelAlarm(conn.session);
      await store.setSetting(armedAlarmKey(conn.deviceId), '');
      this.patchAlarm({ armed: null, problem: null });
    } else {
      this.patchAlarm({ problem: null });
    }
    this.scheduleSmartWake();
  }

  private alarmOverrides(): WakeOverride[] {
    const { jetLagPlan, jetLagShiftAlarm } = this.snapshot.userData;
    return jetLagShiftAlarm && jetLagPlan !== null ? jetLagWakeOverrides(jetLagPlan) : [];
  }

  private reapplyAlarm = async (): Promise<void> => {
    const { plan, armed } = this.snapshot.alarm;
    if ((!plan.enabled && armed === null) || this.syncRun !== null || this.app === null) return;
    try {
      await this.exclusive(async () => this.applyAlarm(await this.ensureConnection()));
    } catch (error) {
      this.patchAlarm({ problem: alarmProblem(error) });
    }
  };

  private smartAlarm(): { plan: AlarmPlan & { mode: 'goal' | 'window' }; live: ArmedAlarm } | null {
    const { plan, armed } = this.snapshot.alarm;
    const live = confirmedAlarm(armed, nowSeconds());
    if (!plan.enabled || plan.mode === 'exact' || live === null || !this.snapshot.alarm.smartAvailable) return null;
    return { plan: { ...plan, mode: plan.mode }, live };
  }

  private scheduleSmartWake(): void {
    const { plan, armed, smartAvailable } = this.snapshot.alarm;
    const job = wakeJob(plan, armed, nowSeconds(), smartAvailable);
    if (job === null) this.smartWake.cancel();
    else if (job.kind === 'smart') this.queueSmartCheck(job.at);
    else this.queueRearm(job.at);
  }

  private queueSmartCheck(atS: number): void {
    const language = this.snapshot.settings.language;
    this.smartWake.schedule(atS, translate(language, 'alarm.smart.notifyTitle'), translate(language, 'alarm.smart.notifyBody'));
  }

  private queueRearm(atS: number): void {
    const language = this.snapshot.settings.language;
    this.smartWake.schedule(atS, translate(language, 'alarmx.rearmTitle'), translate(language, 'alarmx.rearmBody'));
  }

  smartWakeCheck = async (): Promise<void> => {
    if (rearmDue(this.snapshot.alarm.plan, this.snapshot.alarm.armed, nowSeconds())) {
      this.quietSync = true;
      try {
        await this.sync();
      } catch (error) {
        this.patchAlarm({ problem: alarmProblem(error) });
      } finally {
        this.quietSync = false;
      }
      return;
    }
    const before = this.smartAlarm();
    if (before === null || rangForThisAlarm(before.live)) {
      this.smartWake.cancel();
      return;
    }
    const lastChance = before.live.wakeAt - LEAVE_TO_BAND_S;
    const safetyNet = Math.max(nowSeconds() + CHECK_EVERY_S, windowStart(before.plan.mode, before.live.wakeAt, before.plan.windowMin));
    if (safetyNet < lastChance) this.queueSmartCheck(safetyNet);
    try {
      this.quietSync = true;
      try {
        await this.sync();
      } finally {
        this.quietSync = false;
      }
      const smart = this.smartAlarm();
      if (smart === null || rangForThisAlarm(smart.live)) {
        this.smartWake.cancel();
        return;
      }
      const deviceId = this.deviceRow?.id;
      if (deviceId === undefined) return;
      const nowS = nowSeconds();
      const night = await readNightNow(this.requireApp().store, deviceId, nowS);
      const today = this.snapshot.days[this.snapshot.days.length - 1];
      const decision = smartWakeDecision({
        mode: smart.plan.mode,
        wakeAt: smart.live.wakeAt,
        windowMin: smart.plan.windowMin,
        nowS,
        recent: night.recent,
        awake: night.awake,
        asleepS: night.asleepS,
        needS: today?.sleep.need.value ?? null,
      });
      if (decision.kind === 'check') this.queueSmartCheck(decision.at);
      else if (decision.kind === 'band') this.queueRearm(smart.live.wakeAt + REARM_AFTER_S);
      else await this.ringSmartWake(smart.plan, smart.live);
    } catch (error) {
      this.patchAlarm({ problem: alarmProblem(error) });
    }
  };

  private async ringSmartWake(plan: AlarmPlan, live: ArmedAlarm): Promise<void> {
    await this.exclusive(async () => {
      const conn = await this.ensureConnection();
      const { store } = this.requireApp();
      const result = await ringAlarmUntilDone(conn.session, RING_WAIT_MS);
      if (!result.played) throw new AppError('alarm.problem.notRung');
      const rangAt = nowSeconds();
      const rang: ArmedAlarm = { ...live, rangEarlyAt: rangAt };
      await store.setSetting(armedAlarmKey(conn.deviceId), serializeArmedAlarm(rang));
      this.patchAlarm({ armed: rang, problem: null });
      this.smartWake.cancel();
      const following = followingWakeAt(plan.minutes, live.wakeAt, plan.days, this.alarmOverrides());
      try {
        const reading = await armAlarm(conn.session, following, nowSeconds());
        const next: ArmedAlarm = { wakeAt: reading.wakeAt, armedAt: nowSeconds(), confirmed: true, rangEarlyAt: rangAt };
        await store.setSetting(armedAlarmKey(conn.deviceId), serializeArmedAlarm(next));
        this.patchAlarm({ armed: next });
        this.scheduleSmartWake();
      } catch (error) {
        this.patchAlarm({ problem: alarmProblem(error) });
      }
    });
  }

  private patchAlarm(patch: Partial<AlarmView>): void {
    this.patch({ alarm: { ...this.snapshot.alarm, ...patch } });
  }

  private readonly alarmActionSet: AlarmActions = {
    save: async (plan: AlarmPlan): Promise<AlarmSaveOutcome> => {
      await this.requireApp().store.setSetting(ALARM_PLAN_KEY, serializeAlarmPlan(plan));
      this.patchAlarm({ plan });
      if (this.syncRun !== null) return 'pending';
      try {
        await this.exclusive(async () => this.applyAlarm(await this.ensureConnection()));
        return 'on-band';
      } catch (error) {
        this.patchAlarm({ problem: alarmProblem(error) });
        return 'pending';
      }
    },
    ring: () => this.onBand(async (conn) => void (await ringAlarm(conn.session)), false),
  };

  private ecgAbort: AbortController | null = null;
  private readonly streams = new RawStreamManager({
    exclusive: (task) => this.exclusive(task),
    current: () => this.conn,
    connect: () => this.ensureConnection(),
    getSetting: (key) => this.requireApp().store.getSetting(key),
    setSetting: (key, value) => this.requireApp().store.setSetting(key, value),
    busy: () => ({ ecg: this.ecgAbort !== null, syncing: this.syncRun !== null }),
    storeImu: (deviceId, second) => {
      const row = { deviceId, t: Math.floor(second.t), rateHz: second.rateHz, accel: second.accel, gyro: second.gyro };
      void insertSignals(this.requireApp().store.driver, { imu: [row], optical: [] }, null).catch((error: unknown) => this.fail(error));
    },
    publish: (state) => this.patch({ rawLive: state }),
    report: (error) => this.fail(streamProblem(error)),
    now: () => Date.now(),
  });

  private readonly rawStreamSet: RawStreamActions = {
    start: (owner: StreamOwner, kinds: readonly StreamKind[]) => this.streams.start(owner, kinds),
    stop: (owner: StreamOwner, kinds?: readonly StreamKind[]) => this.streams.stop(owner, kinds),
    setBandRecording: (on: boolean) => this.streams.setBandRecording(on),
    imuSeconds: () => this.streams.imuSeconds(),
    opticalSeconds: () => this.streams.opticalSeconds(),
  };
  private startRun: Promise<void> | null = null;
  private quietSync = false;

  private readonly ecgActionSet: EcgActions = {
    start: (wrist: Wrist) => this.startEcg(wrist),
    stop: () => this.ecgAbort?.abort(),
    samples: async (id: number) => ecgSamples(this.requireApp().store.driver, id),
    remove: async (id: number) => {
      const { store } = this.requireApp();
      const removed = await deleteEcgRecording(store.driver, id);
      if (this.deviceRow !== null) this.patch({ ecgRecordings: await listEcgRecordings(store.driver, this.deviceRow.id) });
      return removed;
    },
    setSymptoms: async (id: number, symptoms: readonly EcgSymptom[]) => {
      try {
        const { store } = this.requireApp();
        const saved = await setEcgSymptoms(store.driver, id, symptoms);
        if (this.deviceRow !== null) this.patch({ ecgRecordings: await listEcgRecordings(store.driver, this.deviceRow.id) });
        return saved;
      } catch (error) {
        this.fail(error);
        return false;
      }
    },
  };

  private async startEcg(wrist: Wrist): Promise<number | null> {
    if (this.syncRun !== null || this.liveAbort !== null || this.ecgAbort !== null) {
      this.fail(new AppError('error.bandBusy'));
      return null;
    }
    if (this.streams.active().length > 0) {
      this.fail(new AppError('error.ecgStreamsOn'));
      return null;
    }
    const abort = new AbortController();
    this.ecgAbort = abort;
    this.patch({ ecgLive: { ...IDLE_ECG, active: true } });
    let lastProgress = 0;
    try {
      return await this.exclusive(async () => {
        const conn = await this.ensureConnection();
        const { store } = this.requireApp();
        await store.setSetting(ecgCleanupKey(conn.deviceId), '1');
        const capture = await recordEcg(conn.session, {
          wrist,
          signal: abort.signal,
          onProgress: (progress) => {
            const now = Date.now();
            if (now - lastProgress < ECG_PROGRESS_MS) return;
            lastProgress = now;
            this.patch({ ecgLive: { active: true, elapsedMs: progress.elapsedMs, samples: progress.samples, tail: progress.tail, quality: progress.quality } });
          },
        });
        if (capture.stopConfirmed) await store.setSetting(ecgCleanupKey(conn.deviceId), '');
        await store.setSetting(ECG_WRIST_KEY, wrist);
        this.patch({ ecgWrist: wrist });
        const id = await insertEcgRecording(store.driver, conn.deviceId, capture);
        this.patch({ ecgRecordings: await listEcgRecordings(store.driver, conn.deviceId) });
        return id;
      });
    } catch (error) {
      if (error instanceof EcgError && error.reason === 'cancelled') return null;
      this.fail(error instanceof EcgError ? new AppError(error.reason === 'unsupported' ? 'ecg.problem.unsupported' : 'ecg.problem.noSignal') : error);
      return null;
    } finally {
      this.ecgAbort = null;
      this.patch({ ecgLive: IDLE_ECG });
    }
  }

  private readonly bandActionSet: BandActions = {
    buzz: (kind: BandBuzz) => this.onBand((conn) => buzz(conn.session, BUZZ_LOOPS[kind]), false),
    buzzIfConnected: (kind: BandBuzz) => {
      const conn = this.conn;
      return buzzIfConnected({
        connected: () => conn !== null && this.conn === conn && conn.session.isConnected,
        syncing: () => this.syncRun !== null,
        exclusive: (task) => this.exclusive(task),
        buzz: async () => {
          if (conn !== null) await buzz(conn.session, BUZZ_LOOPS[kind]);
        },
      });
    },
    stopBuzz: () => this.onBand((conn) => stopBuzz(conn.session), false),
    setHeartRateBroadcast: (on: boolean) =>
      this.onBand(async (conn) => {
        await setHeartRateProfile(conn.session, on);
        const state: HrBroadcastState = { on, at: nowSeconds() };
        await this.requireApp().store.setSetting(hrBroadcastKey(conn.deviceId), serializeHrBroadcast(state));
        this.hrBroadcast = state;
        this.patchDevice();
      }, true),
    writeConfig: (kind: ConfigKind, key: string, value: WritableValue) => this.onBand((conn) => this.writeConfigOn(conn, kind, key, value), true),
    restoreConfig: (kind: ConfigKind, key: string) =>
      this.onBand(async (conn) => {
        const state = parseBandConfig(this.deviceRow?.configSnapshot ?? null);
        const change = state.status === 'ok' ? changeFor(state.snapshot, kind, key) : null;
        if (change === null) throw new AppError('error.configNoChange');
        await this.writeConfigOn(conn, kind, key, change.original);
      }, true),
  };

  private async writeConfigOn(conn: Connection, kind: ConfigKind, key: string, value: WritableValue): Promise<void> {
    const state = parseBandConfig(this.deviceRow?.configSnapshot ?? null);
    if (state.status !== 'ok') throw new AppError('error.configNotRead');
    const coreKind = CORE_KIND[kind];
    const grant = { confirmDangerous: commandName(configWriteCommand(coreKind)) };
    let snapshot = state.snapshot;
    const result = await writeConfigValue(conn.session, coreKind, key, value, grant, async (before) => {
      snapshot = recordOriginal(snapshot, kind, key, before, nowSeconds());
      await this.storeConfigSnapshot(serializeSnapshot(snapshot));
    });
    await this.storeConfigSnapshot(serializeSnapshot(applyConfigWrite(snapshot, kind, key, result.before, result.after, nowSeconds())));
  }

  stopLive = async (): Promise<void> => {
    await this.stopLiveInternal();
    this.patch({ live: IDLE_LIVE });
  };

  updateProfile = async (patch: Partial<Profile>): Promise<void> => {
    const { store } = this.requireApp();
    const { profile, recompute } = await storeProfile(store, this.snapshot.profile, patch);
    this.patch({ profile });
    const deviceId = this.deviceRow?.id;
    if (deviceId === undefined || !recompute) return;
    void this.exclusive(async () => {
      this.patch({ syncProgress: this.progressView('compute', 0, null, 0, 0) });
      try {
        await this.recompute(deviceId, null);
      } catch (error) {
        this.fail(error);
      } finally {
        this.patch({ syncProgress: null });
      }
    });
  };

  updateSettings = async (patch: Partial<Settings>): Promise<void> => {
    const { store } = this.requireApp();
    const current = this.snapshot.settings;
    if (patch.language !== undefined && patch.language !== current.language) {
      await store.setSetting(SETTING_KEYS.language, patch.language);
      this.patch({ settings: { ...this.snapshot.settings, language: patch.language } });
      this.patchDevice();
      void this.refreshNotifications();
      void this.refreshWidgets();
    }
    if (patch.units !== undefined && patch.units !== current.units) {
      await store.setSetting(SETTING_KEYS.units, patch.units);
      this.patch({ settings: { ...this.snapshot.settings, units: patch.units } });
    }
    if (patch.ownerSince !== undefined && patch.ownerSince !== null && patch.ownerSince !== current.ownerSince) {
      await this.changeOwnerSince(patch.ownerSince);
    }
    if (patch.dataSource !== undefined && patch.dataSource !== current.dataSource) {
      await this.switchSource(patch.dataSource);
    }
  };

  private async changeOwnerSince(iso: string): Promise<void> {
    const unix = ownerSinceToUnix(iso, deviceTzOffsetS(new Date()));
    const row = this.deviceRow;
    if (unix === null || row === null) {
      this.patch({ settings: { ...this.snapshot.settings, ownerSince: iso } });
      return;
    }
    const { store } = this.requireApp();
    const later = row.ownerSince === null || unix > row.ownerSince;
    await this.exclusive(async () => {
      try {
        this.deviceRow = await store.driver.transaction(async (tx) => {
          const inner = bindStore(tx);
          const current = this.deviceRow ?? row;
          const updated = await inner.upsertDevice({ ...current, ownerSince: unix });
          if (later) await deleteDataBefore(inner, row.id, unix);
          return updated;
        });
        this.patch({ settings: { ...this.snapshot.settings, ownerSince: iso } });
        if (later) {
          await this.loadBandReports(row.id);
          this.patchDevice();
          this.patch({ syncProgress: this.progressView('compute', 0, null, 0, 0) });
          await this.recompute(row.id, null);
        }
      } catch (error) {
        throw this.fail(error);
      } finally {
        this.patch({ syncProgress: null });
      }
    });
  }

  private async switchSource(source: DataSource): Promise<void> {
    const { store } = this.requireApp();
    await this.stopLiveInternal();
    await this.exclusive(async () => {
      await this.dropConnection();
      await store.setSetting(SETTING_KEYS.dataSource, source);
      this.patch({ settings: { ...this.snapshot.settings, dataSource: source }, notice: null });
      this.connection = 'disconnected';
      if (source === 'band') await this.purgeDemoRecordings();
      await this.loadActiveDevice();
    });
    void this.refreshNotifications();
    if (source === 'demo') {
      void this.sync();
      return;
    }
    try {
      const transport = await this.transportFor('band');
      if (transport instanceof BleManagerTransport) await transport.prepare();
      if ((await this.activeBleId()) === null) this.fail(new AppError('error.noBandPaired'));
    } catch (error) {
      this.fail(error);
    }
  }

  updateUserData = (patch: Partial<UserData>): Promise<boolean> => {
    const run = this.userDataChain.then(async () => {
      const network = this.snapshot.userData.network;
      try {
        const { store } = this.requireApp();
        const next = parseUserData(serializeUserData({ ...this.snapshot.userData, ...patch }));
        setNetworkPrefs(strictestPrefs(network, next.network));
        await store.setSetting(USER_DATA_KEY, serializeUserData(next));
        setNetworkPrefs(next.network);
        this.patch({ userData: next });
        if (patch.theme !== undefined) setThemePreference(next.theme);
        if (retentionChanged(patch)) void this.exclusive(() => this.pruneRaw());
        if (refreshesNotifications(patch)) void this.refreshNotifications();
        if (patch.widgetValues !== undefined || patch.pregnancyPrefs !== undefined) void this.refreshWidgets();
        if (patch.jetLagShiftAlarm !== undefined || (patch.jetLagPlan !== undefined && next.jetLagShiftAlarm)) void this.reapplyAlarm();
        return true;
      } catch (error) {
        setNetworkPrefs(network);
        this.fail(error);
        return false;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  };

  private async applyBodyChange(before: readonly BodyMeasurement[]): Promise<void> {
    const { driver } = this.requireApp();
    const after = await listBodyMeasurements(driver);
    this.patch({ bodyMeasurements: after });
    const newest = newestChanged(before, after);
    if (newest !== null && newest.weightKg !== this.snapshot.userData.weightKg) {
      const next = parseUserData(serializeUserData({ ...this.snapshot.userData, weightKg: newest.weightKg }));
      await this.requireApp().store.setSetting(USER_DATA_KEY, serializeUserData(next));
      this.patch({ userData: next });
    }
  }

  private importBodyEntries(entries: ImportedBodyMeasurement[], withBodyFat: boolean): Promise<BodyImportResult> {
    const run = this.userDataChain.then(async () => {
      const { driver } = this.requireApp();
      const before = this.snapshot.bodyMeasurements;
      const result = await importBodyMeasurements(driver, entries, nowSeconds(), { bodyFat: withBodyFat });
      if (result.saved > 0) await this.applyBodyChange(before);
      return result;
    });
    this.userDataChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private runBodyChange(task: (driver: AppStore['driver']) => Promise<boolean>): Promise<boolean> {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const before = this.snapshot.bodyMeasurements;
        const done = await task(driver);
        await this.applyBodyChange(before);
        return done;
      } catch (error) {
        this.fail(error);
        return false;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  }

  saveBodyMeasurement = (id: number | null, input: BodyMeasurementInput): Promise<boolean> =>
    this.runBodyChange(async (driver) => {
      if (id === null) {
        await insertBodyMeasurement(driver, input, nowSeconds());
        return true;
      }
      return updateBodyMeasurement(driver, id, input);
    });

  removeBodyMeasurement = (id: number): Promise<boolean> => this.runBodyChange((driver) => deleteBodyMeasurement(driver, id, nowSeconds()));

  private runLabChange(task: (driver: AppStore['driver']) => Promise<boolean>): Promise<boolean> {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const done = await task(driver);
        this.patch({ labResults: await listLabResults(driver) });
        return done;
      } catch (error) {
        this.fail(error);
        return false;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  }

  importVendorFiles = (files: SourceFile[], rejected: FileReport[], options: { fromDay?: string | null } = {}): Promise<VendorImportResult | null> => {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const parsed = parseVendorSources(files);
        const written = await upsertVendorData(driver, vendorFrom(parsed.data, options.fromDay ?? null), nowSeconds());
        this.patch({ vendorData: await listVendorData(driver) });
        return summariseImport(parsed, written, rejected);
      } catch (error) {
        this.fail(error);
        return null;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  };

  removeVendorData = (): Promise<boolean> => {
    const run = this.userDataChain.then(async () => {
      try {
        await clearVendorData(this.requireApp().driver);
        this.patch({ vendorData: emptyVendorData() });
        return true;
      } catch (error) {
        this.fail(error);
        return false;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  };

  private runStrength<T>(task: (driver: AppStore['driver']) => Promise<T>, failed: T): Promise<T> {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const result = await task(driver);
        this.patch({ strength: await listStrengthData(driver) });
        return result;
      } catch (error) {
        this.fail(error);
        return failed;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  }

  private runCycleChange<T>(task: (driver: AppStore['driver']) => Promise<T>, fallback: T): Promise<T> {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const result = await task(driver);
        this.patch({ cycle: await loadCycleData(driver) });
        return result;
      } catch (error) {
        this.fail(error);
        return fallback;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  }

  saveLabResult = (id: number | null, input: LabResultInput): Promise<boolean> =>
    this.runLabChange(async (driver) => {
      if (id === null) {
        await insertLabResult(driver, input, nowSeconds());
        return true;
      }
      return updateLabResult(driver, id, input);
    });

  removeLabResult = (id: number): Promise<boolean> => this.runLabChange((driver) => deleteLabResult(driver, id));

  private runCuffChange(task: (driver: AppStore['driver']) => Promise<boolean>): Promise<boolean> {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const done = await task(driver);
        this.patch({ cuffReadings: await listCuffReadings(driver) });
        return done;
      } catch (error) {
        this.fail(error);
        return false;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  }

  saveCuffReading = (input: CuffReadingInput): Promise<boolean> =>
    this.runCuffChange(async (driver) => {
      await insertCuffReading(driver, input, nowSeconds());
      return true;
    });

  removeCuffReading = (id: number): Promise<boolean> => this.runCuffChange((driver) => deleteCuffReading(driver, id));

  savePeriod = (id: number | null, input: PeriodInput): Promise<boolean> =>
    this.runCycleChange(async (driver) => {
      if (id === null) {
        await insertPeriod(driver, input, nowSeconds());
        return true;
      }
      return updatePeriod(driver, id, input);
    }, false);

  removePeriod = (id: number): Promise<boolean> => this.runCycleChange((driver) => deletePeriod(driver, id), false);

  saveSymptom = (input: SymptomInput): Promise<boolean> =>
    this.runCycleChange(async (driver) => {
      await upsertSymptom(driver, input, nowSeconds());
      return true;
    }, false);

  removeSymptom = (id: number): Promise<boolean> => this.runCycleChange((driver) => deleteSymptom(driver, id), false);

  savePregnancy = async (dueDay: string): Promise<boolean> => {
    const saved = await this.runCycleChange(async (driver) => {
      await setPregnancy(driver, dueDay, nowSeconds());
      return true;
    }, false);
    void this.refreshWidgets();
    return saved;
  };

  removePregnancy = async (): Promise<boolean> => {
    const removed = await this.runCycleChange((driver) => clearPregnancy(driver), false);
    void this.refreshWidgets();
    return removed;
  };

  removeAllCycleData = async (): Promise<boolean> => {
    const removed = await this.runCycleChange(async (driver) => {
      await deleteAllCycleData(driver);
      return true;
    }, false);
    void this.refreshWidgets();
    return removed;
  };

  private readonly strengthActionSet: StrengthActions = this.strengthActions();

  private resumingStream = false;

  private async afterStrength<T>(run: Promise<T>): Promise<T> {
    const result = await run;
    void this.syncWorkoutStream();
    return result;
  }

  private readonly motionActionSet: MotionActions = {
    setHighRate: async (on: boolean) => {
      try {
        await this.requireApp().store.setSetting(HIGH_RATE_MOTION_KEY, on ? '1' : '');
      } catch (error) {
        this.fail(error);
        return false;
      }
      this.patch({ motion: { ...this.snapshot.motion, highRate: on } });
      await this.syncWorkoutStream();
      return true;
    },
    setBandRecording: async (on: boolean) => {
      const done = await this.streams.setBandRecording(on);
      this.patch({ motion: { ...this.snapshot.motion, bandRecording: on ? done : false } });
      return done;
    },
    liveReps: () => this.liveRepCount(),
    resumeStream: async () => {
      if (this.resumingStream || this.workoutSession() === null) return;
      this.resumingStream = true;
      try {
        if (this.streams.hasOwner('workout')) await this.streams.reassert('workout');
        else await this.syncWorkoutStream();
      } finally {
        this.resumingStream = false;
      }
    },
  };

  private workoutSession(): StrengthSession | null {
    if (!this.snapshot.motion.highRate) return null;
    const open = activeSession(this.snapshot.strength.sessions);
    if (open === null || nowSeconds() - open.startedAt > WORKOUT_STREAM_MAX_S) return null;
    return open;
  }

  private async syncWorkoutStream(): Promise<void> {
    if (this.workoutSession() !== null) {
      if (!this.streams.hasOwner('workout') && this.ecgAbort === null) await this.streams.start('workout', ['imu']);
      return;
    }
    if (this.streams.hasOwner('workout')) await this.streams.stop('workout');
    if (this.snapshot.motion.bandRecording || this.streams.bandRequested()) await this.motionActionSet.setBandRecording(false);
  }

  private async refreshSetMotion(): Promise<void> {
    try {
      const { driver } = this.requireApp();
      const rows = await listSetMotion(driver, this.snapshot.strength.sessions.map((session) => session.id));
      const sets: Record<number, SetMotionView> = {};
      for (const [id, row] of rows) {
        sets[id] = { status: row.status, repsDetected: row.repsDetected, tutS: row.tutS, tempoS: row.tempoS, velocityLoss: row.velocityLoss, factor: row.factor };
      }
      this.patch({ motion: { ...this.snapshot.motion, sets } });
    } catch (error) {
      this.fail(error);
    }
  }

  private async computeMotionFor(sessionId: number): Promise<void> {
    const deviceId = this.deviceRow?.id;
    const session = this.snapshot.strength.sessions.find((s) => s.id === sessionId);
    if (deviceId === undefined || session === undefined) return;
    try {
      await computeSessionMotion(this.requireApp().driver, deviceId, session, this.conn?.session.clockOffsetS() ?? 0);
    } catch (error) {
      this.fail(error);
      return;
    }
    await this.refreshSetMotion();
  }

  private async afterSignalsFor(deviceId: number, range: { from: number; to: number }, offsetS: number): Promise<void> {
    const { driver } = this.requireApp();
    const result = await afterSignals(driver, deviceId, range, offsetS);
    if (result.sessions > 0) await this.refreshSetMotion();
    if (result.ecg > 0 && this.deviceRow?.id === deviceId) this.patch({ ecgRecordings: await listEcgRecordings(driver, deviceId) });
  }

  private async liveRepCount(): Promise<number | null> {
    const session = this.workoutSession();
    const deviceId = this.deviceRow?.id;
    if (session === null || deviceId === undefined) return null;
    const offsetS = this.conn?.session.clockOffsetS() ?? 0;
    const lastDone = session.sets.reduce((latest, set) => Math.max(latest, set.doneAt), session.startedAt);
    const nowBand = nowSeconds() + offsetS;
    const after = lastDone + offsetS;
    try {
      const from = Math.max(after, nowBand - STRENGTH_MOTION.searchS - STRENGTH_MOTION.gravityWindowS);
      const seconds = (await imuBetween(this.requireApp().driver, deviceId, Math.floor(from), Math.ceil(nowBand))).map(toMotionSecond);
      const bout = lastBoutBefore(seconds, nowBand, after);
      if (bout === null) return null;
      const motion = analyseBout(seconds, bout);
      return motion.status === 'readable' ? motion.reps : null;
    } catch {
      return null;
    }
  }

  private strengthActions(): StrengthActions {
    return {
      saveExercise: (input: CustomExerciseInput) =>
        this.runStrength(async (driver) => {
          await insertCustomExercise(driver, input, nowSeconds());
          return true;
        }, false),
      removeExercise: (id: number) => this.runStrength((driver) => deleteCustomExercise(driver, id), false),
      saveTemplate: (id: number | null, input: StrengthTemplateInput) =>
        this.runStrength((driver) => saveStrengthTemplate(driver, id, input, nowSeconds()), null),
      removeTemplate: (id: number) => this.runStrength((driver) => deleteStrengthTemplate(driver, id), false),
      startSession: (templateId: number | null, name: string, exercises: PlannedExercise[]) =>
        this.afterStrength(this.runStrength(async (driver) => {
          const open = this.snapshot.strength.sessions.find((session) => session.endedAt === null);
          if (open !== undefined) return open.id;
          const now = new Date(Date.now());
          const day = unixToIsoDate(Math.floor(now.getTime() / 1000), deviceTzOffsetS(now));
          return startStrengthSession(driver, { templateId, name, day, exercises }, nowSeconds());
        }, null)),
      addSessionExercise: (sessionId: number, exercise: PlannedExercise) =>
        this.runStrength((driver) => addStrengthSessionExercise(driver, sessionId, exercise), false),
      removeSessionExercise: (id: number) => this.runStrength((driver) => removeStrengthSessionExercise(driver, id), false),
      logSet: async (sessionId: number, input: StrengthSetInput) => {
        const logged = await this.runStrength(async (driver) => (await addStrengthSet(driver, sessionId, input, nowSeconds())) !== null, false);
        if (logged) setTimeout(() => void this.computeMotionFor(sessionId), SET_MOTION_DELAY_MS);
        return logged;
      },
      removeSet: (id: number) => this.runStrength((driver) => deleteStrengthSet(driver, id), false),
      finishSession: async (id: number) => {
        const done = await this.runStrength((driver) => finishStrengthSession(driver, id, nowSeconds()), false);
        if (done) void this.refreshNotifications();
        if (done) void this.computeMotionFor(id);
        void this.syncWorkoutStream();
        return done;
      },
      removeSession: (id: number) => this.afterStrength(this.runStrength((driver) => deleteStrengthSession(driver, id), false)),
    };
  }

  private runNoteChange(task: (driver: AppStore['driver']) => Promise<boolean>): Promise<boolean> {
    const run = this.userDataChain.then(async () => {
      try {
        const { driver } = this.requireApp();
        const done = await task(driver);
        this.patch({ journalNotes: await listJournalNotes(driver) });
        return done;
      } catch (error) {
        this.fail(error);
        return false;
      }
    });
    this.userDataChain = run.then(() => undefined);
    return run;
  }

  saveJournalNote = (id: number | null, input: JournalNoteInput): Promise<boolean> =>
    this.runNoteChange(async (driver) => {
      if (id === null) {
        await insertJournalNote(driver, input, nowSeconds());
        return true;
      }
      return updateJournalNote(driver, id, input);
    });

  removeJournalNote = (id: number): Promise<boolean> => this.runNoteChange((driver) => deleteJournalNote(driver, id));

  routeFor = async (activityId: number): Promise<RoutePoint[]> => {
    if (this.app === null || !this.snapshot.activities.some((a) => a.id === activityId && a.deletedAt === null)) return [];
    return listRoute(this.app.driver, activityId);
  };

  heartRateBetween = async (fromS: number, toS: number, bucketS = 60): Promise<HeartRatePoint[]> => {
    const row = this.deviceRow;
    if (this.app === null || row === null || toS <= fromS) return [];
    return this.app.store.heartRateBuckets(row.id, fromS, toS, bucketS);
  };

  spo2Between = async (fromS: number, toS: number): Promise<Spo2Point[]> => {
    const row = this.deviceRow;
    if (this.app === null || row === null || toS <= fromS) return [];
    if (this.spo2Cache === null || this.spo2Cache.days !== this.snapshot.days) this.spo2Cache = { days: this.snapshot.days, nights: new Map() };
    const cache = this.spo2Cache;
    const key = `${row.id}:${fromS}:${toS}`;
    const hit = cache.nights.get(key);
    if (hit !== undefined) return hit;
    const samples = await this.app.store.samplesBetween(row.id, fromS, toS);
    const points = spo2Windows(samples).map((w) => ({ t: w.start, pct: w.percent }));
    if (cache.nights.size >= SPO2_CACHE_NIGHTS) {
      const oldest = cache.nights.keys().next();
      if (oldest.done !== true) cache.nights.delete(oldest.value);
    }
    cache.nights.set(key, points);
    return points;
  };

  sleepStagesBetween = async (fromS: number, toS: number): Promise<StageEpochRow[]> => {
    const row = this.deviceRow;
    if (this.app === null || row === null || toS <= fromS) return [];
    return this.app.store.sleepStagesBetween(row.id, fromS, toS);
  };

  private async saveNotificationState(state: NotificationState): Promise<void> {
    this.notificationState = state;
    await this.requireApp().store.setSetting(NOTIFICATION_STATE_KEY, serializeNotificationState(state));
    this.patch({ inbox: state.inbox });
  }

  private notificationTask(task: () => Promise<void>): Promise<void> {
    const run = this.notificationChain.then(task).catch(() => undefined);
    this.notificationChain = run;
    return run;
  }

  refreshNotifications = (options: { syncFailed?: boolean } = {}): Promise<void> =>
    this.notificationTask(async () => {
      if (this.app === null) return;
      const permission = await this.notifier.permission();
      const stillScheduled = await this.notifier.scheduledIds();
      const now = new Date();
      const { userData, settings } = this.snapshot;
      const prefs = userData.notifications;
      const delivered = permission === 'granted';
      const settled = reconcile(this.notificationState, now, delivered, stillScheduled);
      const wind = userData.windDown;
      const winding = windDownAlert(wind, now) !== null || settled.pending.some((alert) => alert.kind === 'windDown');
      const active = (prefs.enabled || winding) && delivered;
      const recentIds = [...settled.pending.map((alert) => alert.id), ...settled.sent];
      const failure = options.syncFailed === true ? syncFailedAlert(now, prefs, recentIds) : null;
      const fresh: Alert[] = failure === null ? [] : [failure];
      let pending = active
        ? planAlerts({
            now,
            prefs,
            pending: settled.pending,
            sent: settled.sent,
            factsFor: digestFacts(this.snapshot.days, now),
            goals: goalFacts(
              userData.weeklyPlan,
              planInputFor(this.snapshot.days, this.snapshot.strength.sessions, this.snapshot.activities, this.snapshot.healthConnect.state.steps, localDay(now), now),
            ),
            lastSyncAt: this.lastSyncAt === null ? null : this.lastSyncAt * 1000,
            watchBand: settings.dataSource === 'band' && this.deviceRow !== null,
            fresh,
            windDown: wind,
            steps: stepsGoalFacts(this.snapshot.days, userData.stepsGoal, now),
            coachReady: coachActive(userData.coach, userData.network),
          })
        : [];
      this.patch({ notificationPermission: permission });
      try {
        if (active) {
          const channel = translate(settings.language, 'notif.channel');
          const texts = pending.map((alert) => ({ id: alert.id, at: alert.at, ...alertText(settings.language, alert) }));
          await this.notifier.replaceAll(texts, channel, now.getTime());
        } else {
          await this.notifier.cancelAll();
        }
      } catch {
        pending = [];
        await this.notifier.cancelAll().catch(() => undefined);
      }
      await this.saveNotificationState({ ...settled, pending });
    });

  refreshWidgets = (): Promise<void> => {
    const run = this.widgetChain.then(async () => {
      if (await this.widgets.placed() === 0) {
        await this.widgets.clear();
        return;
      }
      const { days, userData, settings } = this.snapshot;
      await this.widgets.publish(
        buildWidgetFile({
          enabled: userData.widgetValues,
          day: days[days.length - 1],
          syncedAt: this.lastSyncAt,
          language: settings.language,
          readinessNightsLeft: readinessNightsLeft(days, days.length - 1),
          loadTarget: loadTargetsHidden(userData.pregnancyPrefs, this.snapshot.cycle) ? null : loadTargetBand(days),
        }),
      );
    });
    this.widgetChain = run.catch(() => undefined);
    return this.widgetChain;
  };

  refreshWidgetsAfterPin = async (): Promise<void> => {
    for (let attempt = 0; attempt < PIN_WAIT_ATTEMPTS; attempt += 1) {
      if ((await this.widgets.placed().catch(() => 0)) > 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, PIN_WAIT_MS));
    }
    await this.refreshWidgets();
  };

  requestNotificationPermission = async (): Promise<PermissionState> => {
    const channel = translate(this.snapshot.settings.language, 'notif.channel');
    const permission = await this.notifier.request(channel).catch((): PermissionState => 'denied');
    this.patch({ notificationPermission: permission });
    return permission;
  };

  setNotificationsEnabled = async (enabled: boolean): Promise<PermissionState> => {
    if (!enabled) {
      await this.updateUserData({ notifications: { ...this.snapshot.userData.notifications, enabled: false } });
      return this.snapshot.notificationPermission;
    }
    const channel = translate(this.snapshot.settings.language, 'notif.channel');
    const permission = await this.notifier.request(channel).catch((): PermissionState => 'denied');
    this.patch({ notificationPermission: permission });
    if (permission === 'granted') await this.updateUserData({ notifications: { ...this.snapshot.userData.notifications, enabled: true } });
    return permission;
  };

  markInboxRead = (ids?: readonly string[]): Promise<void> =>
    this.notificationTask(async () => {
      const marks = (entry: InboxEntry): boolean => ids === undefined || ids.includes(entry.id);
      if (this.app === null || this.notificationState.inbox.every((entry) => entry.read || !marks(entry))) return;
      await this.saveNotificationState({
        ...this.notificationState,
        inbox: this.notificationState.inbox.map((entry) => (marks(entry) ? { ...entry, read: true } : entry)),
      });
    });

  clearInbox = (): Promise<void> =>
    this.notificationTask(async () => {
      if (this.app === null) return;
      await this.saveNotificationState({ ...this.notificationState, inbox: [] });
    });

  private notificationsExport(): string {
    const { pending, inbox, sent } = this.notificationState;
    return JSON.stringify({ preferences: this.snapshot.userData.notifications, inbox, scheduled: pending, sent }, null, 2);
  }

  saveSleepEdit = (request: SleepEditRequest): Promise<SleepEditOutcome> =>
    this.exclusive(async () => {
      try {
        const row = this.deviceRow;
        if (row === null) throw new AppError('error.noBandPaired');
        const { sleepEdits, days } = this.snapshot;
        const problem = validateSleepEdit(request, otherSleepSpans(days, sleepEdits, request), nowSeconds());
        if (problem !== null) return problem;
        const previous = request.id === null ? null : (sleepEdits.find((e) => e.id === request.id) ?? null);
        await this.requireApp().store.saveSleepEdit({
          id: request.id,
          deviceId: row.id,
          targetOnset: request.targetOnset,
          targetOffset: request.targetOffset,
          onset: request.onset,
          offset: request.offset,
          createdAt: nowSeconds(),
          removed: false,
        });
        await this.recompute(row.id, recomputeFrom(request, previous));
        return 'saved';
      } catch (error) {
        this.fail(error);
        return 'error';
      } finally {
        this.patch({ syncProgress: null });
      }
    });

  removeDetectedSleep = (item: EditableSleep): Promise<boolean> =>
    this.exclusive(async () => {
      try {
        const row = this.deviceRow;
        if (row === null || item.editId !== null || item.removed || item.targetOnset === null || item.targetOffset === null) return false;
        await this.requireApp().store.saveSleepEdit({
          id: null,
          deviceId: row.id,
          targetOnset: item.targetOnset,
          targetOffset: item.targetOffset,
          onset: item.onset,
          offset: item.offset,
          createdAt: nowSeconds(),
          removed: true,
        });
        await this.recompute(row.id, recomputeFrom({ onset: item.onset, targetOnset: item.targetOnset }, null));
        return true;
      } catch (error) {
        this.fail(error);
        return false;
      } finally {
        this.patch({ syncProgress: null });
      }
    });

  deleteSleepEdit = (id: number): Promise<boolean> =>
    this.exclusive(async () => {
      try {
        const row = this.deviceRow;
        const edit = this.snapshot.sleepEdits.find((e) => e.id === id) ?? null;
        if (row === null || edit === null) return false;
        if (!(await this.requireApp().store.deleteSleepEdit(row.id, id))) return false;
        await this.recompute(row.id, recomputeFrom(edit, null));
        return true;
      } catch (error) {
        this.fail(error);
        return false;
      } finally {
        this.patch({ syncProgress: null });
      }
    });

  private patchHealthConnect(change: Partial<HealthConnectView>): void {
    this.patch({ healthConnect: { ...this.snapshot.healthConnect, ...change } });
  }

  private healthConnectTask<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    const run = this.healthConnectChain.then(task).catch(() => fallback);
    this.healthConnectChain = run.then(() => undefined);
    return run;
  }

  private async saveHealthConnectState(state: HealthConnectState): Promise<void> {
    await this.requireApp().store.setSetting(HEALTH_CONNECT_STATE_KEY, serializeHealthConnectState(state));
    this.patchHealthConnect({ state });
  }

  private async readGranted(): Promise<void> {
    try {
      this.patchHealthConnect({ granted: [...(await this.healthConnect.grantedPermissions())] });
    } catch {
      this.patchHealthConnect({ granted: [] });
    }
  }

  refreshHealthConnect = (): Promise<void> =>
    this.healthConnectTask(async () => {
      let availability: HealthConnectView['availability'];
      try {
        availability = await this.healthConnect.availability();
      } catch {
        availability = 'not-installed';
      }
      this.patchHealthConnect({ availability });
      if (availability === 'available') await this.readGranted();
      else this.patchHealthConnect({ granted: [] });
    }, undefined);

  setHealthConnectType = (type: HcDataType, enabled: boolean): Promise<boolean> =>
    this.healthConnectTask(async () => {
      const current = this.snapshot.healthConnect.state;
      const state: HealthConnectState = isExportType(type)
        ? { ...current, export: { ...current.export, [type]: enabled } }
        : { ...current, import: { ...current.import, [type]: enabled } };
      if (type === 'steps' && !enabled) {
        state.steps = [];
        state.lastStepsImportS = null;
      }
      await this.saveHealthConnectState(state);
      if (!enabled || this.snapshot.healthConnect.availability !== 'available') return true;
      const permission = permissionFor(type);
      const key = permissionKey(permission);
      if (this.snapshot.healthConnect.granted.includes(key)) return true;
      const granted = await this.healthConnect.requestPermissions([permission]);
      this.patchHealthConnect({ granted: [...granted] });
      return granted.has(key);
    }, false);

  setHealthConnectTypes = (types: readonly HcDataType[], enabled: boolean): Promise<HcDataType[]> =>
    this.healthConnectTask(async () => {
      const view = this.snapshot.healthConnect;
      const result = await switchHealthConnectTypes(this.healthConnect, { state: view.state, granted: view.granted, availability: view.availability, types, enabled });
      await this.saveHealthConnectState(result.state);
      this.patchHealthConnect({ granted: result.granted });
      return result.on;
    }, []);

  setHealthConnectAfterSync = (enabled: boolean): Promise<void> =>
    this.healthConnectTask(async () => {
      await this.saveHealthConnectState({ ...this.snapshot.healthConnect.state, afterBandSync: enabled });
    }, undefined);

  requestHealthConnectAccess = (): Promise<void> =>
    this.healthConnectTask(async () => {
      if (this.snapshot.healthConnect.availability !== 'available') return;
      const granted = await this.healthConnect.requestPermissions(wantedPermissions(this.snapshot.healthConnect.state));
      this.patchHealthConnect({ granted: [...granted] });
    }, undefined);

  syncHealthConnect = (): Promise<void> => {
    if (this.healthConnectRun !== null) return this.healthConnectRun;
    const run = this.healthConnectTask(async () => {
      if (this.app === null || this.snapshot.healthConnect.availability !== 'available') return;
      this.patchHealthConnect({ syncing: true });
      try {
        const outcome = await runHealthConnectSync({
          api: this.healthConnect,
          state: this.snapshot.healthConnect.state,
          days: this.snapshot.days,
          exercises: this.snapshot.days.flatMap((day) => dayEntries(this.snapshot.days, day, this.snapshot.activities)),
          exportAllowed: this.snapshot.settings.dataSource === 'band' && this.deviceRow !== null,
          heartRate: (fromS, toS) => this.heartRateBetween(fromS, toS, 60),
          importBody: (entries, withBodyFat) => this.importBodyEntries(entries, withBodyFat),
          ownPackage: OPENHOOP_PACKAGE,
          nowS: nowSeconds(),
          version: Date.now(),
          tzOffsetAt: (unixS) => deviceTzOffsetS(new Date(unixS * 1000)),
        });
        await this.saveHealthConnectState({
          ...this.snapshot.healthConnect.state,
          heartRateCursorS: outcome.heartRateCursorS,
          lastImportS: outcome.lastImportS,
          lastStepsImportS: outcome.lastStepsImportS,
          steps: outcome.steps,
          lastSync: outcome.report,
        });
        await this.readGranted();
      } catch {
        this.fail(new AppError('error.healthConnectSync'));
      } finally {
        this.patchHealthConnect({ syncing: false });
      }
    }, undefined).finally(() => {
      this.healthConnectRun = null;
    });
    this.healthConnectRun = run;
    return run;
  };

  openHealthConnectSettings = (): void => {
    try {
      this.healthConnect.openSettings();
    } catch {
      this.fail(new AppError('error.healthConnect'));
    }
  };

  installHealthConnect = async (): Promise<void> => {
    try {
      await this.healthConnect.openStore();
    } catch {
      this.fail(new AppError('error.healthConnect'));
    }
  };
  saveActivity = (draft: ActivityDraft, id?: number): Promise<number | null> =>
    this.exclusive(async () => {
      try {
        const device = this.deviceRow;
        if (device === null) throw new AppError('activity.error.noBand');
        const { route, ...fields } = draft;
        const input = checkActivityInput({ ...fields, deviceId: device.id });
        const metrics = await this.metricsFor(device.id, input, this.snapshot.days);
        const now = nowSeconds();
        const saved =
          route === undefined
            ? await this.activityStore().save(input, metrics, now, id)
            : await this.requireApp().store.driver.transaction(async (tx) => {
                const row = await bindActivityStore(tx).save(input, metrics, now, id);
                await saveRoute(tx, row.id, route);
                return row;
              });
        if (input.source === 'live') {
          this.patch({ syncProgress: this.progressView('compute', 0, null, 0, 0) });
          try {
            await this.recompute(device.id, input.start);
          } finally {
            this.patch({ syncProgress: null });
          }
        } else {
          await this.loadActivities();
        }
        return saved.id;
      } catch (error) {
        this.fail(error instanceof ActivityInputError || error instanceof RouteInputError ? new AppError('activity.error.invalid') : error);
        return null;
      }
    });

  deleteActivity = (target: DeleteTarget): Promise<boolean> =>
    this.exclusive(async () => {
      try {
        await this.finishPendingDelete();
        const device = this.deviceRow;
        if (device === null) throw new AppError('activity.error.noBand');
        const activities = this.activityStore();
        const now = nowSeconds();
        let id: number;
        let created = false;
        if (target.kind === 'activity') {
          const row = await activities.get(target.id);
          if (row === null || row.deviceId !== device.id) throw new AppError('activity.error.missing');
          id = row.id;
        } else {
          const existing = await activities.findDetected(device.id, target.workout.start);
          if (existing !== null) {
            id = existing.id;
          } else {
            const w = target.workout;
            const draft: ActivityInput = { deviceId: device.id, source: 'auto', detectedStart: w.start, type: 'other', start: w.start, end: w.end, paused: [], note: null };
            id = (await activities.save(draft, NO_METRICS, now)).id;
            created = true;
          }
        }
        await activities.setDeleted(id, now, now);
        this.pendingCreated = created;
        this.pendingTimer = setTimeout(() => {
          void this.exclusive(() => (this.snapshot.pendingDelete?.id === id ? this.finishPendingDelete() : Promise.resolve())).catch((error: unknown) =>
            this.fail(error),
          );
        }, UNDO_MS);
        this.patch({ pendingDelete: { id, until: Date.now() + UNDO_MS } });
        await this.loadActivities();
        return true;
      } catch (error) {
        this.fail(error);
        return false;
      }
    });

  undoDelete = (): Promise<void> =>
    this.exclusive(async () => {
      const pending = this.snapshot.pendingDelete;
      if (pending === null) return;
      this.clearPendingTimer();
      try {
        const activities = this.activityStore();
        if (this.pendingCreated) await activities.remove(pending.id);
        else await activities.setDeleted(pending.id, null, nowSeconds());
        await this.loadActivities();
      } catch (error) {
        this.fail(error);
      } finally {
        this.pendingCreated = false;
        this.patch({ pendingDelete: null });
      }
    });

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private async finishPendingDelete(): Promise<void> {
    this.clearPendingTimer();
    if (this.snapshot.pendingDelete === null) return;
    this.pendingCreated = false;
    this.patch({ pendingDelete: null });
    await this.activityStore().purgeDeleted(null);
    await this.loadActivities();
  }

  exportData = async (content: ExportContent = 'all'): Promise<void> => {
    const app = this.requireApp();
    try {
      await this.exclusive(async () => {
        const sessions = await rawSessionExports().catch((): Record<string, string> => ({}));
        const extras =
          content === 'sessions'
            ? sessions
            : {
                'console_lines.csv': await consoleLinesCsv(app.store),
                'notifications.json': this.notificationsExport(),
                'health-connect.json': JSON.stringify(this.snapshot.healthConnect.state, null, 2),
                ...sessions,
              };
        return exportAll(app, exportCsv, extras, { content, jsonFor: exportJson });
      });
    } catch (error) {
      this.fail(error);
    }
  };

  storageStats = async (): Promise<StorageStats | null> => {
    if (this.app === null) return null;
    try {
      return await readStorageStats(this.app.driver);
    } catch {
      return null;
    }
  };

  chargeHistory = async (sinceS: number): Promise<number[]> => {
    if (this.app === null || this.deviceRow === null) return [];
    try {
      return await chargeStartsSince(this.app.store, this.deviceRow.id, sinceS);
    } catch {
      return [];
    }
  };

  private async pruneRaw(): Promise<void> {
    const app = this.app;
    if (app === null) return;
    try {
      await applyRawRetention((deviceId, beforeS) => pruneRawBefore(app.store, deviceId, beforeS), this.deviceRow?.id ?? null, this.snapshot.userData.rawRetentionDays, nowSeconds());
    } catch (error) {
      this.fail(error);
    }
  }

  deleteAllData = async (): Promise<boolean> => {
    const app = this.requireApp();
    await this.stopLiveInternal();
    await this.streams.releaseAll();
    try {
      await this.exclusive(async () => {
        const conn = this.conn;
        if (conn !== null && conn.session.isConnected && this.snapshot.alarm.armed !== null) await cancelAlarm(conn.session).catch(() => undefined);
        await this.dropConnection();
        await wipeAllData(app.driver);
        await app.driver.exec('VACUUM').catch(() => undefined);
      });
      deleteAllRawSessions();
    } catch (error) {
      this.fail(error);
      return false;
    }
    this.smartWake.cancel();
    await this.notifier.cancelAll().catch(() => undefined);
    this.notificationState = emptyNotificationState();
    const wiped = wipedState(this.snapshot);
    setNetworkPrefs(wiped.userData.network);
    setThemePreference(wiped.userData.theme);
    this.deviceRow = null;
    this.demoBand = null;
    this.connection = 'disconnected';
    this.patch(wiped);
    await this.loadActiveDevice();
    void this.refreshWidgets();
    return true;
  };

  listDonationDays = async (): Promise<DonationDay[]> => {
    if (this.app === null || this.snapshot.settings.dataSource !== 'band') return [];
    return listStoredDonationDays(this.app.store, nowSeconds());
  };

  buildDonation = (days: readonly string[], onProgress: (progress: DonationProgress) => void, signal: AbortSignal): Promise<BuiltDonation> => {
    const app = this.requireApp();
    return this.exclusive(async () => {
      const workspace = createDonationWorkspace(new Date());
      try {
        const result = await buildDonationParts({
          store: app.store,
          days,
          nowS: nowSeconds(),
          appVersion: Constants.expoConfig?.version ?? '0',
          code: donationCode(getRandomBytes),
          openPart: async (fileName) => filePartSink(workspace, fileName),
          onProgress,
          signal,
        });
        return { ...result, workspaceUri: workspace.uri };
      } catch (error) {
        removeWorkspace(workspace.uri);
        throw error;
      }
    });
  };

  saveDonation = async (built: BuiltDonation): Promise<SaveOutcome> => {
    const app = this.requireApp();
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const remembered = platform === 'android' ? await app.store.getSetting(DONATION_FOLDER_KEY) : null;
    const outcome = await saveDonationParts(
      new Directory(built.workspaceUri),
      built.parts.map((part) => part.fileName),
      remembered,
      platform,
    );
    if (outcome.kind === 'saved' && platform === 'android' && outcome.folderUri !== remembered) {
      await app.store.setSetting(DONATION_FOLDER_KEY, outcome.folderUri);
    }
    return outcome;
  };

  shareDonationPart = (built: BuiltDonation, fileName: string): Promise<void> => sharePartFile(new Directory(built.workspaceUri), fileName);

  discardDonation = (built: BuiltDonation): void => {
    removeWorkspace(built.workspaceUri);
  };

  private appData(): AppData {
    const { live: _live, syncProgress: _syncProgress, pendingDelete: _pendingDelete, ecgLive: _ecgLive, rawLive: _rawLive, ...snapshot } = this.snapshot;
    return {
      ...snapshot,
      sleepEditLimits: { napMaxS: MANUAL_NAP_MAX_S, sleepMaxS: EDITED_SLEEP_MAX_S },
      scan: this.scan,
      pair: this.pair,
      sync: this.sync,
      startLive: this.startLive,
      reportLiveLoad: this.reportLiveLoad,
      readBandConfig: this.readBandConfig,
      bandActions: this.bandActionSet,
      alarmActions: this.alarmActionSet,
      ecgActions: this.ecgActionSet,
      rawStreams: this.rawStreamSet,
      motionActions: this.motionActionSet,
      stopLive: this.stopLive,
      exportData: this.exportData,
      storageStats: this.storageStats,
      chargeHistory: this.chargeHistory,
      deleteAllData: this.deleteAllData,
      listDonationDays: this.listDonationDays,
      buildDonation: this.buildDonation,
      saveDonation: this.saveDonation,
      shareDonationPart: this.shareDonationPart,
      discardDonation: this.discardDonation,
      updateProfile: this.updateProfile,
      updateSettings: this.updateSettings,
      updateUserData: this.updateUserData,
      saveBodyMeasurement: this.saveBodyMeasurement,
      removeBodyMeasurement: this.removeBodyMeasurement,
      saveJournalNote: this.saveJournalNote,
      removeJournalNote: this.removeJournalNote,
      saveLabResult: this.saveLabResult,
      removeLabResult: this.removeLabResult,
      saveCuffReading: this.saveCuffReading,
      removeCuffReading: this.removeCuffReading,
      importVendorFiles: this.importVendorFiles,
      removeVendorData: this.removeVendorData,
      savePeriod: this.savePeriod,
      removePeriod: this.removePeriod,
      saveSymptom: this.saveSymptom,
      removeSymptom: this.removeSymptom,
      savePregnancy: this.savePregnancy,
      removePregnancy: this.removePregnancy,
      removeAllCycleData: this.removeAllCycleData,
      strengthActions: this.strengthActionSet,
      heartRateBetween: this.heartRateBetween,
      spo2Between: this.spo2Between,
      sleepStagesBetween: this.sleepStagesBetween,
      routeFor: this.routeFor,
      saveSleepEdit: this.saveSleepEdit,
      deleteSleepEdit: this.deleteSleepEdit,
      removeDetectedSleep: this.removeDetectedSleep,
      saveActivity: this.saveActivity,
      deleteActivity: this.deleteActivity,
      undoDelete: this.undoDelete,
      clearNotice: this.clearNotice,
      refreshNotifications: this.refreshNotifications,
      setNotificationsEnabled: this.setNotificationsEnabled,
      requestNotificationPermission: this.requestNotificationPermission,
      refreshWidgets: this.refreshWidgets,
      refreshWidgetsAfterPin: this.refreshWidgetsAfterPin,
      markInboxRead: this.markInboxRead,
      clearInbox: this.clearInbox,
      refreshHealthConnect: this.refreshHealthConnect,
      setHealthConnectType: this.setHealthConnectType,
      setHealthConnectTypes: this.setHealthConnectTypes,
      setHealthConnectAfterSync: this.setHealthConnectAfterSync,
      requestHealthConnectAccess: this.requestHealthConnectAccess,
      syncHealthConnect: this.syncHealthConnect,
      openHealthConnectSettings: this.openHealthConnectSettings,
      installHealthConnect: this.installHealthConnect,
    };
  }
}

let shared: AppController | null = null;

export function appController(): AppController {
  shared ??= new AppController();
  return shared;
}
