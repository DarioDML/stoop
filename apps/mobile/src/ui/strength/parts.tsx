import type { MuscleGroup } from '@openhoop/core';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useAppData } from '@/data/context';
import { MUSCLE_GROUPS, STRENGTH_LIMITS, cleanName, exerciseLabel, exerciseRefs, formatVolume, type ExerciseRef, type LibraryId, type MuscleLoad } from '@/data/strength';
import type { SessionLoad } from '@/data/strength';
import type { Units } from '@/data/types';
import type { TranslationKey } from '@/i18n';
import { useT, type TFunction } from '@/i18n/useT';
import { deviceTzOffsetS, unixToIsoDate } from '@/lib/dates';
import { formatNumber } from '@/lib/format';
import { useUnits, weightIn, weightUnit, type Measure } from '@/lib/units';
import { ProgressBar } from '@/ui/activity/parts';
import { AppText } from '@/ui/AppText';
import { Card } from '@/ui/Card';
import { Chip, Pill } from '@/ui/Chip';
import { Button, Field } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { Screen } from '@/ui/Screen';
import { TopBar } from '@/ui/TopBar';
import { spacing, useTheme } from '@/ui/theme';

export function todayIso(): string {
  const now = new Date(Date.now());
  return unixToIsoDate(Math.floor(now.getTime() / 1000), deviceTzOffsetS(now));
}

export function loadReasonKey(reason: string | null): TranslationKey {
  if (reason === 'low-coverage') return 'strength.load.lowCoverage';
  if (reason === 'missing-signal') return 'strength.load.missing';
  return 'strength.load.noData';
}

export function loadText(t: TFunction, load: SessionLoad, num: (value: number, decimals?: number) => string): string {
  return load.value === null ? t(loadReasonKey(load.reason)) : t('strength.load.value', { value: num(load.value, 1) });
}

export function formatSessionDay(day: string, language: 'en' | 'nl'): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString(language === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function tidy(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface StrengthLabels {
  units: Units;
  unit: string;
  libraryName: (id: LibraryId) => string;
  muscleName: (muscle: MuscleGroup) => string;
  nameOf: (key: string, stored: string) => string;
  kg: (value: number, decimals?: number) => string;
  num: (value: number, decimals?: number) => string;
  weight: (kg: number) => string;
  weightText: (kg: number) => string;
  volumeText: (kg: number) => string;
  volume: (kg: number) => Measure;
  setSummary: (sets: number, reps: number, kg: number) => string;
  day: (day: string) => string;
}

export function useStrengthLabels(): StrengthLabels {
  const { t, language } = useT();
  const units = useUnits();
  const unit = weightUnit(units);
  const libraryName = (id: LibraryId): string => t(`strength.ex.${id}`);
  const weight = (kg: number): string => {
    const value = tidy(weightIn(kg, units));
    return formatNumber(value, Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2, language);
  };
  const weightText = (kg: number): string => `${weight(kg)} ${unit}`;
  const volume = (kg: number): Measure => {
    const measure = formatVolume(kg, units, language);
    const big = units === 'imperial' ? t('strength.unit.thousandPounds') : t('strength.unit.tonnes');
    return { value: measure.value, unit: measure.scale === 'thousand' ? big : unit };
  };
  return {
    units,
    unit,
    libraryName,
    muscleName: (muscle) => t(`strength.muscle.${muscle}`),
    nameOf: (key, stored) => exerciseLabel(key, stored, libraryName),
    kg: (value, decimals = 0) => formatNumber(weightIn(value, units), decimals, language),
    num: (value, decimals = 0) => formatNumber(value, decimals, language),
    weight,
    weightText,
    volumeText: (kg) => {
      const measure = volume(kg);
      return `${measure.value} ${measure.unit}`;
    },
    volume,
    setSummary: (sets, reps, kg) => (kg > 0 ? t('strength.common.setSummary', { sets, reps, weight: weightText(kg) }) : t('strength.common.setSummaryBody', { sets, reps })),
    day: (day) => formatSessionDay(day, language),
  };
}

interface PageProps {
  title: string;
  intro?: string;
  testID: string;
  close?: boolean;
  right?: ReactNode;
  center?: ReactNode;
  hero?: ReactNode;
  scrollEnabled?: boolean;
  children: ReactNode;
}

export function StrengthPage({ title, intro, testID, close = false, right, center, hero, scrollEnabled = true, children }: PageProps) {
  return (
    <Screen
      tint="load"
      testID={testID}
      scrollEnabled={scrollEnabled}
      header={
        <>
          <TopBar title={title} back={!close} close={close} right={right} center={center} />
          {hero}
          {intro ? (
            <AppText variant="lead" soft>
              {intro}
            </AppText>
          ) : null}
        </>
      }>
      {children}
    </Screen>
  );
}

interface PickerProps {
  exclude?: readonly string[];
  onPick: (exercise: ExerciseRef) => void;
  onClose: () => void;
}

const SHOWN = 60;

export function ExercisePicker({ exclude = [], onPick, onClose }: PickerProps) {
  const { t } = useT();
  const { colors } = useTheme();
  const { strength, strengthActions } = useAppData();
  const labels = useStrengthLabels();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup>('chest');
  const [nameError, setNameError] = useState<'length' | 'exists' | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const all = exerciseRefs(strength.customExercises, labels.libraryName).filter((ref) => !exclude.includes(ref.key));
  const needle = query.trim().toLowerCase();
  const matches = needle === '' ? all : all.filter((ref) => ref.name.toLowerCase().includes(needle));
  const shown = matches.slice(0, SHOWN);

  const create = async (): Promise<void> => {
    const cleaned = cleanName(name, STRENGTH_LIMITS.nameLength);
    if (cleaned === null) {
      setNameError('length');
      return;
    }
    const taken = exerciseRefs(strength.customExercises, labels.libraryName).some((ref) => ref.name.toLowerCase() === cleaned.toLowerCase());
    if (taken) {
      setNameError('exists');
      return;
    }
    if (await strengthActions.saveExercise({ name: cleaned, muscle })) {
      setName('');
      setNameError(null);
      setQuery(cleaned);
    }
  };

  const removeCustom = async (id: number): Promise<void> => {
    setConfirmId(null);
    await strengthActions.removeExercise(id);
  };

  return (
    <Card testID="exercise-picker">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="cardTitle">{t('strength.picker.title')}</AppText>
        <Button label={t('strength.picker.close')} variant="tertiary" onPress={onClose} testID="picker-close" />
      </View>
      <Field
        label={t('strength.picker.search')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        testID="picker-search"
      />
      {shown.length === 0 ? (
        <AppText variant="body" muted testID="picker-none">
          {t('strength.picker.none')}
        </AppText>
      ) : (
        shown.map((ref) => {
          const customId = ref.custom ? Number(ref.key.slice('custom:'.length)) : null;
          return (
            <View key={ref.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Pressable
                testID={`pick-${ref.key}`}
                accessibilityRole="button"
                accessibilityLabel={`${ref.name}, ${labels.muscleName(ref.muscle)}`}
                onPress={() => onPick(ref)}
                style={{ flex: 1, minHeight: 48, justifyContent: 'center', gap: 2 }}>
                <AppText variant="bodyStrong">{ref.name}</AppText>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <AppText variant="caption" muted>
                    {labels.muscleName(ref.muscle)}
                  </AppText>
                  {ref.custom ? <Chip label={t('strength.picker.custom')} small tone="purple" /> : null}
                </View>
              </Pressable>
              {customId !== null && Number.isInteger(customId) ? (
                confirmId === customId ? (
                  <Button
                    label={t('strength.common.confirmDelete')}
                    variant="danger"
                    onPress={() => void removeCustom(customId)}
                    testID={`pick-confirm-${customId}`}
                  />
                ) : (
                  <Pressable
                    testID={`pick-delete-${customId}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('strength.picker.delete', { name: ref.name })}
                    onPress={() => setConfirmId(customId)}
                    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="trash" color={colors.textMuted} size={18} />
                  </Pressable>
                )
              ) : null}
            </View>
          );
        })
      )}
      {matches.length > shown.length ? (
        <AppText variant="caption" muted>
          {t('strength.picker.more', { shown: shown.length, total: matches.length })}
        </AppText>
      ) : null}
      <AppText variant="caption" muted>
        {t('strength.picker.deleteHint')}
      </AppText>

      <AppText variant="capLarge" muted style={{ marginTop: spacing.md }}>
        {t('strength.picker.createTitle')}
      </AppText>
      <Field
        label={t('strength.picker.name')}
        hint={
          nameError === 'exists'
            ? t('strength.picker.exists')
            : nameError === 'length'
              ? t('strength.picker.errorName', { max: STRENGTH_LIMITS.nameLength.max })
              : t('strength.picker.nameHint', { max: STRENGTH_LIMITS.nameLength.max })
        }
        error={nameError !== null}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setNameError(null);
        }}
        testID="picker-name"
      />
      <AppText variant="capSmall" muted>
        {t('strength.picker.muscle')}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {MUSCLE_GROUPS.map((group) => (
          <Pill key={group} label={labels.muscleName(group)} selected={muscle === group} onPress={() => setMuscle(group)} testID={`picker-muscle-${group}`} />
        ))}
      </View>
      <Button label={t('strength.picker.create')} onPress={() => void create()} testID="picker-create" />
    </Card>
  );
}

interface LoadProps {
  rows: readonly MuscleLoad[];
  testID: string;
}

export function MuscleLoadRows({ rows, testID }: LoadProps) {
  const { t } = useT();
  const labels = useStrengthLabels();
  const top = Math.max(...rows.map((row) => row.volumeKg), 0);
  return (
    <View style={{ gap: spacing.md }} testID={testID}>
      {rows.map((row) => (
        <View key={row.muscle} style={{ gap: 4 }} testID={`${testID}-${row.muscle}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
            <AppText variant="bodyStrong">{labels.muscleName(row.muscle)}</AppText>
            <AppText variant="label" muted numeric>
              {t('strength.summary.loadRow', { sets: row.sets, volume: labels.volumeText(row.volumeKg) })}
            </AppText>
          </View>
          <ProgressBar fraction={top > 0 ? row.volumeKg / top : 0} label={labels.muscleName(row.muscle)} />
          {row.share !== null ? (
            <AppText variant="caption" muted numeric>
              {t('strength.summary.loadShare', { percent: Math.round(row.share * 100) })}
            </AppText>
          ) : null}
          {row.motionSets > 0 ? (
            <AppText variant="caption" muted numeric testID={`${testID}-${row.muscle}-motion`}>
              {t('strength.summary.motionSets', { motion: row.motionSets, sets: row.sets })}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}
