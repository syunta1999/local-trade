import { useRef, useState } from 'react';
import type { useTrading } from '../hooks/useTrading';
import { formatClock } from '../lib/csv';
import type { Box } from '../lib/settings';
import {
  LOT,
  orderLabel,
  profitPriceOf,
  roundToTick,
  stopPriceOf,
  type OrderKind,
  type OrderSide,
} from '../lib/trading';
import { Float } from './Float';

/**
 * 指値注文の小窓。板をダブルクリックする代わりに、値段と株数を打ち込んで発注する。
 * 出した注文の一覧もここに出し、1件ずつ取り消せる。
 */

const nf = new Intl.NumberFormat('ja-JP');
/** 「注文しました」を出しておく時間(ms) */
const SENT_MS = 1800;

type Props = {
  trading: ReturnType<typeof useTrading>;
  /** 現在値 */
  last: number;
  /** 呼値の刻み */
  tickSize: number;
  /** セッション内の現在時刻(秒) */
  clock: number;
  disabled: boolean;
  box: Box;
  onBox: (b: Box) => void;
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onClose: () => void;
  /** 初回の置き場所 */
  place: (w: number, h: number) => { x: number; y: number };
};

export function LimitOrder({
  trading,
  last,
  tickSize,
  clock,
  disabled,
  box,
  onBox,
  collapsed,
  onCollapse,
  onClose,
  place,
}: Props) {
  const { orders, mode, lot, stopCfg, message } = trading;
  const [side, setSide] = useState<OrderSide>('buy');
  // 開いたときの板の設定を初期値にする。あとは窓の中で独立して変える
  const [kind, setKind] = useState<OrderKind>(mode);
  const [qty, setQty] = useState(lot);
  /**
   * 値段は文字で持つ。数に直しながら持つと、入力途中の "53" が 53円 として確定してしまう。
   * 開いた時点の現在値を入れておく。まだ値段が無ければ空で、プレースホルダーに現在値が出る
   */
  const [priceText, setPriceText] = useState(() => (last > 0 ? String(last) : ''));
  const [sent, setSent] = useState<string | null>(null);
  const sentTimer = useRef(0);

  const price = Number(priceText);
  const valid = priceText.trim() !== '' && Number.isFinite(price) && price > 0;
  /** ▼▲ で1刻み動かす。空欄なら現在値から始める */
  const step = (n: number) => {
    const base = valid ? price : last;
    if (!(base > 0)) return;
    const next = roundToTick(base + n * tickSize, tickSize);
    if (next > 0) setPriceText(String(next));
  };
  const diffTicks =
    valid && last > 0 && tickSize > 0 ? Math.round((price - last) / tickSize) : 0;
  /** 損切り・利確がオンなら、この注文に付く値段 */
  const stop =
    kind === 'open' && stopCfg.on && stopCfg.width > 0 && valid
      ? stopPriceOf(side, price, stopCfg.width)
      : null;
  const profit =
    kind === 'open' && stopCfg.profitOn && stopCfg.profitWidth > 0 && valid
      ? profitPriceOf(side, price, stopCfg.profitWidth)
      : null;

  const sideLabel = side === 'buy' ? '買い' : '売り';
  const kindLabel = kind === 'open' ? '新規' : side === 'buy' ? '売建の返済' : '買建の返済';

  const submit = () => {
    if (disabled || !valid) return;
    const ok = trading.place(side, price, Math.floor(clock), { kind, qty });
    if (!ok) return;
    setSent(`${sideLabel}${kind === 'open' ? '新規' : '返済'} ${nf.format(price)}円 ${nf.format(qty)}株 を注文しました`);
    window.clearTimeout(sentTimer.current);
    sentTimer.current = window.setTimeout(() => setSent(null), SENT_MS);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const rows = [...orders].reverse();

  return (
    <Float
      kind="lim"
      title="指値注文"
      grip={
        <>
          指値注文
          {orders.length > 0 && <b>{orders.length}</b>}
        </>
      }
      aside={orders.length > 0 ? `注文中 ${orders.length}件` : undefined}
      box={box}
      onBox={onBox}
      collapsed={collapsed}
      onCollapse={onCollapse}
      onClose={onClose}
      place={place}
    >
      <div className="frm-segs">
        <div className="seg" role="group" aria-label="売買">
          <button
            type="button"
            className={`seg-btn buy${side === 'buy' ? ' on' : ''}`}
            onClick={() => setSide('buy')}
          >
            買い
          </button>
          <button
            type="button"
            className={`seg-btn sell${side === 'sell' ? ' on' : ''}`}
            onClick={() => setSide('sell')}
          >
            売り
          </button>
        </div>
        <div className="seg" role="group" aria-label="注文の種類">
          <button
            type="button"
            className={`seg-btn${kind === 'open' ? ' on' : ''}`}
            onClick={() => setKind('open')}
          >
            新規
          </button>
          <button
            type="button"
            className={`seg-btn${kind === 'close' ? ' on' : ''}`}
            onClick={() => setKind('close')}
          >
            返済
          </button>
        </div>
      </div>

      <div className="frm-row">
        <span className="frm-k">値段</span>
        <div className="lot wide">
          <button type="button" className="lot-btn" onClick={() => step(-1)} disabled={disabled} title={`${tickSize}下げる`}>
            ▼
          </button>
          <input
            type="number"
            step={tickSize}
            min={tickSize}
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled}
            aria-label="値段(円)"
            placeholder={last ? String(last) : ''}
          />
          <button type="button" className="lot-btn" onClick={() => step(1)} disabled={disabled} title={`${tickSize}上げる`}>
            ▲
          </button>
        </div>
        <button
          type="button"
          className="mini"
          onClick={() => last > 0 && setPriceText(String(last))}
          disabled={disabled || !(last > 0)}
          title="現在値を入れる"
        >
          現在値
        </button>
        <span className="frm-sub">
          {valid && last > 0
            ? diffTicks === 0
              ? '現在値'
              : `現在値${diffTicks > 0 ? '+' : ''}${diffTicks}刻み`
            : ''}
        </span>
      </div>

      <div className="frm-row">
        <span className="frm-k">株数</span>
        <div className="lot wide">
          <button
            type="button"
            className="lot-btn"
            onClick={() => setQty((q) => Math.max(LOT, q - LOT))}
            disabled={disabled || qty <= LOT}
            title="100株減らす"
          >
            ▼
          </button>
          <input
            type="number"
            step={LOT}
            min={LOT}
            value={qty}
            onChange={(e) => {
              const v = Math.floor(Number(e.target.value) / LOT) * LOT;
              setQty(Math.max(LOT, Math.min(Number.isFinite(v) ? v : LOT, 1_000_000)));
            }}
            onKeyDown={onKey}
            disabled={disabled}
            aria-label="株数"
          />
          <button
            type="button"
            className="lot-btn"
            onClick={() => setQty((q) => q + LOT)}
            disabled={disabled}
            title="100株増やす"
          >
            ▲
          </button>
        </div>
        <button
          type="button"
          className="mini"
          onClick={() => setQty(lot)}
          disabled={disabled || qty === lot}
          title="板のロットに合わせる"
        >
          ロット
        </button>
      </div>

      {(stop !== null || profit !== null) && (
        <div
          className="ord-stop"
          title="逆指値・利確の設定がオンなので、この注文が約定すると自動で返済注文が出ます"
        >
          {stop !== null && (
            <>
              損切り <b>{nf.format(stop)}</b>円
            </>
          )}
          {stop !== null && profit !== null && ' / '}
          {profit !== null && (
            <>
              利確 <b className="tp">{nf.format(profit)}</b>円
            </>
          )}{' '}
          が付きます
        </div>
      )}

      <button
        type="button"
        className={`ord-go ${side}`}
        onClick={submit}
        disabled={disabled || !valid}
        title="Enter でも注文できます"
      >
        {sideLabel}
        {kindLabel} {nf.format(qty)}株 {valid ? `@${nf.format(price)}` : ''} を注文
      </button>

      {message && <div className="ord-msg bad">{message}</div>}
      {!message && sent && <div className="ord-msg">{sent}</div>}

      <div className="ol">
        <div className="ol-head">
          <span>注文中 {orders.length}件</span>
          <span className="ol-legend">クリックで取消</span>
        </div>
        {rows.length === 0 ? (
          <div className="ol-empty">注文はありません</div>
        ) : (
          rows.map((o) => (
            <div key={o.id} className="ol-row" title={`${formatClock(o.placedAt)} に発注`}>
              <span className={`side ${o.side}`}>{o.side === 'buy' ? '買' : '売'}</span>
              <span
                className={`kind${o.type === 'stop' ? ' stop' : o.kind === 'close' && o.from !== undefined ? ' tp' : ''}`}
              >
                {o.type === 'stop'
                  ? '逆指値'
                  : o.kind === 'open'
                    ? '新規'
                    : o.from !== undefined
                      ? '利確'
                      : '返済'}
              </span>
              <span className="px">{nf.format(o.price)}</span>
              <span className="q">{nf.format(o.qty)}株</span>
              <span className="stopat">
                {o.stop !== undefined ? `損 ${nf.format(o.stop)}` : ''}
                {o.stop !== undefined && o.profit !== undefined ? ' ' : ''}
                {o.profit !== undefined ? `益 ${nf.format(o.profit)}` : ''}
              </span>
              <button
                type="button"
                className="x"
                onClick={() => trading.cancel(o.id)}
                title={`${orderLabel(o)} を取消`}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </Float>
  );
}
