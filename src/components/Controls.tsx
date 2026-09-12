import { useCallback, useEffect, useRef, useState } from 'react';
import { INTERVALS } from '../lib/candles';
import { formatClock } from '../lib/csv';
import type { ReplayEntry } from '../lib/csvfile';
import type { SoundChannel, SoundPrefs } from '../lib/sound';
import { swatchOf, THEMES } from '../lib/themes';

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
  theme: string;
  onTheme: (id: string) => void;
  onHelp: () => void;
  /** data/challenges を初期状態に戻す。成否を返す */
  onReset: () => Promise<boolean>;
  files: string[];
  current: string;
  onSelectFile: (name: string) => void;
  onOpenFile: () => void;
  /** 溜まっているチャレンジ。リプレイで選べるもの */
  replays: ReplayEntry[];
  /** いま見ているリプレイ。null なら通常モード */
  replayOf: ReplayEntry | null;
  onSelectReplay: (entry: ReplayEntry) => void;
  onExitReplay: () => void;
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
  theme,
  onTheme,
  onHelp,
  onReset,
  files,
  current,
  onSelectFile,
  onOpenFile,
  replays,
  replayOf,
  onSelectReplay,
  onExitReplay,
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
          <ReplayMenu
            replays={replays}
            replayOf={replayOf}
            onSelect={onSelectReplay}
            onExit={onExitReplay}
          />
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

        <div className="seek-end">
          <button type="button" className="btn tool-btn" onClick={onHelp} title="各機能の説明を開く">
            説明
          </button>
          <SettingsMenu
            sound={sound}
            onSound={onSound}
            theme={theme}
            onTheme={onTheme}
            skipGaps={skipGaps}
            onSkipGaps={onSkipGaps}
            onReset={onReset}
          />
        </div>
      </div>
    </div>
  );
}

/** ポップアップの閉じ方。外側クリックと Esc は設定でもリプレイでも同じ */
function useDismiss(open: boolean, close: () => void, box: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close, box]);
}

const nf = new Intl.NumberFormat('ja-JP');

/**
 * チャレンジのリプレイ。溜まった記録から1回を選ぶ。
 * CSVを開くボタンの隣に置いてあるのは、どちらも「何を再生するか」の選択だから。
 */
function ReplayMenu({
  replays,
  replayOf,
  onSelect,
  onExit,
}: {
  replays: ReplayEntry[];
  replayOf: ReplayEntry | null;
  onSelect: (entry: ReplayEntry) => void;
  onExit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box);

  return (
    <div className="rep-menu" ref={box}>
      <button
        type="button"
        className={`btn ghost rep-btn${replayOf ? ' on' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        title="過去のチャレンジを、そのときの売買ごとチャートで見直す"
        aria-expanded={open}
      >
        ⏱ リプレイ{replayOf ? '中' : ''}
      </button>

      {open && (
        <div className="rep-pop">
          <h4>チャレンジのリプレイ</h4>
          {replayOf && (
            <button
              type="button"
              className="rep-exit"
              onClick={() => {
                onExit();
                close();
              }}
            >
              リプレイをやめて通常の再生に戻す
            </button>
          )}
          {replays.length === 0 ? (
            <p className="rep-empty">
              まだ記録がありません。チャレンジを始めて売買すると、ここに溜まります。
            </p>
          ) : (
            <ul className="rep-list">
              {replays.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`rep-row${r.id === replayOf?.id ? ' on' : ''}`}
                    onClick={() => {
                      onSelect(r);
                      close();
                    }}
                    title={`${r.fileName} を ${r.fromClock} から再生します`}
                  >
                    <span className="rep-name">
                      {r.id}-{r.symbol}-{r.dateLabel}
                    </span>
                    <span className="rep-meta">
                      {r.fromClock}〜{r.toClock} · {r.trades.length}取引
                      <b className={r.pnl >= 0 ? 'up' : 'down'}>
                        {r.pnl >= 0 ? '+' : ''}
                        {nf.format(r.pnl)}
                      </b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 設定。音・配色・再生・記録の初期化をここにまとめる。
 * 説明ボタンの右に置いて、ふだん触らないものをツールバーから追い出している。
 */
function SettingsMenu({
  sound,
  onSound,
  theme,
  onTheme,
  skipGaps,
  onSkipGaps,
  onReset,
}: {
  sound: SoundPrefs;
  onSound: (ch: SoundChannel, on: boolean) => void;
  theme: string;
  onTheme: (id: string) => void;
  skipGaps: boolean;
  onSkipGaps: (v: boolean) => void;
  onReset: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  /** リセットは2段階。押しただけでは消さない */
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 閉じるときは確認も取り消す。開き直したときに「はい」が出たままにならないように
  const close = useCallback(() => {
    setOpen(false);
    setConfirm(false);
    setFailed(false);
  }, []);

  useDismiss(open, close, box);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await onReset();
    // うまくいったときは画面を作り直すので、ここで戻す必要はない
    if (ok) return;
    setBusy(false);
    setConfirm(false);
    setFailed(true);
  };

  return (
    <div className="set-menu" ref={box}>
      <button
        type="button"
        className={`btn tool-btn${open ? ' on' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        title="音・配色・記録の設定"
        aria-expanded={open}
      >
        設定
      </button>

      {open && (
        <div className="set-pop">
          <section className="set-sec">
            <h4>音</h4>
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
          </section>

          <section className="set-sec">
            <h4>テーマ</h4>
            <div className="theme-list">
              {THEMES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`theme-row${t.id === theme ? ' on' : ''}`}
                  onClick={() => onTheme(t.id)}
                  title={t.note}
                >
                  <Swatch id={t.id} />
                  <span className="theme-label">{t.label}</span>
                  {t.id === theme && <span className="theme-now">いま</span>}
                </button>
              ))}
            </div>
          </section>

          <section className="set-sec">
            <h4>再生</h4>
            <label className="sound-row">
              <input
                type="checkbox"
                checked={skipGaps}
                onChange={(e) => onSkipGaps(e.target.checked)}
              />
              <span className="sound-label">昼休み</span>
              <span className="sound-note">約定の無い時間を早送りする</span>
            </label>
          </section>

          <section className="set-sec">
            <h4>記録</h4>
            <p className="set-note">
              data/challenges の記録（チャレンジ・取引・ルール・画面の設定）を消して、
              はじめの状態に戻します。<b>元には戻せません。</b>
            </p>
            {confirm ? (
              <div className="set-confirm">
                <span>本当にリセットしますか？</span>
                <button type="button" className="btn danger" disabled={busy} onClick={run}>
                  {busy ? '消しています…' : 'はい、リセットする'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  やめる
                </button>
              </div>
            ) : (
              <button type="button" className="btn set-reset" onClick={() => setConfirm(true)}>
                リセット
              </button>
            )}
            {failed && (
              <p className="set-fail">
                消せませんでした。<code>npm run dev</code> で開いているか確かめてください。
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** 色見本。テーマ定義の色をそのまま並べるので、いま当たっているテーマに引きずられない */
function Swatch({ id }: { id: string }) {
  return (
    <span className="swatch">
      {swatchOf(id).map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}
