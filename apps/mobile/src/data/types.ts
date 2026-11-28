import type { Interval, ZoneFloors } from '@openhoop/analytics';
import type { Wrist } from '@openhoop/protocol';
import type { LiveImuSecond, LiveOpticalSecond, StorageStats, StreamKind } from '@openhoop/core';
import type { ActivityRow, ActivitySource, AlarmEvent, BandModel, BandStatus, EcgSummary, StageEpochRow, BatteryPackState, BodyMeasurement, BodyMeasurementInput, CuffReading, CuffReadingInput, CustomExerciseInput, CycleData, DayRecord, DonationDay, DonationProgress, DonationResult, EcgSymptom, JournalNote, JournalNoteInput, LabResult, LabResultInput, PeriodInput, PlannedExercise, RoutePoint, SleepEditProblem, SleepEditRow, StrengthData, StrengthSetInput, StrengthTemplateInput, SymptomInput, VendorData, WorkoutRecord } from '@openhoop/core';

import type { StorageProblem } from '@/data/storageProblem';
import type { TranslationKey, TranslationParams } from '@/i18n';
import type { HcDataType } from '@/lib/healthConnectMapping';
import type { InboxEntry } from '@/lib/notificationPlan';

import type { AlarmPlan, ArmedAlarm } from './alarm';
import type { ConfigKind, WritableValue } from './bandConfig';
import type { RawLiveState } from './rawLive';
import type { StreamOwner } from './rawStreamPolicy';
import type { SaveOutcome } from './donation/files';
import type { ExportContent } from './exportData';
import type { HcAvailability } from './healthConnectApi';
import type { HealthConnectState } from './healthConnectState';
import type { HrBroadcastState } from './hrBroadcast';
import type { PermissionState } from './notifier';

import type { EditableSleep, SleepEditRequest } from './sleepEditForm';
import type { UserData } from './userData';
import type { FileReport } from './vendorExport/parse';
import type { SourceFile } from './vendorExport/sources';
import type { VendorImportResult } from './vendorExport/summary';

export type Language = 'nl' | 'en';
export type DataSource = 'demo' | 'band';
export type Units = 'metric' | 'imperial';
export type LockState = 'open' | 'locked' | 'no-data' | 'unknown';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'syncing';

export interface SyncCounts {
  saved: number;
  discarded: number;
}

export interface DeviceStatus {
  name: string | null;
  model: BandModel | null;
  firmware: string | null;
  serial?: string | null;
  batteryPercent: number | null;
  lastSyncAt: number | null;
  backlogPages: number | null;
  lastSyncCounts: SyncCounts | null;
  lockState: LockState;
  connection: ConnectionState;
  configSnapshot: string | null;
  batteryPack: BatteryPackState | null;
  band: BandStatus | null;
  hrBroadcast: HrBroadcastState | null;
}

export interface LiveState {
  active: boolean;
  heartRate: number | null;
  lastRrMs: number | null;
  updatedAt: number | null;
  dayLoad?: number | null;
}

export type ZoneMode = 'auto' | 'custom';

export interface Profile {
  birthYear: number | null;
  maxHeartRate: number | null;
  birthDate?: string | null;
  restingHeartRate?: number | null;
  zoneMode?: ZoneMode;
  zoneFloors?: ZoneFloors | null;
}

export interface Settings {
  language: Language;
  dataSource: DataSource;
  ownerSince: string | null;
  units: Units;
}

export interface DiscoveredBand {
  id: string;
  name: string;
  rssi: number;
}

export type SyncPhase = 'connecting' | 'probing' | 'transfer' | 'compute';

export interface SyncProgressView {
  phase: SyncPhase;
  chunks: number;
  percent: number | null;
  daysDone: number;
  daysTotal: number;
  pagesRead?: number | null;
  pagesTotal?: number | null;
  historyDays?: number | null;
}

export interface Notice {
  key: TranslationKey;
  params?: TranslationParams;
}

export interface HeartRatePoint {
  t: number;
  hr: number;
}

export interface Spo2Point {
  t: number;
  pct: number;
}

export interface ActivityDraft {
  source: ActivitySource;
  detectedStart: number | null;
  type: string;
  start: number;
  end: number;
  paused: Interval[];
  note: string | null;
  route?: RoutePoint[];
}

export type DeleteTarget = { kind: 'activity'; id: number } | { kind: 'detected'; workout: WorkoutRecord };

export interface PendingDelete {
  id: number;
  until: number;
}

export type SleepEditOutcome = 'saved' | SleepEditProblem | 'error';

export interface SleepEditLimits {
  napMaxS: number;
  sleepMaxS: number;
}

export interface StrengthActions {
  saveExercise(input: CustomExerciseInput): Promise<boolean>;
  removeExercise(id: number): Promise<boolean>;
  saveTemplate(id: number | null, input: StrengthTemplateInput): Promise<number | null>;
  removeTemplate(id: number): Promise<boolean>;
  startSession(templateId: number | null, name: string, exercises: PlannedExercise[]): Promise<number | null>;
  addSessionExercise(sessionId: number, exercise: PlannedExercise): Promise<boolean>;
  removeSessionExercise(id: number): Promise<boolean>;
  logSet(sessionId: number, input: StrengthSetInput): Promise<boolean>;
  removeSet(id: number): Promise<boolean>;
  finishSession(id: number): Promise<boolean>;
  removeSession(id: number): Promise<boolean>;
}

export type BandBuzz = 'test' | 'find' | 'target' | 'top';

export interface BandActions {
  buzz(kind: BandBuzz): Promise<boolean>;
  buzzIfConnected?(kind: BandBuzz): Promise<boolean>;
  stopBuzz(): Promise<boolean>;
  setHeartRateBroadcast(on: boolean): Promise<boolean>;
  writeConfig(kind: ConfigKind, key: string, value: WritableValue): Promise<boolean>;
  restoreConfig(kind: ConfigKind, key: string): Promise<boolean>;
}

export interface AlarmView {
  plan: AlarmPlan;
  armed: ArmedAlarm | null;
  events: AlarmEvent[];
  problem: Notice | null;
  smartAvailable: boolean;
}

export type AlarmSaveOutcome = 'on-band' | 'pending';

export interface AlarmActions {
  save(plan: AlarmPlan): Promise<AlarmSaveOutcome>;
  ring(): Promise<boolean>;
}

export interface HealthConnectView {
  availability: HcAvailability | 'checking';
  granted: string[];
  state: HealthConnectState;
  syncing: boolean;
}

export interface EcgLiveState {
  active: boolean;
  elapsedMs: number;
  samples: number;
  tail: readonly number[];
  quality: number | null;
}

export interface EcgActions {
  start(wrist: Wrist): Promise<number | null>;
  stop(): void;
  samples(id: number): Promise<number[] | null>;
  remove(id: number): Promise<boolean>;
  setSymptoms(id: number, symptoms: readonly EcgSymptom[]): Promise<boolean>;
}

export interface RawStreamActions {
  start(owner: StreamOwner, kinds: readonly StreamKind[]): Promise<boolean>;
  stop(owner: StreamOwner, kinds?: readonly StreamKind[]): Promise<void>;
  setBandRecording(on: boolean): Promise<boolean>;
  imuSeconds(): readonly LiveImuSecond[];
  opticalSeconds(): readonly LiveOpticalSecond[];
}

export interface SetMotionView {
  status: 'readable' | 'unreadable' | 'unmatched' | 'none';
  repsDetected: number | null;
  tutS: number | null;
  tempoS: number | null;
  velocityLoss: number | null;
  factor: number;
}

export interface MotionState {
  highRate: boolean;
  bandRecording: boolean;
  sets: Readonly<Record<number, SetMotionView>>;
}

export interface MotionActions {
  setHighRate(on: boolean): Promise<boolean>;
  setBandRecording(on: boolean): Promise<boolean>;
  liveReps(): Promise<number | null>;
  resumeStream(): Promise<void>;
}

export interface LiveData {
  live: LiveState;
  syncProgress: SyncProgressView | null;
  pendingDelete: PendingDelete | null;
  ecgLive: EcgLiveState;
  rawLive: RawLiveState;
}

export interface LiveDataStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveData;
}

export interface BuiltDonation extends DonationResult {
  workspaceUri: string;
}

export interface AppData {
  ready: boolean;
  storageProblem: StorageProblem | null;
  days: DayRecord[];
  sleepEdits: SleepEditRow[];
  sleepEditLimits: SleepEditLimits;
  device: DeviceStatus;
  profile: Profile;
  settings: Settings;
  userData: UserData;
  bodyMeasurements: BodyMeasurement[];
  labResults: LabResult[];
  cuffReadings: CuffReading[];
  cycle: CycleData;
  strength: StrengthData;
  strengthActions: StrengthActions;
  journalNotes: JournalNote[];
  vendorData: VendorData;
  notice: Notice | null;
  inbox: InboxEntry[];
  notificationPermission: PermissionState;
  healthConnect: HealthConnectView;
  activities: ActivityRow[];
  scan(): Promise<DiscoveredBand[]>;
  pair(bandId: string, ownerSince: string): Promise<void>;
  sync(): Promise<void>;
  startLive(): Promise<void>;
  reportLiveLoad(dayLoad: number | null): void;
  readBandConfig(): Promise<void>;
  bandActions: BandActions;
  alarm: AlarmView;
  alarmActions: AlarmActions;
  ecgRecordings: EcgSummary[];
  ecgWrist: Wrist;
  ecgActions: EcgActions;
  rawStreams: RawStreamActions;
  motion: MotionState;
  motionActions: MotionActions;
  stopLive(): Promise<void>;
  exportData(content?: ExportContent): Promise<void>;
  storageStats(): Promise<StorageStats | null>;
  chargeHistory(sinceS: number): Promise<number[]>;
  deleteAllData(): Promise<boolean>;
  listDonationDays(): Promise<DonationDay[]>;
  buildDonation(days: readonly string[], onProgress: (progress: DonationProgress) => void, signal: AbortSignal): Promise<BuiltDonation>;
  saveDonation(built: BuiltDonation): Promise<SaveOutcome>;
  shareDonationPart(built: BuiltDonation, fileName: string): Promise<void>;
  discardDonation(built: BuiltDonation): void;
  updateProfile(patch: Partial<Profile>): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  updateUserData(patch: Partial<UserData>): Promise<boolean>;
  saveBodyMeasurement(id: number | null, input: BodyMeasurementInput): Promise<boolean>;
  removeBodyMeasurement(id: number): Promise<boolean>;
  saveLabResult(id: number | null, input: LabResultInput): Promise<boolean>;
  removeLabResult(id: number): Promise<boolean>;
  saveCuffReading(input: CuffReadingInput): Promise<boolean>;
  removeCuffReading(id: number): Promise<boolean>;
  savePeriod(id: number | null, input: PeriodInput): Promise<boolean>;
  removePeriod(id: number): Promise<boolean>;
  saveSymptom(input: SymptomInput): Promise<boolean>;
  removeSymptom(id: number): Promise<boolean>;
  savePregnancy(dueDay: string): Promise<boolean>;
  removePregnancy(): Promise<boolean>;
  removeAllCycleData(): Promise<boolean>;
  saveJournalNote(id: number | null, input: JournalNoteInput): Promise<boolean>;
  removeJournalNote(id: number): Promise<boolean>;
  importVendorFiles(files: SourceFile[], rejected: FileReport[], options?: { fromDay?: string | null }): Promise<VendorImportResult | null>;
  removeVendorData(): Promise<boolean>;
  heartRateBetween(fromS: number, toS: number, bucketS?: number): Promise<HeartRatePoint[]>;
  spo2Between(fromS: number, toS: number): Promise<Spo2Point[]>;
  sleepStagesBetween(fromS: number, toS: number): Promise<StageEpochRow[]>;
  routeFor(activityId: number): Promise<RoutePoint[]>;
  saveSleepEdit(request: SleepEditRequest): Promise<SleepEditOutcome>;
  deleteSleepEdit(id: number): Promise<boolean>;
  removeDetectedSleep(item: EditableSleep): Promise<boolean>;
  saveActivity(draft: ActivityDraft, id?: number): Promise<number | null>;
  deleteActivity(target: DeleteTarget): Promise<boolean>;
  undoDelete(): Promise<void>;
  clearNotice(): void;
  refreshNotifications(): Promise<void>;
  setNotificationsEnabled(enabled: boolean): Promise<PermissionState>;
  requestNotificationPermission(): Promise<PermissionState>;
  refreshWidgets(): Promise<void>;
  refreshWidgetsAfterPin(): Promise<void>;
  markInboxRead(ids?: readonly string[]): Promise<void>;
  clearInbox(): Promise<void>;
  refreshHealthConnect(): Promise<void>;
  setHealthConnectType(type: HcDataType, enabled: boolean): Promise<boolean>;
  setHealthConnectTypes(types: readonly HcDataType[], enabled: boolean): Promise<HcDataType[]>;
  setHealthConnectAfterSync(enabled: boolean): Promise<void>;
  requestHealthConnectAccess(): Promise<void>;
  syncHealthConnect(): Promise<void>;
  openHealthConnectSettings(): void;
  installHealthConnect(): Promise<void>;
}

export type ParityLevel = 'A' | 'B' | 'C' | 'D';
