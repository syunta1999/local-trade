import type { IndicatorUi } from '../lib/types';

/** 移動平均の本数プリセット。色は colors.ts で本数ごとに固定 */
const MA_PRESETS = [5, 10, 25, 50, 75, 100, 200];
const BB_PERIODS = [10, 20, 25, 50];
const BB_SIGMAS = [1, 2, 3];
const RSI_PERIODS = [6, 9, 14, 21, 25];

/** 本数 × 足 が実時間で何分になるかを言い換える */
function formatSpan(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}分${s}秒` : `${m}分`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}時間${mm}分` : `${h}時間`;
}

type Props = {
  value: IndicatorUi;
  onChange: (patch: Partial<IndicatorUi>) => void;
  /** 足の秒数。本数から実時間を出すために使う */
  interval: number;
  disabled: boolean;
};

export function IndicatorBar({ value, onChange, interval, disabled }: Props) {
  const togglePeriod = (p: number) => {
    const next = value.maPeriods.includes(p)
      ? value.maPeriods.filter((x) => x !== p)
      : [...value.maPeriods, p].sort((a, b) => a - b);
    onChange({ maPeriods: next, maOn: true });
  };

  return (
    <div className="ind-bar">
      <div className={`ind-group${value.maOn ? ' on' : ''}`}>
        <button
          type="button"
          className={`ind-toggle${value.maOn ? ' on' : ''}`}
          onClick={() => onChange({ maOn: !value.maOn })}
          disabled={disabled}
          title="移動平均線の表示 / 非表示"
        >
          MA
        </button>
        <div className="ind-chips" role="group" aria-label="移動平均の本数">
          {MA_PRESETS.map((p) => {
            const active = value.maOn && value.maPeriods.includes(p);
            return (
              <button
                type="button"
                key={p}
                className={`ind-chip${active ? ' on' : ''}`}
                style={active ? { color: `var(--ma-${p}, var(--ma-x))`, borderColor: `var(--ma-${p}, var(--ma-x))` } : undefined}
                onClick={() => togglePeriod(p)}
                disabled={disabled}
                title={`${p}本移動平均（いまの足で ${formatSpan(p * interval)}）`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`ind-group${value.bbOn ? ' on' : ''}`}>
        <button
          type="button"
          className={`ind-toggle${value.bbOn ? ' on' : ''}`}
          onClick={() => onChange({ bbOn: !value.bbOn })}
          disabled={disabled}
          title="ボリンジャーバンドの表示 / 非表示"
        >
          BB
        </button>
        <select
          className="ind-select"
          value={value.bbPeriod}
          onChange={(e) => onChange({ bbPeriod: Number(e.target.value), bbOn: true })}
          disabled={disabled}
          title={`期間（いまの足で ${formatSpan(value.bbPeriod * interval)}）`}
        >
          {BB_PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}本
            </option>
          ))}
        </select>
        <div className="ind-chips" role="group" aria-label="標準偏差">
          {BB_SIGMAS.map((s) => (
            <button
              type="button"
              key={s}
              className={`ind-chip${value.bbOn && value.bbSigma === s ? ' on' : ''}`}
              onClick={() => onChange({ bbSigma: s, bbOn: true })}
              disabled={disabled}
              title={`±${s}σ のバンドを描く`}
            >
              {s}σ
            </button>
          ))}
        </div>
      </div>

      <div className={`ind-group${value.rsiOn ? ' on' : ''}`}>
        <button
          type="button"
          className={`ind-toggle${value.rsiOn ? ' on' : ''}`}
          onClick={() => onChange({ rsiOn: !value.rsiOn })}
          disabled={disabled}
          title="RSIの表示 / 非表示（下に専用ペインを開きます）"
        >
          RSI
        </button>
        <select
          className="ind-select"
          value={value.rsiPeriod}
          onChange={(e) => onChange({ rsiPeriod: Number(e.target.value), rsiOn: true })}
          disabled={disabled}
          title={`期間（いまの足で ${formatSpan(value.rsiPeriod * interval)}）`}
        >
          {RSI_PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}本
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
