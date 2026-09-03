/**
 * 約定シミュレータの中核。Reactに依存しない純粋なロジック。
 *
 * - ロングとショートを別々の建玉として持つ（両建て可）
 * - 発注は指値。歩み値がその値段に触れたら約定
 * - 新規(open)は建玉を増やし、返済(close)は建玉を減らして損益を確定する
 * - 新規注文には逆指値（損切り）と利確を付けられる。約定すると、
 *   逆指値はその値段に逆指値の返済注文、利確はその値段に指値の返済注文が自動で出る。
 *   逆指値は値段に触れたら「そのティックの値段」で約定する（成行と同じ扱い）。利確は普通の指値
 */

/** 売買単位 */
export const LOT = 100;

/** 板のどちら側に出した注文か。買い=ロング新規/ショート返済、売り=ショート新規/ロング返済 */
export type OrderSide = 'buy' | 'sell';
/** 新規建て / 返済 */
export type OrderKind = 'open' | 'close';
export type PositionSide = 'long' | 'short';
/**
 * 指値 / 逆指値。
 * 指値は「その値段かそれより有利な値段が付いたら」約定する。
 * 逆指値は逆で、「その値段かそれより不利な値段が付いたら」発動して、そのときの値段で約定する。
 */
export type OrderType = 'limit' | 'stop';
/** 何で返済したか。自動で出た利確（中身は指値）は分けて数えられるようにする */
export type ExitBy = 'limit' | 'stop' | 'profit';

export type Order = {
  id: number;
  side: OrderSide;
  kind: OrderKind;
  /** 指値なら約定する値段。逆指値なら発動する値段 */
  price: number;
  qty: number;
  /** 発注したセッション時刻(t) */
  placedAt: number;
  type: OrderType;
  /** 新規注文に付けた逆指値（損切り）の値段。約定したら、この値段に逆指値の返済注文が自動で出る */
  stop?: number;
  /** 新規注文に付けた利確の値段。約定したら、この値段に指値の返済注文が自動で出る */
  profit?: number;
  /** 自動で出た返済注文（逆指値・利確）が、どの新規注文の約定から生まれたか */
  from?: number;
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
  /** 何で返済したか。逆指値・利確で切られた取引を後から数えられるようにする */
  exitBy: ExitBy;
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

/** 自動で出た返済注文（逆指値・利確）か。手で出した返済とは扱いを分ける */
const isAuto = (o: Order) => o.kind === 'close' && o.from !== undefined;

/** 返済注文の種類。損切り(stop)・利確(profit)・手で出した指値(limit)で別々に数える */
function closeGroup(o: Order): 'stop' | 'profit' | 'limit' {
  if (o.type === 'stop') return 'stop';
  return isAuto(o) ? 'profit' : 'limit';
}

/**
 * その注文で既に押さえている返済数量（二重に返済しないため）。
 * 自動で出た逆指値・利確は数えない。置いたまま手で返済できないと保険として使えないため。
 * 手で返済したぶんの逆指値・利確は、約定のあとで trimCloses が削る
 */
function reservedClose(state: TradingState, target: PositionSide): number {
  let n = 0;
  for (const o of state.orders) {
    if (o.kind === 'close' && closeGroup(o) === 'limit' && closeTarget(o.side) === target) {
      n += o.qty;
    }
  }
  return n;
}

export type PlaceRequest = {
  side: OrderSide;
  kind: OrderKind;
  price: number;
  qty: number;
  at: number;
  /** 新規注文に付ける逆指値の値段。建値より不利な側（買いなら下、売りなら上） */
  stop?: number;
  /** 新規注文に付ける利確の値段。建値より有利な側（買いなら上、売りなら下） */
  profit?: number;
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

  // 逆指値・利確は新規にだけ付く。逆の側に置くと約定した瞬間に発動してしまう
  let stop: number | undefined;
  if (req.kind === 'open' && req.stop !== undefined) {
    if (!(req.stop > 0)) return { ok: false, error: '逆指値の値段が0以下になります' };
    const bad = req.side === 'buy' ? req.stop >= req.price : req.stop <= req.price;
    if (bad) {
      return {
        ok: false,
        error: req.side === 'buy' ? '逆指値は買値より下に置いてください' : '逆指値は売値より上に置いてください',
      };
    }
    stop = req.stop;
  }
  let profit: number | undefined;
  if (req.kind === 'open' && req.profit !== undefined) {
    if (!(req.profit > 0)) return { ok: false, error: '利確の値段が0以下になります' };
    const bad = req.side === 'buy' ? req.profit <= req.price : req.profit >= req.price;
    if (bad) {
      return {
        ok: false,
        error: req.side === 'buy' ? '利確は買値より上に置いてください' : '利確は売値より下に置いてください',
      };
    }
    profit = req.profit;
  }

  const order: Order = {
    id: state.seqOrder++,
    side: req.side,
    kind: req.kind,
    price: req.price,
    qty,
    placedAt: req.at,
    type: 'limit',
    ...(stop !== undefined ? { stop } : {}),
    ...(profit !== undefined ? { profit } : {}),
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

/** 売り側 / 買い側の注文をまとめて取り消す。新規・返済・逆指値すべてが対象。取り消した件数を返す */
export function cancelSide(state: TradingState, side: OrderSide): number {
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => o.side !== side);
  return before - state.orders.length;
}

/** 逆指値の注文だけをまとめて取り消す。取り消した件数を返す */
export function cancelStops(state: TradingState): number {
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => o.type !== 'stop');
  return before - state.orders.length;
}

/** 自動で出た利確の注文だけをまとめて取り消す。取り消した件数を返す */
export function cancelProfits(state: TradingState): number {
  const before = state.orders.length;
  state.orders = state.orders.filter((o) => closeGroup(o) !== 'profit' || o.kind !== 'close');
  return before - state.orders.length;
}

/**
 * 歩み値がその値段に触れたか。
 * 指値は買いなら下に、売りなら上に触れたら約定。逆指値は向きが逆で、売りは下に、買いは上に触れたら発動
 */
function touched(order: Order, price: number): boolean {
  const below = price <= order.price;
  const above = price >= order.price;
  if (order.type === 'stop') return order.side === 'sell' ? below : above;
  return order.side === 'buy' ? below : above;
}

export type Fill = {
  order: Order;
  /** 約定値段。指値ならその値段、逆指値なら発動したティックの値段 */
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
  /** 新規の約定で生まれた逆指値。次のティックから突き合わせる */
  const spawned: Order[] = [];
  let closed = false;

  for (const order of state.orders) {
    if (!touched(order, price)) {
      remain.push(order);
      continue;
    }
    // 逆指値は発動した値段ではなく、そのティックの値段で約定する（飛んだぶんは滑る）
    const fill = applyFill(state, order, order.type === 'stop' ? price : order.price, at, n);
    // 建玉が消えていて返済できなかった注文はここで落とす
    if (!fill) continue;
    fills.push(fill);
    if (fill.trade) closed = true;
    else spawned.push(...spawnCloses(state, order, fill.qty, at));
  }
  state.orders = [...remain, ...spawned];
  if (closed) trimCloses(state);
  return fills;
}

/** 新規が約定したので、付いていた逆指値・利確を返済注文として板に出す */
function spawnCloses(state: TradingState, order: Order, qty: number, at: number): Order[] {
  const out: Order[] = [];
  const side: OrderSide = order.side === 'buy' ? 'sell' : 'buy';
  const base = { side, kind: 'close' as const, qty, placedAt: at, from: order.id };
  // 利確は普通の指値。損切りは逆指値
  if (order.profit !== undefined) {
    out.push({ id: state.seqOrder++, ...base, price: order.profit, type: 'limit' });
  }
  if (order.stop !== undefined) {
    out.push({ id: state.seqOrder++, ...base, price: order.stop, type: 'stop' });
  }
  return out;
}

/**
 * 建玉が減ったあと、返済注文の合計が建玉を超えていたら新しいものから削る。
 * 手で出した返済・利確・逆指値は別々に数える。互いに「片方が約定したらもう片方は要らない」
 * 関係なので、合わせて建玉ぶんに収める必要はなく、それぞれが建玉を超えなければよい
 */
function trimCloses(state: TradingState): void {
  const room = new Map<string, number>();
  const kept: Order[] = [];
  for (const o of state.orders) {
    if (o.kind !== 'close') {
      kept.push(o);
      continue;
    }
    const target = closeTarget(o.side);
    const key = `${target}:${closeGroup(o)}`;
    const free = room.get(key) ?? state[target].qty;
    if (free <= 0) continue;
    const qty = Math.min(o.qty, free);
    room.set(key, free - qty);
    kept.push(qty === o.qty ? o : { ...o, qty });
  }
  state.orders = kept;
}

function applyFill(
  state: TradingState,
  order: Order,
  price: number,
  at: number,
  n: number,
): Fill | null {
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
    exitBy: closeGroup(order),
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

/** 注文1件の見出し。一覧と取消ボタンの title に使う */
export function orderLabel(o: Order): string {
  const nf = new Intl.NumberFormat('ja-JP');
  const side = o.side === 'buy' ? '買い' : '売り';
  const kind =
    o.type === 'stop'
      ? '逆指値（返済）'
      : isAuto(o)
        ? '利確（返済）'
        : o.kind === 'open'
          ? '新規'
          : '返済';
  return `${side}${kind} ${nf.format(o.price)}円 ${nf.format(o.qty)}株`;
}

/** 建値と幅から逆指値の値段を出す。買いは下、売りは上。0.5刻みなどの浮動小数の誤差は整える */
export function stopPriceOf(side: OrderSide, price: number, width: number): number {
  const v = side === 'buy' ? price - width : price + width;
  return Math.round(v * 1e6) / 1e6;
}

/** 建値と幅から利確の値段を出す。逆指値と逆で、買いは上、売りは下 */
export function profitPriceOf(side: OrderSide, price: number, width: number): number {
  const v = side === 'buy' ? price + width : price - width;
  return Math.round(v * 1e6) / 1e6;
}

/** 呼値の刻みに丸める。浮動小数の誤差（0.5刻みなど）で板の行と食い違わないようにする */
export function roundToTick(price: number, tickSize: number): number {
  if (!(tickSize > 0)) return price;
  const n = Math.round(price / tickSize) * tickSize;
  // 0.1 刻みのような値で 1.2000000000000002 になるのを整える
  return Math.round(n * 1e6) / 1e6;
}
