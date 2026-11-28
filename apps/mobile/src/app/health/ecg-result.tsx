import type { EcgSummary, EcgSymptom } from '@openhoop/core';
import { ECG_SYMPTOMS } from '@openhoop/core/ecg-symptoms';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, View, type TextLayoutEvent } from 'react-native';

import { useAppData } from '@/data/context';
import type { Language } from '@/data/types';
import { singleParam } from '@/data/dailyDerived';
import { ECG_STRIP_S, ecgStrips, stripLength, toggleEcgSymptom, traceRange, movementBand, movementMissing } from '@/data/ecg';
import { ecgReportHtml } from '@/data/ecgReport';
import { shareEcgCsv } from '@/data/ecgShare';
import { shareReportPdf } from '@/data/reportShare';
import { useT, type TFunction } from '@/i18n/useT';
import { deviceTzOffsetS, todayIsoDate, unixToIsoDate } from '@/lib/dates';
import { formatClock, formatNumber, formatShortDay } from '@/lib/format';
import { AppText } from '@/ui/AppText';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/controls';
import { Callout } from '@/ui/health/Callout';
import { EcgPanel, EcgTrace } from '@/ui/health/EcgTrace';
import { HealthPage } from '@/ui/health/HealthPage';
import { SelectChip } from '@/ui/health/SelectChip';
import { useLayout } from '@/ui/layout';
import { LevelNote } from '@/ui/LevelNote';
import { ListGroup, ListRow } from '@/ui/ListGroup';
import { Num } from '@/ui/Num';
import { StateCard } from '@/ui/StateCard';
import { spacing, useTheme } from '@/ui/theme';
import { IconButton } from '@/ui/TopBar';

function SummaryRow({ label, value, narrow, testID }: { label: string; value: string; narrow: boolean; testID: string }) {
  const [wrapped, setWrapped] = useState(false);
  const onLines = (event: TextLayoutEvent): void => {
    if (event.nativeEvent.lines.length > 1) setWrapped(true);
  };
  if (narrow || wrapped) {
    return (
      <View testID={testID} style={{ gap: 2, minHeight: 44, justifyContent: 'center', paddingVertical: spacing.xs }}>
        <AppText variant="body" muted testID={`${testID}-label`}>
          {label}
        </AppText>
        <AppText variant="bodyStrong" numeric testID={`${testID}-value`}>
          {value}
        </AppText>
      </View>
    );
  }
  return (
    <View testID={testID} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, minHeight: 44 }}>
      <AppText variant="body" muted onTextLayout={onLines} style={{ flexShrink: 1, minWidth: 96 }} testID={`${testID}-label`}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" numeric onTextLayout={onLines} style={{ flexShrink: 1, textAlign: 'right' }} testID={`${testID}-value`}>
        {value}
      </AppText>
    </View>
  );
}

function dayLabel(t: TFunction, language: Language, unixS: number): string {
  const day = unixToIsoDate(unixS, deviceTzOffsetS(new Date(unixS * 1000)));
  return day === todayIsoDate() ? t('ecg.today') : formatShortDay(day, language);
}

function clock(unixS: number): string {
  return formatClock(unixS, deviceTzOffsetS(new Date(unixS * 1000)));
}

function when(t: TFunction, language: Language, unixS: number): string {
  return `${dayLabel(t, language, unixS)} ${clock(unixS)}`;
}

function wristText(t: TFunction, recording: EcgSummary): string {
  if (recording.wrist === null) return t('band.unknown');
  return t(recording.wrist === 'left' ? 'ecg.wristLeft' : 'ecg.wristRight');
}

function symptomsText(t: TFunction, symptoms: readonly EcgSymptom[]): string {
  return symptoms.length === 0 ? t('ecg.feel.notSaid') : symptoms.map((symptom) => t(`ecg.feel.${symptom}`)).join(', ');
}

function movementText(t: TFunction, language: Language, recording: EcgSummary, lastSyncAt: number | null): string {
  if (recording.movementG !== null) return t(`ecg.movement.${movementBand(recording.movementG)}`, { g: formatNumber(recording.movementG, 2, language) });
  return t(movementMissing(recording.t, recording.durationMs, lastSyncAt) === 'awaitingSync' ? 'ecg.movement.awaitingSync' : 'ecg.movement.noData');
}

function seconds(t: TFunction, recording: EcgSummary): string {
  return t('ecg.seconds', { seconds: Math.round(recording.durationMs / 1000) });
}

export default function EcgResultScreen() {
  const { t, language } = useT();
  const { colors } = useTheme();
  const layout = useLayout();
  const { ecgRecordings, ecgActions, heartRateBetween, device } = useAppData();
  const params = useLocalSearchParams<{ id?: string }>();
  const wanted = Number(singleParam(params.id) ?? NaN);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = ecgRecordings.find((r) => r.id === (picked ?? wanted)) ?? ecgRecordings[0] ?? null;
  const [loaded, setLoaded] = useState<{ id: number; samples: number[] | null; avgHr: number | null } | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);
  const [tags, setTags] = useState<{ id: number; symptoms: EcgSymptom[] } | null>(null);
  const tagWrites = useRef<Promise<void>>(Promise.resolve());

  const selectedId = selected?.id ?? null;
  const selectedStart = selected?.t ?? 0;
  const selectedLength = selected?.durationMs ?? 0;

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    void (async () => {
      const samples = await ecgActions.samples(selectedId);
      const hr = await heartRateBetween(selectedStart, selectedStart + Math.ceil(selectedLength / 1000), 1);
      const avgHr = hr.length === 0 ? null : Math.round(hr.reduce((sum, point) => sum + point.hr, 0) / hr.length);
      if (!cancelled) setLoaded({ id: selectedId, samples, avgHr });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedStart, selectedLength, ecgActions, heartRateBetween]);

  const current = selected !== null && loaded?.id === selected.id ? loaded : null;
  const symptoms = selected === null ? [] : tags !== null && tags.id === selected.id ? tags.symptoms : selected.symptoms;

  const feel = (symptom: EcgSymptom): void => {
    if (selected === null) return;
    const next = toggleEcgSymptom(symptoms, symptom);
    const id = selected.id;
    setTags({ id, symptoms: next });
    tagWrites.current = tagWrites.current.then(async () => {
      if (!(await ecgActions.setSymptoms(id, next))) setTags((current) => (current !== null && current.id === id && current.symptoms === next ? null : current));
    });
  };

  const summaryRows = (recording: EcgSummary, avgHr: number | null): Array<{ id: string; label: string; value: string }> => [
    { id: 'recorded', label: t('ecg.recorded'), value: when(t, language, recording.t) },
    { id: 'length', label: t('ecg.length'), value: seconds(t, recording) },
    { id: 'wrist', label: t('ecg.wrist'), value: wristText(t, recording) },
    { id: 'rate', label: t('ecg.rate'), value: recording.rateHz === null ? t('band.unknown') : t('ecg.rateValue', { rate: Math.round(recording.rateHz) }) },
    { id: 'samples', label: t('ecg.sampleCount'), value: String(recording.sampleCount) },
    { id: 'movement', label: t('ecg.movement'), value: movementText(t, language, recording, device.lastSyncAt) },
    { id: 'band-hr', label: t('ecg.bandHr'), value: avgHr === null ? t('ecg.bandHrNone') : t('ecg.bandHrValue', { bpm: avgHr }) },
    { id: 'felt', label: t('ecg.feel.title'), value: symptomsText(t, symptoms) },
  ];

  const exportPdf = async (): Promise<void> => {
    if (selected === null || current?.samples == null) return;
    setExporting('pdf');
    try {
      await shareReportPdf(
        ecgReportHtml({
          title: t('ecg.pdf.title'),
          rows: summaryRows(selected, current.avgHr),
          stripsTitle: t('ecg.strips', { seconds: ECG_STRIP_S }),
          samples: current.samples,
          rateHz: selected.rateHz,
          durationMs: selected.durationMs,
          notes: [t('ecg.bandHrNote'), t('ecg.info.body'), t('ecg.levelD'), t('health.mg.disclaimer')],
          language,
        }),
      );
    } catch {
      Alert.alert(t('ecg.shareFailed'));
    } finally {
      setExporting(null);
    }
  };

  const exportCsv = async (): Promise<void> => {
    if (selected === null || current?.samples == null) return;
    setExporting('csv');
    try {
      await shareEcgCsv(selected, current.samples);
    } catch {
      Alert.alert(t('ecg.shareFailed'));
    } finally {
      setExporting(null);
    }
  };

  const remove = (): void => {
    if (selected === null) return;
    Alert.alert(t('ecg.deleteTitle'), t('ecg.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('ecg.delete'), style: 'destructive', onPress: () => void ecgActions.remove(selected.id).then(() => setPicked(null)) },
    ]);
  };

  const canExport = exporting === null && current?.samples != null && current.samples.length > 0;

  const hero =
    selected === null ? (
      <View style={{ gap: spacing.sm }}>
        <AppText variant="h2" accessibilityRole="header">
          {t('health.ecgResult.heading')}
        </AppText>
        <AppText variant="lead" muted>
          {t('health.ecgResult.body')}
        </AppText>
      </View>
    ) : (
      <View style={{ gap: spacing.sm }} testID="ecg-hero">
        <AppText variant="capLarge" muted>
          {t('ecg.recorded')}
        </AppText>
        <View style={{ flexDirection: layout.narrow ? 'column' : 'row', alignItems: layout.narrow ? 'flex-start' : 'flex-end', justifyContent: 'space-between', gap: spacing.sm }}>
          <Num size={layout.narrow ? 56 : 72} testID="ecg-hero-time">
            {clock(selected.t)}
          </Num>
          <AppText variant="body" color={colors.textSoft} style={{ paddingBottom: 8 }} testID="ecg-hero-when">
            {`${dayLabel(t, language, selected.t)} · ${seconds(t, selected)}`}
          </AppText>
        </View>
      </View>
    );

  return (
    <HealthPage
      title={t('health.ecgResult.title')}
      tint="heart"
      testID="health-ecg-result"
      right={selected === null ? undefined : <IconButton icon="share" label={t('ecg.exportPdf')} onPress={() => void exportPdf()} testID="ecg-share-top" />}
      hero={hero}>
      {selected === null ? (
        <StateCard icon="pulse" tone="pink" title={t('ecg.none.title')} body={t('ecg.none.body')} actionLabel={t('ecg.start')} onAction={() => router.push('/health/ecg')} testID="ecg-none" />
      ) : (
        <>
          <EcgPanel testID="ecg-strips">
            <AppText variant="capSmall" muted style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.sm }}>
              {t('ecg.strips', { seconds: ECG_STRIP_S })}
            </AppText>
            {current === null ? (
              <AppText variant="label" muted style={{ padding: spacing.sm }}>
                {t('ecg.loading')}
              </AppText>
            ) : current.samples === null || current.samples.length === 0 ? (
              <AppText variant="label" muted style={{ padding: spacing.sm }}>
                {t('ecg.unreadable')}
              </AppText>
            ) : (
              (() => {
                const samples = current.samples;
                const perStrip = stripLength(samples.length, selected.rateHz, selected.durationMs);
                const range = traceRange(samples);
                return ecgStrips(samples, selected.rateHz, selected.durationMs).map((strip, i) => (
                  <EcgTrace key={i} samples={strip} height={72} range={range} fraction={strip.length / perStrip} grid testID={`ecg-strip-${i}`} />
                ));
              })()
            )}
          </EcgPanel>

          <Callout icon="info" title={t('ecg.info.title')} body={t('ecg.info.body')} testID="ecg-info" />

          <View style={{ gap: spacing.sm }} testID="ecg-feel">
            <AppText variant="capLarge" muted>
              {t('ecg.feel.question')}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {ECG_SYMPTOMS.map((symptom) => (
                <SelectChip key={symptom} label={t(`ecg.feel.${symptom}`)} selected={symptoms.includes(symptom)} onPress={() => feel(symptom)} testID={`ecg-feel-${symptom}`} />
              ))}
            </View>
            <AppText variant="caption" muted>
              {t('ecg.feel.hint')}
            </AppText>
          </View>

          <View style={{ flexDirection: layout.narrow ? 'column' : 'row', gap: spacing.md }}>
            <Button
              label={exporting === 'pdf' ? t('ecg.sharing') : t('ecg.exportPdf')}
              icon="file"
              variant="soft"
              onPress={() => void exportPdf()}
              disabled={!canExport}
              style={{ flex: layout.narrow ? undefined : 1, paddingHorizontal: spacing.md }}
              testID="ecg-export-pdf"
            />
            <Button
              label={exporting === 'csv' ? t('ecg.sharing') : t('ecg.exportCsv')}
              icon="download"
              variant="soft"
              onPress={() => void exportCsv()}
              disabled={!canExport}
              style={{ flex: layout.narrow ? undefined : 1, paddingHorizontal: spacing.md }}
              testID="ecg-share"
            />
          </View>

          <ListGroup title={t('ecg.historyTitle')}>
            {ecgRecordings.map((recording) => {
              const shown = recording.id === selected.id;
              return (
                <ListRow
                  key={recording.id}
                  testID={`ecg-item-${recording.id}`}
                  icon={{ icon: 'pulse', color: colors.ecg, background: colors.pinkSoft }}
                  title={when(t, language, recording.t)}
                  subtitle={`${seconds(t, recording)} · ${t('ecg.feel.short', { tags: symptomsText(t, shown ? symptoms : recording.symptoms) })}`}
                  value={shown ? t('ecg.shown') : undefined}
                  onPress={() => setPicked(recording.id)}
                  chevron={!shown}
                />
              );
            })}
          </ListGroup>

          <Card style={{ gap: spacing.xs }} testID="ecg-summary">
            {summaryRows(selected, current?.avgHr ?? null).map((row) => (
              <SummaryRow key={row.id} label={row.label} value={row.value} narrow={layout.narrow} testID={`ecg-${row.id}`} />
            ))}
            <AppText variant="caption" muted>
              {t('ecg.bandHrNote')}
            </AppText>
          </Card>

          <LevelNote level="D" text={t('ecg.levelD')} />

          <Button label={t('ecg.delete')} variant="tertiary" onPress={remove} testID="ecg-delete" />
        </>
      )}
      <AppText variant="caption" muted testID="mg-disclaimer">
        {t('health.mg.disclaimer')}
      </AppText>
    </HealthPage>
  );
}
