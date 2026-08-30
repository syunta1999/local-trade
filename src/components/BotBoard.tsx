import { useEffect, useMemo, useRef, useState } from 'react';
import { useDragBox } from '../hooks/useDragBox';
import type { BotTrade, BotView } from '../lib/bot';
import { INTERVALS, buildCandlesRange } from '../lib/candles';
import { formatClock } from '../lib/csv';
import type { Box } from '../lib/settings';
import type { Candle, Tick } from '../lib/types';

/**
 * ミニチャートの高さ(px)。横幅は枠に合わせて実測し、viewBox をそのピクセル数にする。
 * 決め打ちの viewBox を引き伸ばすとローソクが横に潰れて読めなくなるため。
 */
const VH = 64;
/** 枠の内側の余白（.botb-body の padding と .botp の枠線ぶん） */
const ART_PAD = 22;
/** ローソク1本ぶんの持ち場の最小幅(px)。これ以上は詰めない */
const MIN_SLOT = 2;
/** ローソクの実体の最大幅(px) */
const MAX_BODY = 20;
/** ミニチャートに最低これだけは本数がほしい */
const MIN_BARS = 8;

const nf = new Intl.NumberFormat('ja-JP');
const money = (n: number) => `${n > 0 ? '+' : ''}${nf.format(Math.round(n))}`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

type Props = {
  bots: BotView[];
  ticks: Tick[];
  /** ラウンドの範囲（ティックの通し番号） */
  startN: number;
  nowN: number;
  /** 足の秒数。メインのチャートと揃える */
  interval: number;
  /** ラウンドの長さ(秒)。横軸の枠を最初から取るのに使う */
  duration: number;
  last: number;
  box: Box;
  onBox: (b: Box) => void;
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onClose: () => void;
};

/**
 * 足の秒数を決める。基本はメインの設定と同じだが、ラウンドに対して粗すぎて
 * 数本しか立たないときだけ、MIN_BARS 本に届く細かさまで落とす
 */
function fitInterval(interval: number, duration: number) {
  if (duration <= 0) return interval;
  for (const iv of INTERVALS) {
    if (iv.seconds <= interval && duration / iv.seconds >= MIN_BARS) return iv.seconds;
  }
  return INTERVALS[INTERVALS.length - 1].seconds;
}

/** ラウンドの範囲をローソク足にする */
function roundBars(ticks: Tick[], from: number, to: number, interval: number) {
  if (ticks.length === 0 || to <= from) return { bars: [] as Candle[], lo: 0, hi: 0, interval };
  const bars = buildCandlesRange(ticks, from, to, interval);
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of bars) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  return { bars, lo, hi, interval };
}

export function BotBoard({
  bots,
  ticks,
  startN,
  nowN,
  interval,
  duration,
  last,
  box,
  onBox,
  collapsed,
  onCollapse,
  onClose,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const { boxRef, onDown, movedRef } = useDragBox(box, onBox, 160, 30);

  // 初回の置き場所と、画面の外に出ていたときの引き戻し
  useEffect(() => {
    const b = boxRef.current;
    const w = b.w || 560;
    const h = b.h || 420;
    // 既定はチャートの下半分。板と歩み値を隠さない場所に出す
    const x = b.x > 0 ? b.x : Math.max(16, Math.min(330, window.innerWidth - w - 16));
    const y = b.y > 0 ? b.y : window.innerHeight - h - 100;
    const fixed = {
      ...b,
      x: Math.max(0, Math.min(window.innerWidth - 160, x)),
      y: Math.max(8, Math.min(window.innerHeight - 30, y)),
    };
    if (fixed.x !== b.x || fixed.y !== b.y) onBox(fixed);
  }, [onBox, boxRef]);

  // 大きさは CSS の resize がインラインに書くので、当てるのは畳み方が変わったときだけ。
  // 畳んでいる間は中身に合わせたいので、指定そのものを外す
  useEffect(() => {
    const e = el.current;
    if (!e) return;
    if (collapsed) {
      e.style.width = '';
      e.style.height = '';
      return;
    }
    e.style.width = boxRef.current.w ? `${boxRef.current.w}px` : '';
    e.style.height = boxRef.current.h ? `${boxRef.current.h}px` : '';
  }, [collapsed, boxRef]);

  useEffect(() => {
    const e = el.current;
    if (!e || collapsed) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(e.offsetWidth);
      const h = Math.round(e.offsetHeight);
      const b = boxRef.current;
      if (b.w === w && b.h === h) return;
      onBox({ ...b, w, h });
    });
    ro.observe(e);
    return () => ro.disconnect();
  }, [collapsed, onBox, boxRef]);

  const barSec = fitInterval(interval, duration);
  const barLabel = INTERVALS.find((iv) => iv.seconds === barSec)?.label ?? '';
  const line = useMemo(
    () => roundBars(ticks, startN, nowN, barSec),
    [ticks, startN, nowN, barSec],
  );

  // 図の横幅を実測して viewBox に使う。枠を広げたぶんローソクの本数が同じまま太らない
  const body = useRef<HTMLDivElement>(null);
  const [artW, setArtW] = useState(520);
  useEffect(() => {
    const e = body.current;
    if (!e || collapsed) return;
    const ro = new ResizeObserver(() => setArtW(Math.max(120, e.clientWidth - ART_PAD)));
    ro.observe(e);
    return () => ro.disconnect();
  }, [collapsed]);

  const style = { left: box.x, top: box.y > 0 ? box.y : undefined };

  if (collapsed) {
    return (
      <div className="botb collapsed" ref={el} style={style}>
        <header onPointerDown={onDown}>
          <button
            type="button"
            className="grip botb-grip"
            onClick={() => {
              // 動かしただけのときは開かない
              if (!movedRef.current) onCollapse(false);
            }}
            title="押すと開く / 掴んで移動"
          >
            botの売買
            {bots.map((b) => (
              <i key={b.id} style={{ background: b.color }} />
            ))}
          </button>
        </header>
      </div>
    );
  }

  return (
    <div className="botb" ref={el} style={style}>
      <header onPointerDown={onDown}>
        <strong>botの売買</strong>
        <span className="botb-hint">{barLabel}足 · 枠を掴んで移動 / 右下で大きさ変更</span>
        <button type="button" className="x" onClick={() => onCollapse(true)} title="細く畳む">
          —
        </button>
        <button type="button" className="x" onClick={onClose} title="閉じる">
          ✕
        </button>
      </header>

      <div className="botb-body" ref={body}>
        {bots.length === 0 && <p className="botb-empty">対戦を始めるとここに出ます。</p>}
        {bots.map((b) => (
          <BotPanel key={b.id} bot={b} line={line} width={artW} duration={duration} last={last} />
        ))}
      </div>
    </div>
  );
}

type Bars = ReturnType<typeof roundBars>;

function BotPanel({
  bot,
  line,
  width,
  duration,
  last,
}: {
  bot: BotView;
  line: Bars;
  width: number;
  duration: number;
  last: number;
}) {
  const open: BotTrade | null = bot.side
    ? {
        side: bot.side,
        entry: bot.avg,
        exit: last,
        entryAt: bot.since,
        exitAt: 0,
        entryN: bot.sinceN,
        exitN: 0,
        qty: bot.qty,
        pnl: bot.side === 'long' ? (last - bot.avg) * bot.qty : (bot.avg - last) * bot.qty,
      }
    : null;
  const total = bot.realized + (open?.pnl ?? 0);

  const all = [...bot.trades, ...(open ? [open] : [])];

  // 売買した値段も縦軸に入れる。枠外に線が飛び出さないようにするため
  let lo = line.lo;
  let hi = line.hi;
  for (const t of all) {
    lo = Math.min(lo, t.entry, t.exit);
    hi = Math.max(hi, t.entry, t.exit);
  }
  const span = Math.max(hi - lo, 1e-9);

  // 横軸はラウンドの長さぶんの持ち場を最初から取っておく。
  // ある本数だけで幅を割ると、2本しかない間は端と端に離れて置かれ、
  // 1本増えるたびに全部が動いてしまう
  const planned = Math.ceil(duration / line.interval) + 1;
  const slots = Math.max(line.bars.length, Math.min(planned, Math.floor(width / MIN_SLOT)), 1);
  const slot = width / slots;
  // 実体は持ち場をはみ出させない。本数が多いときに隣と重なって塗り潰れるため
  const bw = Math.min(Math.max(slot * 0.62, 1.5), slot, MAX_BODY);
  const lastBarTime = line.bars[line.bars.length - 1]?.time ?? 0;
  // 時刻から足の位置を引く。値のつかない足は作られない（昼休みなど）ので、
  // 割り算では本数とずれる
  const xOf = (t: number) => {
    const bars = line.bars;
    if (bars.length === 0) return slot / 2;
    let a = 0;
    let b = bars.length - 1;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (bars[mid].time <= t) a = mid;
      else b = mid - 1;
    }
    return (a + 0.5) * slot;
  };
  const y = (p: number) => VH - 3 - ((p - lo) / span) * (VH - 6);

  const rows = [...bot.trades].reverse();

  return (
    <section className="botp">
      <div className="botp-head">
        <span className="dot" style={{ background: bot.color }} />
        <strong>{bot.name}</strong>
        <span className="botp-n">
          {bot.trades.length}回{bot.trades.length ? ` / ${bot.wins}勝` : ''}
          {open ? ' · 建玉中' : ''}
        </span>
        <span className={`botp-total ${tone(total)}`}>{money(total)}</span>
      </div>

      <svg className="botp-art" viewBox={`0 0 ${width} ${VH}`} aria-hidden>
        {/* ローソク足。持ち場はラウンドぶん先に取ってあるので、増えても位置は動かない */}
        {line.bars.map((c, i) => {
          const up = c.close >= c.open;
          const col = up ? 'var(--up)' : 'var(--down)';
          const cx = (i + 0.5) * slot;
          const yo = y(c.open);
          const yc = y(c.close);
          return (
            <g key={c.time}>
              <line
                x1={cx}
                y1={y(c.high)}
                x2={cx}
                y2={y(c.low)}
                stroke={col}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={cx - bw / 2}
                y={Math.min(yo, yc)}
                width={bw}
                height={Math.max(Math.abs(yc - yo), 0.8)}
                fill={col}
              />
            </g>
          );
        })}
        {/* 建てた値段から返した値段まで1本の線で結ぶ。勝ちは赤 / 負けは青 */}
        {all.map((t, i) => {
          const live = t.exitAt === 0;
          const c = t.pnl >= 0 ? 'var(--up)' : 'var(--down)';
          const x1 = xOf(t.entryAt);
          const x2 = live ? xOf(lastBarTime) : xOf(t.exitAt);
          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y(t.entry)}
                x2={x2}
                y2={y(t.exit)}
                stroke={c}
                strokeWidth="1.4"
                strokeDasharray={live ? '3 2' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={x1}
                cy={y(t.entry)}
                r="2.6"
                fill={bot.color}
                stroke="var(--bg)"
                strokeWidth="0.8"
              />
              {!live && (
                <circle
                  cx={x2}
                  cy={y(t.exit)}
                  r="2.6"
                  fill={c}
                  stroke="var(--bg)"
                  strokeWidth="0.8"
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="botp-rows">
        {rows.length === 0 && !open && <div className="botp-none">まだ売買していません</div>}
        {open && (
          <div className="botp-row live">
            <span className="t">{formatClock(open.entryAt)}</span>
            <span className={open.side === 'long' ? 'up' : 'down'}>
              {open.side === 'long' ? '買' : '売'}
            </span>
            <span className="px">
              {nf.format(Math.round(open.entry))} <b>→</b> 建玉中
            </span>
            <span className={`per ${tone(open.pnl)}`}>
              {money((open.side === 'long' ? last - open.entry : open.entry - last))}円/株
            </span>
            <span className={`pnl ${tone(open.pnl)}`}>{money(open.pnl)}</span>
          </div>
        )}
        {rows.map((t, i) => (
          <div className="botp-row" key={rows.length - i}>
            <span className="t">{formatClock(t.entryAt)}</span>
            <span className={t.side === 'long' ? 'up' : 'down'}>
              {t.side === 'long' ? '買' : '売'}
            </span>
            <span className="px">
              {nf.format(Math.round(t.entry))} <b>→</b> {nf.format(Math.round(t.exit))}
            </span>
            <span className={`per ${tone(t.pnl)}`}>
              {money(t.side === 'long' ? t.exit - t.entry : t.entry - t.exit)}円/株
            </span>
            <span className={`pnl ${tone(t.pnl)}`}>{money(t.pnl)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
