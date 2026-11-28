import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';

import { singleParam } from '@/data/dailyDerived';
import { useAppData } from '@/data/context';
import {
  LOAD_BUCKET_S,
  durationS,
  exerciseVolumes,
  finishedSessions,
  formatClockTimer,
  heartRateStats,
  muscleIntensity,
  muscleLoad,
  newRecords,
  sessionLoad,
  sessionRecords,
  sessionTotals,
  type HeartRateStats,
  type SessionLoad,
  type SessionRecord,
} from '@/data/strength';
import { useT } from '@/i18n/useT';
import { StatRow, StatTile } from '@/ui/activity/parts';
import { AppText } from '@/ui/AppText';
import { Card, CardHeader } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Button } from '@/ui/controls';
import type { ExplainTarget } from '@/ui/explain/ExplainProvider';
import { MetricName } from '@/ui/explain/MetricName';
import { Icon } from '@/ui/Icon';
import { LevelNote } from '@/ui/LevelNote';
import { Num } from '@/ui/Num';
import { ReportShareSheet } from '@/ui/plan/ReportShareSheet';
import { Section } from '@/ui/Section';
import { MuscleFigure } from '@/ui/strength/MuscleFigure';
import { MuscleLoadRows, StrengthPage, loadReasonKey, useStrengthLabels } from '@/ui/strength/parts';
import { referenceKey, useLoadReference } from '@/ui/strength/useSessionLoads';
import { IconButton, goBack } from '@/ui/TopBar';
import { spacing, useTheme } from '@/ui/theme';

const HR_BUCKET_S = 10;

export default function StrengthSummaryScreen() {
  const { t } = useT();
  const { colors } = useTheme();
  const { strength, strengthActions, heartRateBetween, days, motion } = useAppData();
  const labels = useStrengthLabels();
  const referenceAt = useLoadReference();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const idParam = singleParam(params.id);
  const finished = finishedSessions(strength.sessions);
  const requested = idParam !== null && /^\d{1,9}$/.test(idParam) ? Number(idParam) : null;
  const session = requested === null ? (finished[finished.length - 1] ?? null) : (finished.find((candidate) => candidate.id === requested) ?? null);

  const [hr, setHr] = useState<HeartRateStats | null | undefined>(undefined);
  const [load, setLoad] = useState<SessionLoad | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);

  const sessionId = session?.id ?? null;
  const startedAt = session?.startedAt ?? 0;
  const endedAt = session?.endedAt ?? 0;
  const reference = referenceAt(startedAt);
  const refKey = referenceKey(reference);
  const latestReference = useRef(reference);
  latestReference.current = reference;

  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    setHr(undefined);
    void heartRateBetween(startedAt, endedAt, HR_BUCKET_S).then((points) => {
      if (!cancelled) setHr(heartRateStats(points));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, startedAt, endedAt, heartRateBetween]);

  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    setLoad(undefined);
    void heartRateBetween(startedAt, endedAt, LOAD_BUCKET_S).then((points) => {
      if (!cancelled) setLoad(sessionLoad(points, { start: startedAt, end: endedAt }, latestReference.current));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, startedAt, endedAt, heartRateBetween, refKey]);

  if (session === null) {
    return (
      <StrengthPage title={t('strength.summary.title')} testID="strength-summary">
        <Card>
          <AppText variant="title">{t('strength.summary.empty')}</AppText>
          <AppText variant="body" muted testID="summary-empty">
            {t('strength.summary.emptyBody')}
          </AppText>
        </Card>
      </StrengthPage>
    );
  }

  const totals = sessionTotals(session.sets);
  const exercises = exerciseVolumes(session.sets);
  const oneRepMaxRecords = newRecords(session, strength.sessions);
  const records = sessionRecords(session, strength.sessions);
  const factors = new Map(session.sets.flatMap((set): [number, number][] => {
    const view = motion.sets[set.id];
    return view?.status === 'readable' ? [[set.id, view.factor]] : [];
  }));
  const muscles = muscleLoad(session.sets, factors);
  const intensity = muscleIntensity(muscles);
  const volume = labels.volume(totals.volumeKg);
  const time = formatClockTimer(durationS(session, 0));
  const loadValue = load === undefined || load.value === null ? null : labels.num(load.value, 1);
  const dayIndex = Math.max(0, days.findIndex((day) => day.day === session.day));
  const loadTarget: ExplainTarget = {
    term: 'load',
    index: days.length === 0 ? 0 : dayIndex,
    shown: { value: loadValue, unit: null, reason: load === undefined || load.value !== null ? null : t(loadReasonKey(load.reason)) },
  };
  const trained = muscles.filter((row) => row.sets > 0);
  const figureSummary =
    trained.length === 0
      ? t('strength.summary.figureNone')
      : t('strength.summary.figureSummary', { muscles: trained.slice(0, 3).map((row) => labels.muscleName(row.muscle)).join(', ') });

  const recordText = (record: SessionRecord): string => {
    const name = labels.nameOf(record.exerciseKey, record.exerciseName);
    if (record.kind === 'heaviest') return t('strength.summary.recordHeaviest', { name, weight: labels.weightText(record.weightKg), reps: record.reps });
    if (record.kind === 'reps') {
      return record.weightKg > 0
        ? t('strength.summary.recordReps', { name, reps: record.reps, weight: labels.weightText(record.weightKg) })
        : t('strength.summary.recordRepsBody', { name, reps: record.reps });
    }
    return t('strength.summary.recordVolume', { name, volume: labels.volumeText(record.volumeKg) });
  };

  const remove = async (): Promise<void> => {
    if (await strengthActions.removeSession(session.id)) goBack();
  };

  const heroItem = (label: ReactElement, value: ReactElement, testID: string): ReactElement => (
    <View testID={testID} style={{ gap: 6, flexShrink: 1, minWidth: 0 }}>
      {label}
      {value}
    </View>
  );

  const hero = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
      {heroItem(
        <AppText variant="capSmall" color={colors.info}>
          {t('strength.summary.volume')}
        </AppText>,
        <Num size={40} unit={volume.unit} unitSize={18} unitColor={colors.textMuted} adjustsFontSizeToFit>
          {volume.value}
        </Num>,
        'summary-volume',
      )}
      {heroItem(
        <AppText variant="capSmall" color={colors.info}>
          {t('strength.summary.time')}
        </AppText>,
        <Num size={40} adjustsFontSizeToFit>
          {time}
        </Num>,
        'summary-duration',
      )}
      {heroItem(
        <MetricName target={loadTarget} label={t('score.load')} variant="capSmall" muted={false} testID="summary-load-name" />,
        loadValue === null ? (
          <AppText variant="label" soft testID="summary-load-missing" style={{ maxWidth: 120 }}>
            {load === undefined ? '' : t(loadReasonKey(load.reason))}
          </AppText>
        ) : (
          <Num size={40} testID="summary-load-value">
            {loadValue}
          </Num>
        ),
        'summary-load-score',
      )}
    </View>
  );

  return (
    <StrengthPage
      title={t('strength.summary.titleDone', { name: session.name })}
      intro={labels.day(session.day)}
      testID="strength-summary"
      hero={hero}
      right={<IconButton icon="share" label={t('strength.summary.share')} onPress={() => setSharing(true)} testID="summary-share" />}>
      <Card testID="summary-load">
        <CardHeader title={t('strength.summary.load')} />
        <MuscleFigure intensity={intensity} summary={figureSummary} testID="summary-figure" />
        <MuscleLoadRows rows={muscles} testID="summary-load-rows" />
      </Card>

      <Card testID="summary-records">
        <CardHeader title={t('strength.summary.records')} />
        {records.length === 0 ? (
          <AppText variant="body" muted testID="summary-records-none">
            {t('strength.summary.recordsNone')}
          </AppText>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {records.map((record) => (
              <Chip key={`${record.exerciseKey}-${record.kind}`} label={recordText(record)} tone="gold" testID={`summary-pr-${record.kind}-${record.exerciseKey}`} />
            ))}
          </View>
        )}
        <AppText variant="caption" muted>
          {t('strength.summary.recordsNote')}
        </AppText>
      </Card>

      <LevelNote level={factors.size > 0 ? 'D' : 'C'} text={t(factors.size > 0 ? 'strength.summary.loadBodyMotion' : 'strength.summary.loadBody')} testID="summary-level" />

      <StatRow>
        <StatTile label={t('strength.summary.sets')} value={`${totals.sets}`} testID="summary-sets" />
        <StatTile label={t('strength.summary.reps')} value={`${totals.reps}`} testID="summary-reps" />
      </StatRow>
      <AppText variant="caption" muted>
        {t('strength.summary.volumeNote')}
      </AppText>

      <Section title={t('strength.summary.heartRate')}>
        <Card testID="summary-hr">
          {hr === undefined ? null : hr === null ? (
            <AppText variant="body" muted testID="summary-hr-none">
              {t('strength.summary.hrNone')}
            </AppText>
          ) : (
            <>
              <StatRow>
                <StatTile label={t('strength.summary.hrAvg')} value={`${Math.round(hr.avg)}`} unit="bpm" testID="summary-hr-avg" />
                <StatTile label={t('strength.summary.hrMax')} value={`${Math.round(hr.max)}`} unit="bpm" testID="summary-hr-max" />
              </StatRow>
              <AppText variant="caption" muted>
                {t('strength.summary.hrNote')}
              </AppText>
            </>
          )}
        </Card>
      </Section>

      <Section title={t('strength.summary.perExercise')}>
        {exercises.map((exercise) => {
          const name = labels.nameOf(exercise.exerciseKey, exercise.exerciseName);
          return (
            <Card
              key={exercise.exerciseKey}
              href={{ pathname: '/strength/exercise', params: { key: exercise.exerciseKey } }}
              accessibilityLabel={name}
              testID={`summary-exercise-${exercise.exerciseKey}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong">{name}</AppText>
                <AppText variant="label" muted numeric>
                  {t('strength.summary.exerciseMeta', { sets: exercise.sets, volume: labels.volumeText(exercise.volumeKg) })}
                </AppText>
                {exercise.topSet !== null ? (
                  <AppText variant="caption" muted numeric>
                    {t('strength.summary.topSet', { reps: exercise.topSet.reps, weight: labels.weightText(exercise.topSet.weightKg) })}
                  </AppText>
                ) : null}
                {oneRepMaxRecords.includes(exercise.exerciseKey) ? <Chip label={t('strength.summary.record')} tone="positive" small testID={`summary-record-${exercise.exerciseKey}`} /> : null}
              </View>
              <Icon name="chevronRight" color={colors.textMuted} size={18} />
            </Card>
          );
        })}
      </Section>

      <Button label={t('strength.summary.trends')} variant="secondary" icon="trends" onPress={() => router.push('/strength/trends')} testID="summary-trends" />
      {confirmDelete ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' }}>
          <Button label={t('strength.common.confirmDelete')} variant="danger" onPress={() => void remove()} testID="summary-confirm-delete" />
          <Button label={t('strength.common.keep')} variant="tertiary" onPress={() => setConfirmDelete(false)} testID="summary-keep" />
        </View>
      ) : (
        <Button label={t('strength.summary.delete')} variant="tertiary" onPress={() => setConfirmDelete(true)} testID="summary-delete" />
      )}

      <ReportShareSheet
        visible={sharing}
        onClose={() => setSharing(false)}
        title={t('strength.home.title')}
        range={labels.day(session.day)}
        headline={records.length === 0 ? session.name : t('strength.summary.shareRecords', { name: session.name, count: records.length })}
        stats={[
          { label: t('strength.summary.volume'), value: volume.value, unit: volume.unit },
          { label: t('strength.summary.time'), value: time },
          ...(loadValue === null ? [] : [{ label: t('score.load'), value: loadValue }]),
          { label: t('strength.summary.sets'), value: `${totals.sets}` },
        ]}
        fileName="openhoop-strength.png"
        sheetTitle={t('strength.summary.shareTitle')}
        sheetSubtitle={t('strength.summary.shareSubtitle')}
        testID="summary-share-sheet"
      />
    </StrengthPage>
  );
}
