import { useEffect, useRef, useState } from 'react';
import { INTERVALS } from '../lib/candles';
import { formatClock } from '../lib/csv';
import type { SoundChannel, SoundPrefs } from '../lib/sound';

const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300];

const SOUND_ITEMS: { key: SoundChannel; label: string; note: string }[] = [
  { key: 'bgm', label: 'BGM', note: 'チャレンジ中は音が厚くなる' },
  { key: 'tape', label: '値動き', note: '約定が流れるたびの音' },
  { key: 'fill', label: '約定', note: '自分の約定・違反・お題達成' },
];

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
  onRandom: () => void;
  sound: SoundPrefs;
  onSound: (ch: SoundChannel, on: boolean) => void;
  onHelp: () => void;
  files: string[];
  current: string;
  onSelectFile: (name: string) => void;
  onOpenFile: () => void;
  /** フッターを畳む */
  onCollapse: () => void;
  /** 何もないところを押したときも畳む */
  onBlankClick: (e: React.MouseEvent) => void;
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
  onRandom,
  sound,
  onSound,
  onHelp,
  files,
  current,
  onSelectFile,
  onOpenFile,
  onCollapse,
  onBlankClick,
  disabled,
}: Props) {
  const pct = total > 0 ? (cursor / total) * 100 : 0;

  return (
    <div className="controls" onClick={onBlankClick} title="何もないところをクリックすると閉じます">
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
        <button
          type="button"
          className="btn"
          onClick={onRandom}
          disabled={disabled}
          title="9:00〜10:00 のどこかからランダムに再生する"
        >
          🎲
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
          <span>足</span>
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
          <span>昼休みをスキップ</span>
        </label>

        <SoundMenu sound={sound} onSound={onSound} />

        <button
          type="button"
          className="chrome-x"
          onClick={onCollapse}
          title="フッターを閉じる（チャートが広がります）"
        >
          ▼
        </button>
      </div>

      <div className="seek">
        {/* 再生ボタンの真下。ここなら銘柄の切り替えを忘れない */}
        <div className="file">
          <label className="field" title="public/data にあるCSVから選ぶ">
            <span>CSVを選択</span>
            <select
              value={current}
              onChange={(e) => onSelectFile(e.target.value)}
              disabled={files.length === 0}
            >
              {files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn ghost"
            onClick={onOpenFile}
            title="端末のCSVを開く。public/data にも控えます"
          >
            CSVを開く
          </button>
        </div>

        <div className="seek-bar">
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

        <button type="button" className="btn help-btn" onClick={onHelp} title="各機能の説明を開く">
          説明
        </button>
      </div>
    </div>
  );
}

/** 音の種類ごとのオン・オフ。ボタンを押すとリストが開く */
function SoundMenu({
  sound,
  onSound,
}: {
  sound: SoundPrefs;
  onSound: (ch: SoundChannel, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 外側をクリックしたら閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const on = SOUND_ITEMS.filter((it) => sound[it.key]);
  const label =
    on.length === 0
      ? 'なし'
      : on.length === SOUND_ITEMS.length
        ? 'すべて'
        : on.map((it) => it.label).join('・');

  return (
    <div className="sound-menu" ref={box}>
      <button
        type="button"
        className={`btn ghost sound-btn${on.length ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="鳴らす音を選ぶ"
        aria-expanded={open}
      >
        {on.length ? '🔊' : '🔇'} 音: {label} ▾
      </button>
      {open && (
        <div className="sound-pop" role="group" aria-label="鳴らす音">
          {SOUND_ITEMS.map((it) => (
            <label key={it.key} className="sound-row">
              <input
                type="checkbox"
                checked={sound[it.key]}
                onChange={(e) => onSound(it.key, e.target.checked)}
              />
              <span className="sound-label">{it.label}</span>
              <span className="sound-note">{it.note}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
