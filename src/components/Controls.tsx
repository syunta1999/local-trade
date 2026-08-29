import { INTERVALS } from '../lib/candles';
import { formatClock } from '../lib/csv';

const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300];

type Props = {
  playing: boolean;
  speed: number;
  onSpeed: (v: number) => void;
  interval: number;
  onInterval: (v: number) => void;
  skipGaps: boolean;
  onSkipGaps: (v: boolean) => void;
  cursor: number;
  total: number;
  clock: number;
  onToggle: () => void;
  onSeek: (index: number) => void;
  onStep: (n: number) => void;
  disabled: boolean;
};

export function Controls({
  playing,
  speed,
  onSpeed,
  interval,
  onInterval,
  skipGaps,
  onSkipGaps,
  cursor,
  total,
  clock,
  onToggle,
  onSeek,
  onStep,
  disabled,
}: Props) {
  const pct = total > 0 ? (cursor / total) * 100 : 0;

  return (
    <div className="controls">
      <div className="transport">
        <button
          type="button"
          className="btn"
          onClick={() => onSeek(0)}
          disabled={disabled}
          title="先頭へ戻す"
        >
          ⏮
        </button>
        <button
          type="button"
          className="btn play"
          onClick={onToggle}
          disabled={disabled}
          title="再生 / 一時停止 (Space)"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onStep(1)}
          disabled={disabled}
          title="1約定進める (→)"
        >
          ⏭
        </button>

        <div className="clock" title="セッション内時刻">
          {formatClock(clock)}
        </div>

        <div className="seg" role="group" aria-label="再生倍速">
          {SPEEDS.map((s) => (
            <button
              type="button"
              key={s}
              className={`seg-btn${s === speed ? ' on' : ''}`}
              onClick={() => onSpeed(s)}
              disabled={disabled}
            >
              ×{s}
            </button>
          ))}
        </div>

        <label className="field">
          <span>足種</span>
          <select
            value={interval}
            onChange={(e) => onInterval(Number(e.target.value))}
            disabled={disabled}
          >
            {INTERVALS.map((iv) => (
              <option key={iv.seconds} value={iv.seconds}>
                {iv.label}
              </option>
            ))}
          </select>
        </label>

        <label className="check" title="昼休みなど約定の無い時間を早送りします">
          <input
            type="checkbox"
            checked={skipGaps}
            onChange={(e) => onSkipGaps(e.target.checked)}
          />
          <span>空白をスキップ</span>
        </label>
      </div>

      <div className="seek">
        <input
          type="range"
          min={0}
          max={Math.max(total, 1)}
          value={cursor}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={disabled}
          aria-label="シーク"
        />
        <div className="seek-meta">
          {cursor.toLocaleString('ja-JP')} / {total.toLocaleString('ja-JP')} 約定
          <span className="pct">{pct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
