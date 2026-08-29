import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BotTrade, BotView } from '../lib/bot';
import { DOWN, UP } from '../lib/colors';
import { formatClock } from '../lib/csv';
import type { Box } from '../lib/settings';
import type { Tick } from '../lib/types';

/** ミニチャートの内部座標。preserveAspectRatio="none" で枠に合わせて伸ばす */
const VW = 300;
const VH = 56;
/** 値動きの線に使う点の数。ティックが何万本あってもここまで間引く */
const SPARK_POINTS = 220;

const nf = new Intl.NumberFormat('ja-JP');
const money = (n: number) => `${n > 0 ? '+' : ''}${nf.format(Math.round(n))}`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

type Props = {
  bots: BotView[];
  ticks: Tick[];
  /** ラウンドの範囲（ティックの通し番号） */
  startN: number;
  nowN: number;
  last: number;
  box: Box;
  onBox: (b: Box) => void;
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onClose: () => void;
};

/** ラウンド中の値動きを間引いて拾う */
function spark(ticks: Tick[], from: number, to: number) {
  const a = Math.max(0, Math.min(from, ticks.length - 1));
  const b = Math.max(a, Math.min(to, ticks.length - 1));
  const span = b - a;
  if (span < 1) return { pts: [] as { n: number; price: number }[], lo: 0, hi: 0 };
  const step = Math.max(1, Math.floor(span / SPARK_POINTS));
  const pts: { n: number; price: number }[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i <= b; i += step) {
    const p = ticks[i].price;
    pts.push({ n: i, price: p });
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  const lastTick = ticks[b];
  if (pts[pts.length - 1]?.n !== b) pts.push({ n: b, price: lastTick.price });
  return { pts, lo, hi };
}

export function BotBoard({
  bots,
  ticks,
  startN,
  nowN,
  last,
  box,
  onBox,
  collapsed,
  onCollapse,
  onClose,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef(box);
  useEffect(() => {
    boxRef.current = box;
  }, [box]);

  const onDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - boxRef.current.x, dy: e.clientY - boxRef.current.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      onBox({
        ...boxRef.current,
        x: Math.max(0, Math.min(window.innerWidth - 160, e.clientX - d.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 30, e.clientY - d.dy)),
      });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onBox]);

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
  }, [onBox]);

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
  }, [collapsed]);

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
  }, [collapsed, onBox]);

  const line = useMemo(() => spark(ticks, startN, nowN), [ticks, startN, nowN]);

  const style = { left: box.x, top: box.y > 0 ? box.y : undefined };

  if (collapsed) {
    return (
      <div className="botb collapsed" ref={el} style={style}>
        <header onPointerDown={onDown}>
          <button
            type="button"
            className="botb-grip"
            onClick={() => onCollapse(false)}
            title="botの売買を開く"
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
        <span className="botb-hint">枠を掴んで移動 / 右下で大きさ変更</span>
        <button type="button" className="x" onClick={() => onCollapse(true)} title="細く畳む">
          —
        </button>
        <button type="button" className="x" onClick={onClose} title="閉じる">
          ✕
        </button>
      </header>

      <div className="botb-body">
        {bots.length === 0 && <p className="botb-empty">対戦を始めるとここに出ます。</p>}
        {bots.map((b) => (
          <BotPanel key={b.id} bot={b} line={line} startN={startN} nowN={nowN} last={last} />
        ))}
      </div>
    </div>
  );
}

type Line = ReturnType<typeof spark>;

function BotPanel({
  bot,
  line,
  startN,
  nowN,
  last,
}: {
  bot: BotView;
  line: Line;
  startN: number;
  nowN: number;
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
        exitN: nowN,
        qty: bot.qty,
        pnl: bot.side === 'long' ? (last - bot.avg) * bot.qty : (bot.avg - last) * bot.qty,
      }
    : null;
  const total = bot.realized + (open?.pnl ?? 0);

  // 売買した値段も縦軸に入れる。枠外に線が飛び出さないようにするため
  let lo = line.lo;
  let hi = line.hi;
  for (const t of [...bot.trades, ...(open ? [open] : [])]) {
    lo = Math.min(lo, t.entry, t.exit);
    hi = Math.max(hi, t.entry, t.exit);
  }
  const span = Math.max(hi - lo, 1e-9);
  const x = (n: number) => ((Math.min(Math.max(n, startN), nowN) - startN) / Math.max(nowN - startN, 1)) * VW;
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

      <svg className="botp-art" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden>
        {line.pts.length > 1 && (
          <polyline
            points={line.pts.map((p) => `${x(p.n).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="#4d5765"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* 建てた値段から返した値段まで、1本の線で結ぶ。勝ちは赤 / 負けは青 */}
        {[...bot.trades, ...(open ? [open] : [])].map((t, i) => {
          const live = t.exitAt === 0;
          const c = t.pnl >= 0 ? UP : DOWN;
          return (
            <g key={i}>
              <line
                x1={x(t.entryN)}
                y1={y(t.entry)}
                x2={x(t.exitN)}
                y2={y(t.exit)}
                stroke={c}
                strokeWidth="1.6"
                strokeDasharray={live ? '3 2' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={x(t.entryN)} cy={y(t.entry)} r="2.4" fill={bot.color} />
              {!live && <circle cx={x(t.exitN)} cy={y(t.exit)} r="2.4" fill={c} />}
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
