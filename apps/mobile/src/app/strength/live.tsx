import type { LoadReference } from '@openhoop/analytics';
import type { SessionExercise, StrengthSession } from '@openhoop/core';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AppState, Pressable, View } from 'react-native';

import { useAppData, useLive, useRawLive } from '@/data/context';
import { REST_IDLE, REST_STEP_S, restBuzzDue, restReducer, restView, type RestEvent, type RestTimer } from '@/data/restTimer';
import {
  REST_OPTIONS_S,
  STRENGTH_LIMITS,
  activeSession,
  durationS,
  formatClockTimer,
  planned,
  sessionLoad,
  sessionTotals,
  type SessionLoad,
  setsDone,
  stepDraftValue,
  suggestReps,
  suggestSet,
  suggestedWeightKg,
  validateSetDraft,
  type ExerciseRef,
  type RestSeconds,
  type SetDraft,
  type SetField,
} from '@/data/strength';
import type { HeartRatePoint, SetMotionView } from '@/data/types';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { weightIn } from '@/lib/units';
import { ProgressBar } from '@/ui/activity/parts';
import { AppText } from '@/ui/AppText';
import { Card } from '@/ui/Card';
import { Chip, Pill } from '@/ui/Chip';
import { Button, Field } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { useLayout } from '@/ui/layout';
import { ToggleRow } from '@/ui/manage/rows';
import { Num } from '@/ui/Num';
import { Section } from '@/ui/Section';
import { StatGrid, GridTile } from '@/ui/StatGrid';
import { NumberStepper } from '@/ui/strength/NumberStepper';
import { ExercisePicker, StrengthPage, useStrengthLabels } from '@/ui/strength/parts';
import { useSessionHeartRate } from '@/ui/strength/useSessionHeartRate';
import { referenceKey, useLoadReference } from '@/ui/strength/useSessionLoads';
import { goBack } from '@/ui/TopBar';
import { radius, spacing, useTheme } from '@/ui/theme';

const STACK_BELOW_DP = 380;

function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function useRestTimer(onEnd: () => void): { timer: RestTimer; dispatch: (event: RestEvent) => void } {
  const [timer, setTimer] = useState<RestTimer>(REST_IDLE);
  const latest = useRef(timer);
  const ended = useRef(onEnd);
  ended.current = onEnd;
  useEffect(() => {
    const id = setInterval(() => {
      const atMs = Date.now();
      const before = latest.current;
      const after = restReducer(before, { kind: 'tick', atMs });
      if (after === before) return;
      latest.current = after;
      setTimer(after);
      if (restBuzzDue(before, after, atMs)) ended.current();
    }, 500);
    return () => clearInterval(id);
  }, []);
  const dispatch = (event: RestEvent): void => {
    const next = restReducer(latest.current, event);
    latest.current = next;
    setTimer(next);
  };
  return { timer, dispatch };
}

const LOAD_STEP_S = 15;
const NO_LOAD: SessionLoad = { value: null, reason: 'no-data' };

function useLiveLoad(session: StrengthSession | null, heartRate: readonly HeartRatePoint[], nowMs: number, referenceAt: (atS: number) => LoadReference): SessionLoad {
  const startedAt = session?.startedAt ?? 0;
  const reference = referenceAt(startedAt);
  const refKey = referenceKey(reference);
  const endS = Math.max(startedAt + 1, Math.floor(nowMs / 1000 / LOAD_STEP_S) * LOAD_STEP_S);
  const cache = useRef<{ points: readonly HeartRatePoint[]; startedAt: number; endS: number; referenceKey: string; value: SessionLoad } | null>(null);
  if (session === null) return NO_LOAD;
  const cached = cache.current;
  if (cached !== null && cached.points === heartRate && cached.startedAt === startedAt && cached.endS === endS && cached.referenceKey === refKey) return cached.value;
  const value = sessionLoad(heartRate, { start: startedAt, end: endS }, reference);
  cache.current = { points: heartRate, startedAt, endS, referenceKey: refKey, value };
  return value;
}

function liveLoadMissing(reason: string | null): TranslationKey {
  if (reason === 'low-coverage') return 'strength.live.loadLow';
  if (reason === 'missing-signal') return 'strength.load.missing';
  return 'strength.live.loadNone';
}

function useMotionText(): (view: SetMotionView | undefined, highRate: boolean) => string | null {
  const { t } = useT();
  const labels = useStrengthLabels();
  return (view, highRate) => {
    if (view === undefined) return null;
    if (view.status === 'readable' && view.repsDetected !== null) {
      return t('strength.motion.line', { reps: view.repsDetected, tut: Math.round(view.tutS ?? 0), tempo: labels.num(view.tempoS ?? 0, 1) });
    }
    if (view.status === 'unreadable') return t('strength.motion.unreadable');
    if (view.status === 'unmatched') return t('strength.motion.unmatched');
    return highRate ? t('strength.motion.none') : null;
  };
}

const LIVE_REPS_MS = 3_000;
const STREAM_RESUME_MS = 15_000;

export default function StrengthLiveScreen() {
  const { t } = useT();
  const { colors } = useTheme();
  const { narrow, width } = useLayout();
  const stackSteppers = narrow || width < STACK_BELOW_DP;
  const { strength, strengthActions, startLive, stopLive, device, bandActions, motion, motionActions } = useAppData();
  const live = useLive();
  const raw = useRawLive();
  const motionText = useMotionText();
  const labels = useStrengthLabels();
  const nowMs = useNowMs();
  const session = activeSession(strength.sessions);
  const referenceAt = useLoadReference();
  const connected = device.connection === 'connected';

  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [invalid, setInvalid] = useState<Record<string, SetField[]>>({});
  const [picking, setPicking] = useState(false);
  const [restS, setRestS] = useState<RestSeconds>(90);
  const [buzzOnRest, setBuzzOnRest] = useState(false);
  const [current, setCurrent] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const buzzWanted = useRef(false);
  buzzWanted.current = buzzOnRest && connected;
  const { timer, dispatch } = useRestTimer(() => {
    if (buzzWanted.current) void bandActions.buzzIfConnected?.('target');
  });
  const heartRate = useSessionHeartRate(session, live.active ? live.heartRate : null, live.active ? live.updatedAt : null);
  const load = useLiveLoad(session, heartRate, nowMs, referenceAt);
  const [bandReps, setBandReps] = useState<number | null>(null);
  const motionOn = motion.highRate && session !== null;
  const loggedCount = session?.sets.length ?? 0;
  useEffect(() => {
    if (!motionOn) {
      setBandReps(null);
      return undefined;
    }
    let cancelled = false;
    const poll = (): void => {
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      void motionActions.liveReps().then((reps) => {
        if (!cancelled) setBandReps(reps);
      });
    };
    poll();
    const id = setInterval(poll, LIVE_REPS_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [motionOn, loggedCount, motionActions]);
  const streamSeconds = useRef<number | null>(null);
  streamSeconds.current = raw.imu?.seconds ?? null;
  useEffect(() => {
    if (!motionOn) return undefined;
    let last = streamSeconds.current;
    const id = setInterval(() => {
      const now = streamSeconds.current;
      if (now === null || now === last) void motionActions.resumeStream();
      last = now;
    }, STREAM_RESUME_MS);
    return () => clearInterval(id);
  }, [motionOn, motionActions]);
  const startedLiveHere = useRef(false);
  const stopLiveRef = useRef(stopLive);
  stopLiveRef.current = stopLive;
  useEffect(
    () => () => {
      if (startedLiveHere.current) {
        startedLiveHere.current = false;
        void stopLiveRef.current();
      }
    },
    [],
  );

  if (session === null) {
    return (
      <StrengthPage title={t('strength.live.title')} testID="strength-live" close>
        <Card>
          <AppText variant="title">{t('strength.live.none')}</AppText>
          <AppText variant="body" muted testID="live-none">
            {t('strength.live.noneBody')}
          </AppText>
        </Card>
      </StrengthPage>
    );
  }

  const nowS = Math.floor(nowMs / 1000);
  const rest = restView(timer, nowMs);
  const total = session.sets.length;
  const exercises = session.exercises;
  const index = Math.min(current, Math.max(0, exercises.length - 1));
  const exercise: SessionExercise | undefined = exercises[index];
  const volume = labels.volume(sessionTotals(session.sets).volumeKg);
  const weightStep = labels.units === 'imperial' ? 5 : 2.5;
  const weightLimits = { min: 0, max: Math.floor(weightIn(STRENGTH_LIMITS.weightKg.max, labels.units)) };
  const hrShown = live.active && live.heartRate !== null ? live.heartRate : null;

  const patchDraft = (key: string, base: SetDraft, change: Partial<SetDraft>): void => {
    setDrafts((existing) => ({ ...existing, [key]: { ...(existing[key] ?? base), ...change } }));
    setInvalid((existing) => ({ ...existing, [key]: [] }));
  };

  const log = async (key: string, name: string, muscle: ExerciseRef['muscle'], draft: SetDraft, storedKg: number): Promise<void> => {
    const result = validateSetDraft(draft, labels.units, storedKg);
    if (!result.ok) {
      setInvalid((existing) => ({ ...existing, [key]: result.invalid }));
      return;
    }
    setBusy(true);
    const saved = await strengthActions.logSet(session.id, { exerciseKey: key, exerciseName: name, muscle, ...result.value });
    setBusy(false);
    if (!saved) return;
    setDrafts((existing) => Object.fromEntries(Object.entries(existing).filter(([other]) => other !== key)));
    setInvalid((existing) => ({ ...existing, [key]: [] }));
    dispatch({ kind: 'start', atMs: Date.now(), seconds: restS });
  };

  const stopLiveIfStartedHere = async (): Promise<void> => {
    if (startedLiveHere.current) {
      startedLiveHere.current = false;
      await stopLive();
    }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    const done = await strengthActions.finishSession(session.id);
    setBusy(false);
    if (!done) return;
    await stopLiveIfStartedHere();
    router.replace({ pathname: '/strength/summary', params: { id: String(session.id) } });
  };

  const discard = async (): Promise<void> => {
    setConfirmDiscard(false);
    if (await strengthActions.removeSession(session.id)) {
      await stopLiveIfStartedHere();
      goBack();
    }
  };

  const add = async (ref: ExerciseRef): Promise<void> => {
    setPicking(false);
    if (await strengthActions.addSessionExercise(session.id, planned(ref))) setCurrent(exercises.length);
  };

  const hero = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
        {exercise !== undefined ? (
          <>
            <AppText variant="cap" color={colors.info} testID="live-position">
              {t('strength.live.exerciseOf', { n: index + 1, total: exercises.length })}
            </AppText>
            <AppText variant="title" style={{ fontSize: 26, lineHeight: 32 }} testID="live-exercise-name">
              {labels.nameOf(exercise.exerciseKey, exercise.exerciseName)}
            </AppText>
          </>
        ) : (
          <AppText variant="cap" color={colors.info}>
            {t('strength.live.noExercise')}
          </AppText>
        )}
      </View>
      <View
        testID="live-hr"
        accessible
        accessibilityLabel={`${t('strength.live.hr')}: ${hrShown === null ? t('strength.live.hrNone') : `${hrShown} bpm`}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name="heart" color={colors.negative} size={22} fill={colors.negative} />
        <Num size={36} unit={hrShown === null ? undefined : 'bpm'} unitSize={13} unitColor={colors.textMuted}>
          {hrShown === null ? '–' : `${hrShown}`}
        </Num>
      </View>
    </View>
  );

  const setTable = (item: SessionExercise): ReactElement => {
    const key = item.exerciseKey;
    const name = labels.nameOf(key, item.exerciseName);
    const logged = session.sets.filter((set) => set.exerciseKey === key);
    const base = suggestSet(item, session.sets, labels.units);
    const draft = drafts[key] ?? base;
    const bad = invalid[key] ?? [];
    const upcoming = Math.max(0, item.sets - logged.length - 1);
    const counted = suggestReps(bandReps, draft.reps);
    const steppers = (value: SetDraft, active: boolean, row: number): ReactElement => (
      <View style={{ flexDirection: stackSteppers ? 'column' : 'row', gap: spacing.sm, alignItems: stackSteppers ? 'flex-start' : 'center' }}>
        <NumberStepper
          value={value.reps}
          onChangeText={(reps) => patchDraft(key, draft, { reps })}
          onStep={(direction) => patchDraft(key, draft, { reps: stepDraftValue(draft.reps, direction, STRENGTH_LIMITS.reps, 0) })}
          label={`${t('strength.live.reps')}, ${t('strength.live.setNumber', { n: row })}`}
          lessLabel={t('strength.live.lessReps')}
          moreLabel={t('strength.live.moreReps')}
          error={active && bad.includes('reps')}
          disabled={!active}
          testID={active ? `live-reps-${key}` : `live-plan-reps-${key}-${row}`}
        />
        <NumberStepper
          value={value.weight}
          onChangeText={(weight) => patchDraft(key, draft, { weight })}
          onStep={(direction) => patchDraft(key, draft, { weight: stepDraftValue(draft.weight, direction * weightStep, weightLimits, 2) })}
          label={`${t('strength.live.weight')} (${labels.unit}), ${t('strength.live.setNumber', { n: row })}`}
          lessLabel={t('strength.live.lessWeight')}
          moreLabel={t('strength.live.moreWeight')}
          decimal
          error={active && bad.includes('weight')}
          disabled={!active}
          testID={active ? `live-weight-${key}` : `live-plan-weight-${key}-${row}`}
        />
      </View>
    );
    return (
      <Card testID={`live-exercise-${key}`} style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="capSmall" muted style={{ width: 28 }}>
            {t('strength.live.setHead')}
          </AppText>
          <AppText variant="capSmall" muted style={{ flex: 1 }} numberOfLines={2}>
            {`${t('strength.live.reps')} · ${labels.unit}`}
          </AppText>
          {logged.length === 0 ? (
            <Pressable
              testID={`live-remove-${key}`}
              accessibilityRole="button"
              accessibilityLabel={t('strength.live.removeExercise', { name })}
              onPress={() => void strengthActions.removeSessionExercise(item.id)}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trash" color={colors.textMuted} size={18} />
            </Pressable>
          ) : null}
        </View>
        {logged.map((set, at) => {
          const line = `${t('strength.live.setLine', { n: at + 1, reps: set.reps, weight: labels.weightText(set.weightKg) })}${set.rpe === null ? '' : ` · ${t('strength.live.setRpe', { rpe: labels.num(set.rpe, Number.isInteger(set.rpe) ? 0 : 1) })}`}`;
          const measured = motionText(motion.sets[set.id], motion.highRate);
          return (
            <View key={set.id}>
            <View
              testID={`live-set-${set.id}`}
              accessible
              accessibilityLabel={line}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, borderTopWidth: 1, borderTopColor: colors.border, opacity: 0.7 }}>
              <Num size={18} color={colors.textMuted} style={{ width: 28 }}>
                {`${at + 1}`}
              </Num>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
                <Num size={20}>{`${set.reps} ×`}</Num>
                <Num size={20} unit={labels.unit} unitSize={12} unitColor={colors.textMuted}>
                  {labels.weight(set.weightKg)}
                </Num>
                {set.rpe === null ? null : <Chip label={t('strength.live.setRpe', { rpe: labels.num(set.rpe, Number.isInteger(set.rpe) ? 0 : 1) })} small />}
              </View>
              <Icon name="check" color={colors.positive} size={22} strokeWidth={2.5} />
              <Pressable
                testID={`live-delete-set-${set.id}`}
                accessibilityRole="button"
                accessibilityLabel={t('strength.live.removeSet', { n: at + 1, name })}
                onPress={() => void strengthActions.removeSet(set.id)}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" color={colors.textMuted} size={16} />
              </Pressable>
            </View>
            {measured === null ? null : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 36, paddingBottom: spacing.xs }} testID={`live-set-motion-${set.id}`}>
                <Icon name="pulse" color={colors.accent} size={14} />
                <AppText variant="caption" muted style={{ flexShrink: 1 }}>
                  {measured}
                </AppText>
              </View>
            )}
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xs }}>
          <Num size={18} color={colors.textMuted} style={{ width: 28 }}>
            {`${logged.length + 1}`}
          </Num>
          <View style={{ flex: 1, gap: spacing.xs }}>
            {steppers(draft, true, logged.length + 1)}
            {counted !== null && item === exercise ? (
              <Pressable
                testID={`live-band-reps-${key}`}
                accessibilityRole="button"
                onPress={() => patchDraft(key, draft, { reps: String(counted) })}
                style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft }}>
                <Icon name="pulse" color={colors.accent} size={14} />
                <AppText variant="label">{t('strength.motion.counted', { n: counted })}</AppText>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            testID={`live-log-${key}`}
            accessibilityRole="button"
            accessibilityLabel={t('strength.live.markDone', { n: logged.length + 1, name })}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void log(key, item.exerciseName, item.muscle, draft, suggestedWeightKg(item, session.sets))}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              borderWidth: 2,
              borderColor: colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: busy ? 0.4 : pressed ? 0.7 : 1,
            })}>
            <Icon name="check" color={colors.textMuted} size={18} />
          </Pressable>
        </View>
        {Array.from({ length: upcoming }, (_, at) => {
          const row = logged.length + 2 + at;
          return (
            <View key={`plan-${row}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.xs }}>
              <Num size={18} color={colors.textMuted} style={{ width: 28 }}>
                {`${row}`}
              </Num>
              <View style={{ flex: 1 }}>{steppers(base, false, row)}</View>
              <View style={{ width: 44, height: 44, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.border }} />
            </View>
          );
        })}
        <AppText variant="caption" muted numeric>
          {t('strength.live.progress', { done: setsDone(item, session.sets), target: item.sets })}
        </AppText>
        <Field
          label={t('strength.live.rpe')}
          error={bad.includes('rpe')}
          value={draft.rpe}
          onChangeText={(rpe) => patchDraft(key, draft, { rpe })}
          keyboardType="decimal-pad"
          testID={`live-rpe-${key}`}
        />
        <AppText variant="caption" color={bad.length > 0 ? colors.negative : colors.textMuted}>
          {bad.length > 0
            ? t('strength.live.errorSet')
            : `${t('strength.live.limits', {
                repsMin: STRENGTH_LIMITS.reps.min,
                repsMax: STRENGTH_LIMITS.reps.max,
                weightMin: labels.num(weightLimits.min),
                weightMax: labels.num(weightLimits.max),
                unit: labels.unit,
              })} ${t('strength.live.rpeHint')}`}
        </AppText>
      </Card>
    );
  };

  return (
    <StrengthPage
      title={session.name}
      testID="strength-live"
      close
      center={
        <View testID="live-elapsed" accessible accessibilityRole="header" accessibilityLabel={`${session.name}, ${t('strength.live.elapsed')} ${formatClockTimer(durationS(session, nowS))}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            <AppText variant="screenTitle" numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1 }}>
              {session.name}
            </AppText>
            <AppText variant="screenTitle" numberOfLines={1} style={{ flexShrink: 0 }}>
              {` · ${formatClockTimer(durationS(session, nowS))}`}
            </AppText>
          </View>
        </View>
      }
      hero={hero}>
      {live.active && live.heartRate === null ? (
        <AppText variant="caption" muted testID="live-hr-waiting">
          {t('strength.live.hrWaiting')}
        </AppText>
      ) : null}
      {!live.active ? (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" muted testID="live-hr-off">
            {t('strength.live.hrOff')}
          </AppText>
          <Button
            label={t('strength.live.hrStart')}
            variant="tertiary"
            icon="heart"
            onPress={() => {
              startedLiveHere.current = true;
              void startLive();
            }}
            testID="live-hr-start"
          />
        </View>
      ) : null}

      {exercise === undefined ? (
        <AppText variant="body" muted testID="live-empty">
          {t('strength.live.empty')}
        </AppText>
      ) : (
        setTable(exercise)
      )}

      {motion.highRate ? (
        <Card testID="live-motion" style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="pulse" color={colors.accent} size={18} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong">{t('strength.motion.title')}</AppText>
              <AppText variant="label" muted testID="live-motion-state">
                {raw.owners.workout.includes('imu') && raw.imu?.rateHz != null ? t('strength.motion.streaming', { rate: raw.imu.rateHz }) : t('strength.motion.waiting')}
              </AppText>
            </View>
          </View>
          <ToggleRow
            title={t('strength.motion.bandRecording')}
            subtitle={t('strength.motion.bandRecordingBody')}
            value={motion.bandRecording}
            onChange={(on) => void motionActions.setBandRecording(on)}
            testID="live-band-recording"
          />
        </Card>
      ) : null}

      <Card testID="live-rest">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
          <View style={{ gap: 4 }}>
            <AppText variant="capSmall" muted>
              {t('strength.live.rest')}
            </AppText>
            <Num size={48} testID="live-rest-value">
              {rest.remainingS === null ? '–' : formatClockTimer(rest.remainingS)}
            </Num>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {([-1, 1] as const).map((direction) => (
              <Pressable
                key={direction}
                testID={direction < 0 ? 'live-rest-minus' : 'live-rest-plus'}
                accessibilityRole="button"
                accessibilityLabel={t(direction < 0 ? 'strength.live.restLessLabel' : 'strength.live.restMoreLabel', { seconds: REST_STEP_S })}
                accessibilityState={{ disabled: rest.status !== 'running' }}
                disabled={rest.status !== 'running'}
                onPress={() => dispatch({ kind: 'adjust', atMs: Date.now(), deltaS: direction * REST_STEP_S })}
                style={({ pressed }) => ({
                  minHeight: 44,
                  minWidth: 64,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: rest.status !== 'running' ? 0.4 : pressed ? 0.7 : 1,
                })}>
                <AppText variant="cap">{t(direction < 0 ? 'strength.live.restLess' : 'strength.live.restMore', { seconds: REST_STEP_S })}</AppText>
              </Pressable>
            ))}
          </View>
        </View>
        <ProgressBar fraction={rest.fraction} color={colors.metric.loadBright} label={t('strength.live.rest')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {REST_OPTIONS_S.map((seconds) => (
            <Pill key={seconds} label={t('strength.live.restOption', { seconds })} selected={restS === seconds} onPress={() => setRestS(seconds)} testID={`live-rest-${seconds}`} />
          ))}
        </View>
        <AppText variant="caption" muted testID="live-rest-state" accessibilityLiveRegion="polite">
          {rest.status === 'idle' ? t('strength.live.restIdle') : rest.status === 'running' ? t('strength.live.restRunning') : t('strength.live.restDone')}
        </AppText>
        {rest.status !== 'idle' ? <Button label={t('strength.live.restSkip')} variant="tertiary" onPress={() => dispatch({ kind: 'skip' })} testID="live-rest-skip" /> : null}
        <ToggleRow
          title={t('strength.live.buzz')}
          subtitle={connected ? t('strength.live.buzzOn') : t('strength.live.buzzOff')}
          value={buzzOnRest}
          onChange={setBuzzOnRest}
          testID="live-rest-buzz"
        />
      </Card>

      <StatGrid testID="live-tiles">
        <GridTile
          label={t('strength.live.load')}
          value={load.value === null ? null : labels.num(load.value, 1)}
          missing={t(liveLoadMissing(load.reason))}
          caption={t('strength.live.loadNote')}
          testID="live-load"
        />
        <GridTile label={t('strength.live.volume')} value={volume.value} unit={volume.unit} testID="live-volume" />
      </StatGrid>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <Button
          label={t('strength.live.next')}
          variant="soft"
          disabled={index >= exercises.length - 1}
          onPress={() => setCurrent(index + 1)}
          style={{ flexGrow: 1, flexBasis: 140 }}
          testID="live-next"
        />
        <Button label={t('strength.live.finish')} onPress={() => void finish()} disabled={busy || total === 0} style={{ flexGrow: 1, flexBasis: 120 }} testID="live-finish" />
      </View>
      {total === 0 ? (
        <AppText variant="caption" muted testID="live-finish-hint">
          {t('strength.live.finishNeedsSet')}
        </AppText>
      ) : null}

      {exercises.length > 1 ? (
        <Section title={t('strength.live.exercises')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {exercises.map((item, at) => (
              <Pill
                key={item.id}
                label={t('strength.live.jump', { name: labels.nameOf(item.exerciseKey, item.exerciseName), done: setsDone(item, session.sets), target: item.sets })}
                selected={at === index}
                onPress={() => setCurrent(at)}
                testID={`live-jump-${item.exerciseKey}`}
              />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title={t('strength.live.addExercise')}>
        {picking ? (
          <ExercisePicker exclude={exercises.map((item) => item.exerciseKey)} onPick={(ref) => void add(ref)} onClose={() => setPicking(false)} />
        ) : (
          <Button label={t('strength.live.addExercise')} variant="secondary" icon="plus" onPress={() => setPicking(true)} testID="live-add" />
        )}
      </Section>

      {confirmDiscard ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' }}>
          <Button label={t('strength.live.confirmDiscard')} variant="danger" onPress={() => void discard()} testID="live-confirm-discard" />
          <Button label={t('strength.live.keepGoing')} variant="tertiary" onPress={() => setConfirmDiscard(false)} testID="live-keep" />
        </View>
      ) : (
        <Button label={t('strength.live.discard')} variant="tertiary" onPress={() => setConfirmDiscard(true)} testID="live-discard" />
      )}
    </StrengthPage>
  );
}
