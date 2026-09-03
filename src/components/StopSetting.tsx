import { useState } from 'react';
import type { StopCfg, useTrading } from '../hooks/useTrading';
import { formatClock } from '../lib/csv';
import type { Box } from '../lib/settings';
import {
  closeTarget,
  orderLabel,
  profitPriceOf,
  roundToTick,
  stopPriceOf,
  type Order,
} from '../lib/trading';
import { Float } from './Float';

/**
 * 逆指値（損切り）と利確の設定の小窓。
 * それぞれ別々にオンにでき、オンの間は板・指値注文どちらから出した新規注文にも
 * 建値から幅ぶん離れた自動の返済（損切りは逆指値、利確は指値）が付く。
 * いま板に出ている自動の返済と、待っている新規もここで見える。
 */

const nf = new Intl.NumberFormat('ja-JP');
/** 幅の早見ボタン（刻みの本数） */
const PRESETS = [1, 2, 3, 5, 10];

type Props = {
  trading: ReturnType<typeof useTrading>;
  last: number;
  tickSize: number;
  box: Box;
  onBox: (b: Box) => void;
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onClose: () => void;
  place: (w: number, h: number) => { x: number; y: number };
};

/** 損切り / 利確 1つぶんの設定欄。オンオフ・幅・早見を1まとまりで出す */
function Section({
  label,
  tp,
  on,
  width,
  tickSize,
  onToggle,
  onWidth,
}: {
  label: string;
  /** 利確側か。スイッチの色を変える */
  tp?: boolean;
  on: boolean;
  width: number;
  tickSize: number;
  onToggle: () => void;
  onWidth: (w: number) => void;
}) {
  /**
   * 入力中だけ文字で持つ（null なら設定値をそのまま見せる）。
   * 数に直しながら持つと、入力途中の空欄で設定が 0 に落ちてしまう
   */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(width);

  const commit = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    onWidth(Math.round(v * 1e6) / 1e6);
  };
  const step = (n: number) => {
    const next = roundToTick(width + n * tickSize, tickSize);
    if (next > 0) onWidth(next);
  };
  const ticks = tickSize > 0 ? width / tickSize : 0;
  const tickNote = Number.isInteger(ticks) ? `${ticks}刻み` : `約${ticks.toFixed(1)}刻み`;

  return (
    <div className={`stp-sec${on ? ' on' : ''}`}>
      <button
        type="button"
        className={`stp-toggle${tp ? ' tp' : ''}${on ? ' on' : ''}`}
        onClick={onToggle}
        title={`オンの間、新規注文すべてに${label}が付きます`}
      >
        <span>
          {label} {on ? 'オン' : 'オフ'}
        </span>
        <i aria-hidden />
      </button>
      <div className="frm-row">
        <span className="frm-k">幅</span>
        <div className="lot wide">
          <button
            type="button"
            className="lot-btn"
            onClick={() => step(-1)}
            disabled={width <= tickSize}
            title={`${tickSize}円狭める`}
          >
            ▼
          </button>
          <input
            type="number"
            step={tickSize}
            min={tickSize}
            value={text}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setDraft(null)}
            aria-label={`${label}の幅(円/株)`}
          />
          <button type="button" className="lot-btn" onClick={() => step(1)} title={`${tickSize}円広げる`}>
            ▲
          </button>
        </div>
        <span className="frm-sub">円/株 · {tickNote}</span>
      </div>
      <div className="presets" aria-label={`${label}の幅の早見`}>
        {PRESETS.map((n) => {
          const w = roundToTick(n * tickSize, tickSize);
          return (
            <button
              type="button"
              key={n}
              className={`mini${w === width ? ' on' : ''}`}
              onClick={() => onWidth(w)}
              title={`${nf.format(w)}円`}
            >
              {n}刻み
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 自動の返済の一覧（板に出ている逆指値 / 利確） */
function AutoList({
  title,
  orders,
  kindLabel,
  tp,
  onCancel,
  onCancelAll,
}: {
  title: string;
  orders: Order[];
  kindLabel: (o: Order) => string;
  tp?: boolean;
  onCancel: (id: number) => void;
  onCancelAll?: () => void;
}) {
  return (
    <div className="ol">
      <div className="ol-head">
        <span>
          {title} {orders.length}件
        </span>
        {orders.length > 0 && onCancelAll && (
          <button type="button" className="mini danger" onClick={onCancelAll} title={`${title}だけをすべて取り消す`}>
            すべて取消
          </button>
        )}
      </div>
      {orders.length === 0 ? (
        <div className="ol-empty">まだありません</div>
      ) : (
        [...orders].reverse().map((o) => (
          <div key={o.id} className="ol-row" title={`${formatClock(o.placedAt)} に出た注文`}>
            <span className={`side ${o.side}`}>{o.side === 'buy' ? '買' : '売'}</span>
            <span className={`kind ${tp ? 'tp' : 'stop'}`}>{kindLabel(o)}</span>
            <span className="px">{nf.format(o.price)}</span>
            <span className="q">{nf.format(o.qty)}株</span>
            <span className="stopat" />
            <button type="button" className="x" onClick={() => onCancel(o.id)} title={`${orderLabel(o)} を取消`}>
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function StopSetting({
  trading,
  last,
  tickSize,
  box,
  onBox,
  collapsed,
  onCollapse,
  onClose,
  place,
}: Props) {
  const { stopCfg, setStopCfg, orders, long, short } = trading;
  const stops = orders.filter((o) => o.type === 'stop');
  /** 自動で出た利確（from 付きの指値の返済） */
  const profits = orders.filter(
    (o) => o.kind === 'close' && o.type === 'limit' && o.from !== undefined,
  );
  /** 損切り・利確付きで待っている新規注文 */
  const armed = orders.filter((o) => o.stop !== undefined || o.profit !== undefined);
  const anyOn = stopCfg.on || stopCfg.profitOn;

  const patch = (p: Partial<StopCfg>) => setStopCfg(p);

  /** 建玉ごとに、損切りでどれだけ守られているか */
  const covered = (target: 'long' | 'short') =>
    stops.filter((o) => closeTarget(o.side) === target).reduce((a, o) => a + o.qty, 0);

  const gripLabel = anyOn
    ? [stopCfg.on ? `損${nf.format(stopCfg.width)}` : '', stopCfg.profitOn ? `益${nf.format(stopCfg.profitWidth)}` : '']
        .filter(Boolean)
        .join('/')
    : 'オフ';

  return (
    <Float
      kind="stp"
      title="逆指値・利確"
      grip={
        <>
          逆指値・利確
          <b className={anyOn ? 'on' : ''}>{gripLabel}</b>
        </>
      }
      aside={stops.length + profits.length > 0 ? `板に ${stops.length + profits.length}件` : undefined}
      box={box}
      onBox={onBox}
      collapsed={collapsed}
      onCollapse={onCollapse}
      onClose={onClose}
      place={place}
    >
      <Section
        label="損切り（逆指値）"
        on={stopCfg.on}
        width={stopCfg.width}
        tickSize={tickSize}
        onToggle={() => patch({ on: !stopCfg.on })}
        onWidth={(w) => patch({ width: w })}
      />
      <Section
        label="利確"
        tp
        on={stopCfg.profitOn}
        width={stopCfg.profitWidth}
        tickSize={tickSize}
        onToggle={() => patch({ profitOn: !stopCfg.profitOn })}
        onWidth={(w) => patch({ profitWidth: w })}
      />

      <p className="flt-note">
        オンの間に出す<b>新規注文すべて</b>に付きます。損切りは建値から{' '}
        <b>{nf.format(stopCfg.width)}円</b> 不利な側の逆指値で、触れたら<b>そのときの値段</b>
        で返済（飛んだぶんは滑ります）。利確は建値から <b>{nf.format(stopCfg.profitWidth)}円</b>{' '}
        有利な側の指値です。オフにしても、すでに出ている注文は残ります。
      </p>

      {last > 0 && (
        <div className="stp-preview">
          <span>
            いま買うと{stopCfg.on && <> 損 <b>{nf.format(stopPriceOf('buy', last, stopCfg.width))}</b></>}
            {stopCfg.profitOn && <> 益 <b className="tp">{nf.format(profitPriceOf('buy', last, stopCfg.profitWidth))}</b></>}
            {!anyOn && ' —'}
          </span>
          <span>
            いま売ると{stopCfg.on && <> 損 <b>{nf.format(stopPriceOf('sell', last, stopCfg.width))}</b></>}
            {stopCfg.profitOn && <> 益 <b className="tp">{nf.format(profitPriceOf('sell', last, stopCfg.profitWidth))}</b></>}
            {!anyOn && ' —'}
          </span>
        </div>
      )}

      {(long.qty > 0 || short.qty > 0) && (
        <div className="stp-cover">
          {long.qty > 0 && (
            <span className={covered('long') >= long.qty ? 'ok' : ''}>
              買建 {nf.format(long.qty)}株 · 損切り {nf.format(covered('long'))}株
            </span>
          )}
          {short.qty > 0 && (
            <span className={covered('short') >= short.qty ? 'ok' : ''}>
              売建 {nf.format(short.qty)}株 · 損切り {nf.format(covered('short'))}株
            </span>
          )}
        </div>
      )}

      <AutoList
        title="板に出ている逆指値"
        orders={stops}
        kindLabel={(o) => (closeTarget(o.side) === 'long' ? '買建の返済' : '売建の返済')}
        onCancel={trading.cancel}
        onCancelAll={trading.cancelAllStops}
      />
      <AutoList
        title="板に出ている利確"
        orders={profits}
        kindLabel={(o) => (closeTarget(o.side) === 'long' ? '買建の返済' : '売建の返済')}
        tp
        onCancel={trading.cancel}
        onCancelAll={trading.cancelAllProfits}
      />

      {armed.length > 0 && (
        <div className="ol">
          <div className="ol-head">
            <span>損切り・利確付きで待っている新規 {armed.length}件</span>
          </div>
          {[...armed].reverse().map((o) => (
            <div key={o.id} className="ol-row" title={`${formatClock(o.placedAt)} に発注`}>
              <span className={`side ${o.side}`}>{o.side === 'buy' ? '買' : '売'}</span>
              <span className="kind">新規</span>
              <span className="px">{nf.format(o.price)}</span>
              <span className="q">{nf.format(o.qty)}株</span>
              <span className="stopat">
                {o.stop !== undefined ? `損 ${nf.format(o.stop)}` : ''}
                {o.stop !== undefined && o.profit !== undefined ? ' ' : ''}
                {o.profit !== undefined ? `益 ${nf.format(o.profit)}` : ''}
              </span>
              <button type="button" className="x" onClick={() => trading.cancel(o.id)} title={`${orderLabel(o)} を取消`}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </Float>
  );
}
