import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { changeSummary, parseBandConfig } from '@/data/bandConfig';
import { useAppData, useSyncProgress } from '@/data/context';
import type { LockState } from '@/data/types';
import { WEAR_LOCATIONS, type WearLocation } from '@/data/userData';
import { useT } from '@/i18n/useT';
import { formatAgo } from '@/lib/format';
import { AppText } from '@/ui/AppText';
import { BigStatRow, BigStatTile } from '@/ui/BigStat';
import { Card } from '@/ui/Card';
import { Button, RadioRow, Toggle } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { CapHeader, ListGroup, ListRow } from '@/ui/ListGroup';
import { CHARGING_REPORT_FRESH_S } from '@/ui/manage/deviceState';
import { PageHero, StatusDotChip } from '@/ui/manage/PageHero';
import { KeyValueRow } from '@/ui/manage/rows';
import { NoticeCard } from '@/ui/NoticeCard';
import { Screen } from '@/ui/Screen';
import { Sheet } from '@/ui/Sheet';
import { SyncBanner } from '@/ui/SyncBanner';
import { spacing, useTheme } from '@/ui/theme';
import { TopBar } from '@/ui/TopBar';

type Busy = 'test' | 'find' | 'stop' | 'hr' | null;

const FIND_BUZZ_MS = 6_000;

function WearLocationSheet({ visible, value, onPick, onClose }: { visible: boolean; value: WearLocation | null; onPick: (next: WearLocation) => void; onClose: () => void }) {
  const { t } = useT();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('device.wear.title')} subtitle={t('device.wear.sheetBody')} testID="wear-sheet">
      {WEAR_LOCATIONS.map((location) => (
        <RadioRow key={location} label={t(`device.wear.${location}`)} selected={value === location} onSelect={() => onPick(location)} testID={`wear-${location}`} />
      ))}
    </Sheet>
  );
}

export default function DeviceSettingsScreen() {
  const { device, sync, bandActions, userData, updateUserData, motion, motionActions } = useAppData();
  const syncProgress = useSyncProgress();
  const { t } = useT();
  const { colors } = useTheme();
  const [busy, setBusy] = useState<Busy>(null);
  const [findActive, setFindActive] = useState(false);
  const [wearOpen, setWearOpen] = useState(false);
  const config = useMemo(() => parseBandConfig(device.configSnapshot), [device.configSnapshot]);

  useEffect(() => {
    if (!findActive) return;
    const timer = setTimeout(() => setFindActive(false), FIND_BUZZ_MS);
    return () => clearTimeout(timer);
  }, [findActive]);

  const syncing = device.connection === 'syncing' || syncProgress !== null;
  const blocked = busy !== null || device.connection === 'syncing' || device.connection === 'connecting';
  const unknown = t('band.unknown');
  const nowS = Math.floor(Date.now() / 1000);
  const wear = device.band?.wear ?? null;
  const charging = device.band?.charging ?? null;
  const chargingNow = charging !== null && charging.charging && nowS - charging.at < CHARGING_REPORT_FRESH_S;
  const boot = device.band?.boot;
  const serial = device.serial ?? null;
  const lockBody: Record<LockState, string> = {
    open: t('lock.open.body'),
    locked: t('lock.locked.body'),
    'no-data': t('lock.no-data.body'),
    unknown: t('lock.unknown.body'),
  };
  const heroTitle = device.model === null ? (device.name ?? unknown) : t('more.deviceModel', { model: device.model });
  const mono = [serial === null ? null : t('device.hero.serial', { serial }), device.firmware === null ? null : t('device.hero.firmware', { firmware: device.firmware })]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const connected = device.connection !== 'disconnected';
  const summary = config.status === 'ok' ? changeSummary(config.snapshot) : null;
  const hr = device.hrBroadcast;
  const hrStatus =
    hr === null ? t('device.actions.hrUnknown') : t('device.actions.hrLastSet', { state: t(hr.on ? 'bandConfig.on' : 'bandConfig.off'), ago: formatAgo(t, nowS, hr.at) });

  const run = async (label: Exclude<Busy, null>, task: () => Promise<boolean>): Promise<boolean> => {
    setBusy(label);
    try {
      return await task();
    } finally {
      setBusy(null);
    }
  };
  const find = async (): Promise<void> => {
    if (await run('find', () => bandActions.buzz('find'))) setFindActive(true);
  };
  const stop = async (): Promise<void> => {
    if (await run('stop', () => bandActions.stopBuzz())) setFindActive(false);
  };

  const batteryChip =
    device.batteryPercent === null
      ? null
      : chargingNow
        ? { label: t('device.tile.charging'), tone: 'positive' as const }
        : device.lastSyncAt === null
          ? null
          : { label: t('device.tile.measured', { ago: formatAgo(t, nowS, device.lastSyncAt) }), tone: 'neutral' as const };

  const header = (
    <>
      <TopBar title={t('device.title')} />
      <PageHero icon="band" iconColor={colors.text} iconBackground={colors.surfaceAlt} title={heroTitle} mono={mono === '' ? undefined : mono} testID="device-hero">
        <StatusDotChip
          label={t(`connection.${device.connection}`)}
          color={connected ? colors.positive : colors.textMuted}
          background={connected ? colors.positiveSoft : colors.surfaceAlt}
          testID="device-connection"
        />
      </PageHero>
    </>
  );

  return (
    <Screen header={header} tint="neutral" testID="device-settings">
      <NoticeCard />
      <SyncBanner detailed />
      <BigStatRow>
        <BigStatTile
          testID="device-battery"
          label={t('device.tile.battery')}
          value={device.batteryPercent === null ? null : String(device.batteryPercent)}
          unit="%"
          missing={t('device.tile.batteryMissing')}
          chip={batteryChip}
        />
        <BigStatTile testID="device-battery-health" label={t('device.tile.health')} value={null} missing={t('device.tile.healthMissing')} caption={t('device.tile.healthCaption')} />
      </BigStatRow>

      {device.lockState === 'locked' ? (
        <Card tone="warning" style={{ gap: 6 }}>
          <AppText variant="bodyStrong" color={colors.warning}>
            {t('lock.locked.title')}
          </AppText>
          <AppText variant="body">{lockBody.locked}</AppText>
        </Card>
      ) : null}

      <CapHeader title={t('device.bandSection')} />
      <ListGroup>
        <ListRow
          title={t('device.wear.title')}
          subtitle={userData.wearLocation === null ? t('device.wear.notSet') : t(`device.wear.${userData.wearLocation}`)}
          onPress={() => setWearOpen(true)}
          testID="wear-row"
        />
        <ListRow
          title={t('device.config')}
          subtitle={summary === null ? t('device.configNotRead') : t('device.configMatch', { unchanged: summary.unchanged, total: summary.total })}
          href="/settings/band-config"
          testID="config-row"
        />
        <ListRow title={t('device.batteryPack')} subtitle={t('device.pack.experimental')} href="/settings/battery-pack" testID="pack-row" />
        <ListRow
          title={t('device.haptics')}
          subtitle={t('device.hapticsBody')}
          chevron={false}
          right={<Button label={t('device.buzz')} variant="soft" compact onPress={() => void run('test', () => bandActions.buzz('test'))} disabled={blocked} testID="buzz-test" />}
        />
        <ListRow
          title={t('device.findTitle')}
          subtitle={t('device.findBody')}
          chevron={false}
          right={
            findActive ? (
              <Button label={t('device.actions.stop')} variant="soft" compact onPress={() => void stop()} disabled={busy !== null} testID="buzz-stop" />
            ) : (
              <Button label={t('device.find')} variant="soft" compact onPress={() => void find()} disabled={blocked} testID="buzz-find" />
            )
          }
        />
      </ListGroup>
      <AppText variant="caption" muted>
        {t('device.rangeNote')}
      </AppText>

      <ListGroup>
        <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText variant="body" style={{ fontWeight: '500' }}>
                {t('device.broadcast')}
              </AppText>
              <AppText variant="label" muted>
                {t('device.broadcastBody')}
              </AppText>
            </View>
            {hr === null ? null : (
              <Toggle
                label={t('device.broadcast')}
                value={hr.on}
                disabled={blocked}
                onChange={(on) => void run('hr', () => bandActions.setHeartRateBroadcast(on))}
                testID="hr-toggle"
              />
            )}
          </View>
          {hr === null ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button label={t('device.broadcastOn')} variant="soft" compact onPress={() => void run('hr', () => bandActions.setHeartRateBroadcast(true))} disabled={blocked} testID="hr-on" />
              <Button label={t('device.broadcastOff')} variant="soft" compact onPress={() => void run('hr', () => bandActions.setHeartRateBroadcast(false))} disabled={blocked} testID="hr-off" />
            </View>
          ) : null}
          <AppText variant="caption" muted>
            {t('device.actions.hrBody')}
          </AppText>
          <AppText variant="caption" soft testID="hr-broadcast-status">
            {hrStatus}
          </AppText>
        </View>
        <View style={{ paddingVertical: spacing.md, gap: spacing.sm }} testID="motion-row">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText variant="body" style={{ fontWeight: '500' }}>
                {t('device.motion')}
              </AppText>
              <AppText variant="label" muted>
                {t('device.motionBody')}
              </AppText>
            </View>
            <Toggle label={t('device.motion')} value={motion.highRate} onChange={(on) => void motionActions.setHighRate(on)} testID="motion-toggle" />
          </View>
          <AppText variant="caption" muted>
            {t('device.motionCaption')}
          </AppText>
        </View>
      </ListGroup>

      <CapHeader title={t('device.firmwareSection')} />
      <Card style={{ flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surfaceAlt }}>
        <Icon name="lock" color={colors.textSoft} size={16} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="bodyStrong">{t('device.firmwareTitle')}</AppText>
          <AppText variant="body" soft>
            {t('device.firmwareBody')}
          </AppText>
        </View>
      </Card>

      <CapHeader title={t('device.statusSection')} />
      <ListGroup>
        <KeyValueRow label={t('band.model')} value={device.model ?? unknown} />
        <KeyValueRow label={t('band.firmware')} value={device.firmware ?? unknown} />
        <KeyValueRow label={t('band.battery')} value={device.batteryPercent === null ? unknown : `${device.batteryPercent}${t('unit.percent')}`} />
        <KeyValueRow label={t('band.lastSync')} value={device.lastSyncAt === null ? t('band.neverSynced') : formatAgo(t, nowS, device.lastSyncAt)} />
        <KeyValueRow label={t('band.backlog')} value={device.backlogPages === null ? unknown : t('band.backlogPages', { count: device.backlogPages })} />
        <KeyValueRow label={t('band.connection')} value={t(`connection.${device.connection}`)} />
        <KeyValueRow label={t('band.lock')} value={t(`lock.${device.lockState}`)} />
      </ListGroup>
      {device.lockState !== 'open' && device.lockState !== 'locked' ? (
        <AppText variant="label" muted>
          {lockBody[device.lockState]}
        </AppText>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        <Button label={syncing ? t('band.syncing') : t('band.sync')} onPress={() => void sync()} disabled={syncing} testID="sync-button" />
        <Button label={t('band.pair')} variant="secondary" onPress={() => router.push('/onboarding/pair')} testID="pair-link" />
      </View>

      <ListGroup title={t('device.status.title')}>
        <View testID="band-status">
          <AppText variant="label" muted style={{ paddingVertical: spacing.sm }}>
            {t('device.status.body')}
          </AppText>
        </View>
        <KeyValueRow
          testID="band-status-wear"
          label={t('device.status.wear')}
          value={wear === null ? unknown : t(wear.phase === 'on' ? 'device.status.onWrist' : 'device.status.offWrist')}
        />
        {wear !== null ? <KeyValueRow testID="band-status-wear-since" label={t('device.status.since')} value={formatAgo(t, nowS, wear.since)} /> : null}
        <KeyValueRow
          testID="band-status-charging"
          label={t('device.status.charging')}
          value={charging === null ? unknown : t(charging.charging ? 'device.status.chargingYes' : 'device.status.chargingNo')}
        />
        {charging !== null ? <KeyValueRow testID="band-status-charging-at" label={t('device.status.reported')} value={formatAgo(t, nowS, charging.at)} /> : null}
      </ListGroup>

      <ListGroup title={t('device.info.title')}>
        <KeyValueRow testID="band-info-signal" label={t('device.info.signalProcessing')} value={boot?.signalProcessingVersion ?? unknown} />
        <KeyValueRow testID="band-info-restarts" label={t('device.info.restarts')} value={boot?.bootCount === null || boot === undefined ? unknown : String(boot.bootCount)} />
        <KeyValueRow
          testID="band-info-last"
          label={t('device.info.lastRestart')}
          value={boot?.lastBootAt === null || boot === undefined ? unknown : formatAgo(t, nowS, boot.lastBootAt)}
        />
        <KeyValueRow
          testID="band-info-reason"
          label={t('device.info.restartReason')}
          value={boot?.rebootReason === null || boot === undefined ? unknown : `0x${boot.rebootReason.toString(16).padStart(4, '0')}`}
        />
      </ListGroup>

      <AppText variant="capLarge" color={colors.negative} style={{ marginTop: spacing.sm }}>
        {t('device.dangerTitle')}
      </AppText>
      <Button label={t('device.unpair')} variant="outlineDanger" onPress={() => router.push('/settings/safety-lock')} testID="danger-entry" />
      <AppText variant="label" muted>
        {t('device.dangerNote')}
      </AppText>

      <WearLocationSheet
        visible={wearOpen}
        value={userData.wearLocation}
        onClose={() => setWearOpen(false)}
        onPick={(wearLocation) => {
          setWearOpen(false);
          void updateUserData({ wearLocation });
        }}
      />
    </Screen>
  );
}
