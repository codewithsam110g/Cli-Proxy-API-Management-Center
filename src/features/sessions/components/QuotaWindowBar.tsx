import { useTranslation } from 'react-i18next';
import { Meter } from '@/features/dashboard/components/Meter';
import type { RoutingWindow } from '@/services/api/routingSessions';
import { formatCountdown, formatPercentLeft, parseMs, windowLabelText, windowTone } from '../logic';
import styles from './RoutingPanels.module.scss';

interface QuotaWindowBarProps {
  window: RoutingWindow;
  /** The account has neither been polled nor observed yet. */
  neverChecked: boolean;
  /** The latest check of the account failed (its reason sits on the warning icon). */
  checkFailed: boolean;
  nowMs: number;
}

/** One quota window: "5-hour  61% left", the bar with its reserve mark, and the reset countdown. */
export function QuotaWindowBar({ window, neverChecked, checkFailed, nowMs }: QuotaWindowBarProps) {
  const { t, i18n } = useTranslation();
  const label = windowLabelText(t, window.label);
  const remaining = window.remainingPercent;
  const tone = windowTone(remaining, window.reservePercent);
  const resetMs = parseMs(window.resetAt);
  const resetsIn =
    resetMs === null ? '' : t('sessions.resets_in', { time: formatCountdown(resetMs - nowMs) });

  let foot = resetsIn;
  if (remaining === null) {
    const unknown = window.stopped
      ? t('sessions.window_stopped')
      : checkFailed
        ? t('sessions.check_failed')
        : neverChecked
          ? t('sessions.not_checked')
          : t('sessions.no_recent_reading');
    foot = resetsIn && window.stopped ? `${unknown} · ${resetsIn}` : unknown;
  }

  const hover = [
    resetMs === null
      ? ''
      : t('sessions.resets_at', { time: new Date(resetMs).toLocaleString(i18n.language) }),
    window.reservePercent
      ? t('sessions.reserve_mark', { label, percent: window.reservePercent })
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const percentClass = [
    styles.windowPercent,
    remaining === null ? styles.windowPercentUnknown : '',
    tone === 'critical' ? styles.windowPercentStopped : '',
    tone === 'warning' ? styles.windowPercentLow : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.window}>
      <div className={styles.windowHead}>
        <span className={styles.windowLabel}>{label}</span>
        <span className={percentClass}>
          {remaining === null
            ? '—'
            : t('sessions.percent_left', { percent: formatPercentLeft(remaining) })}
        </span>
      </div>
      <div className={styles.barWrap} title={hover || undefined}>
        <Meter
          value={remaining}
          tone={tone}
          ariaLabel={
            remaining === null
              ? `${label}: ${foot}`
              : `${label}: ${t('sessions.percent_left', { percent: formatPercentLeft(remaining) })}`
          }
        />
        {window.reservePercent ? (
          <i
            className={styles.tick}
            style={{ left: `${Math.min(100, window.reservePercent)}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className={styles.windowFoot}>{foot}</div>
    </div>
  );
}
