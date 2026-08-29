/**
 * 約定シミュレータの中核。Reactに依存しない純粋なロジック。
 *
 * - ロングとショートを別々の建玉として持つ（両建て可）
 * - 注文は指値のみ。歩み値がその値段に触れたら約定
 * - 新規(open)は建玉を増やし、返済(close)は建玉を減らして損益を確定する
 */

/** 売買単位 */
export const LOT = 100;

/** 板のどちら側に出した注文か。買い=ロング新規/ショート返済、売り=ショート新規/ロング返済 */
export type OrderSide = 'buy' | 'sell';
/** 新規建て / 返済 */
export type OrderKind = 'open' | 'close';
export type PositionSide = 'long' | 'short';

export type Order = {
  id: number;
  side: OrderSide;
  kind: OrderKind;
  price: number;
  qty: number;
  /** 発注したセッション時刻(t) */
  placedAt: number;
};

export type Position = {
  qty: number;
  /** 平均建値 */
  avg: number;
  /** 建て始めた時刻(t)。全部返済すると 0 に戻る */
  since: number;
  /** 建て始めたティックの通し番号。建玉中の値動き(MAE/MFE)を後から追うのに使う */
  sinceN: number;
  /** 建てたときの発注→約定の待ち時間(秒) */
  wait: number;
};

/** 返済まで終わった1往復ぶんの記録 */
export type Trade = {
  id: number;
  side: PositionSide;
  qty: number;
  entry: number;
  exit: number;
  entryAt: number;
  exitAt: number;
  /** 建て・返済したティックの通し番号。この区間を走査して MAE/MFE を出す */
  entryN: number;
  exitN: number;
  /** 発注から約定までの待ち時間(秒) */
  entryWait: number;
  exitWait: number;
  /** 損益(円) */
  pnl: number;
};

export type TradingState = {
  orders: Order[];
  long: Position;
  short: Position;
  trades: Trade[];
  /** 確定損益の累計 */
  realized: number;
  seqOrder: number;
  seqTrade: number;
};

const emptyPosition = (): Position => ({ qty: 0, avg: 0, since: 0, sinceN: 0, wait: 0 });

export function createTrading(): TradingState {
  return {
    orders: [],
    long: emptyPosition(),
    short: emptyPosition(),
    trades: [],
    realized: 0,
    seqOrder: 1,
    seqTrade: 1,
  };
}

/** 返済の対象になる建玉。売り注文はロングを、買い注文はショートを閉じる */
export function closeTarget(side: OrderSide): PositionSide {
  return side === 'sell' ? 'long' : 'short';
}

/** その注文で既に押さえている返済数量（二重に返済しないため） */
function reservedClose(state: TradingState, target: PositionSide): number {
  let n = 0;
  for (const o of state.orders) {
    if (o.kind === 'close' && closeTarget(o.side) === target) n += o.qty;
  }
  return n;
}

export type PlaceRequest = {
  side: OrderSide;
  kind: OrderKind;
  price: number;
  qty: number;
  at: number;
};

export type PlaceResult = { ok: true; order: Order } | { ok: false; error: string };

export function placeOrder(state: TradingState, req: PlaceRequest): PlaceResult {
  const qty = Math.floor(req.qty / LOT) * LOT;
  if (qty <= 0) return { ok: false, error: `数量は${LOT}株単位で指定してください` };
  if (!(req.price > 0)) return { ok: false, error: '値段が不正です' };

  if (req.kind === 'close') {
    const target = closeTarget(req.side);
    const free = state[target].qty - reservedClose(state, target);
    if (free <= 0) {
      return {
        ok: false,
        error: target === 'long' ? '返済できる買い建玉がありません' : '返済できる売り建玉がありません',
      };
    }
    if (qty > free) return { ok: false, error: `返済できるのは残り${free}株です` };
  }

  const order: Order = {
    id: state.seqOrder++,
    side: req.side,
    kind: req.kind,
    price: req.price,
    qty,
    placedAt: req.at,
  };
  state.orders.push(order);
  return { ok: true, order };
}

export function cancelOrder(state: TradingState, id: number): boolean {
  const i = state.orders.findIndex((o) => o.id === id);
  if (i < 0) return false;
  state.orders.splice(i, 1);
  return true;
}

/** 売り側 / 買い側の注文をまとめて取り消す。新規・返済の両方が対象。取り消した件数を返す */
export function cancelSide(state: TradingState, side: OrderSide): number {
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => o.side !== side);
  return before - state.orders.length;
}

/** 歩み値がその値段に触れたか。買いは下に、売りは上に触れたら約定 */
function touched(order: Order, price: number): boolean {
  return order.side === 'buy' ? price <= order.price : price >= order.price;
}

export type Fill = {
  order: Order;
  /** 約定値段。指値で約定させる */
  price: number;
  qty: number;
  at: number;
  /** 返済なら確定した1往復 */
  trade?: Trade;
};

/** 1ティックぶん、板に出ている注文を突き合わせる */
export function matchTick(state: TradingState, price: number, at: number, n: number): Fill[] {
  if (state.orders.length === 0) return [];
  const fills: Fill[] = [];
  const remain: Order[] = [];

  for (const order of state.orders) {
    if (!touched(order, price)) {
      remain.push(order);
      continue;
    }
    const fill = applyFill(state, order, at, n);
    if (fill) fills.push(fill);
    // 建玉が消えていて返済できなかった注文はここで落とす
  }
  state.orders = remain;
  return fills;
}

function applyFill(state: TradingState, order: Order, at: number, n: number): Fill | null {
  const price = order.price;
  const wait = Math.max(0, at - order.placedAt);

  if (order.kind === 'open') {
    const pos = order.side === 'buy' ? state.long : state.short;
    const total = pos.qty + order.qty;
    pos.avg = (pos.avg * pos.qty + price * order.qty) / total;
    if (pos.qty === 0) {
      pos.since = at;
      pos.sinceN = n;
      pos.wait = wait;
    }
    pos.qty = total;
    return { order, price, qty: order.qty, at };
  }

  const target = closeTarget(order.side);
  const pos = state[target];
  const qty = Math.min(order.qty, pos.qty);
  if (qty <= 0) return null;

  const pnl = target === 'long' ? (price - pos.avg) * qty : (pos.avg - price) * qty;
  const trade: Trade = {
    id: state.seqTrade++,
    side: target,
    qty,
    entry: pos.avg,
    exit: price,
    entryAt: pos.since,
    exitAt: at,
    entryN: pos.sinceN,
    exitN: n,
    entryWait: pos.wait,
    exitWait: wait,
    pnl,
  };
  state.trades.push(trade);
  state.realized += pnl;

  pos.qty -= qty;
  if (pos.qty === 0) {
    pos.avg = 0;
    pos.since = 0;
    pos.sinceN = 0;
    pos.wait = 0;
  }
  return { order, price, qty, at, trade };
}

export type Pnl = { long: number; short: number; unrealized: number; realized: number; total: number };

/** 現在値から評価損益を出す。建玉と確定損益さえあれば良いので写しでも渡せる */
export function computePnl(
  state: Pick<TradingState, 'long' | 'short' | 'realized'>,
  last: number,
): Pnl {
  const long = last && state.long.qty ? (last - state.long.avg) * state.long.qty : 0;
  const short = last && state.short.qty ? (state.short.avg - last) * state.short.qty : 0;
  const unrealized = long + short;
  return { long, short, unrealized, realized: state.realized, total: unrealized + state.realized };
}

/**
 * 値段の刻み(呼値)をデータから割り出す。
 * 出現した値段の差の最大公約数を取るので、銘柄ごとの刻みにそのまま追従する。
 */
export function detectTickSize(prices: number[]): number {
  const uniq = [...new Set(prices)].sort((a, b) => a - b);
  if (uniq.length < 2) return 1;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let g = 0;
  for (let i = 1; i < uniq.length; i++) g = gcd(g, uniq[i] - uniq[i - 1]);
  return g > 0 ? g : 1;
}
