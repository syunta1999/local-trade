import { hash32, mulberry32 } from './jitter';

/**
 * 板（気配値）の合成。
 *
 * 歩み値CSVには板情報が入っていないので、値段刻みに沿った気配数量をこちらで作る。
 * 実際の板ではないが、決定的な乱数なので同じ場面を何度再生しても同じ板になり、
 * 練習の再現性は保たれる。
 */

export type BookRow = {
  price: number;
  /** 売り気配(この値段より上)。0なら表示しない */
  ask: number;
  /** 買い気配(この値段より下)。0なら表示しない */
  bid: number;
  /** 現在値の行 */
  isLast: boolean;
};

/** 気配数量の売買単位 */
const UNIT = 100;

/**
 * 1本ぶんの気配数量。現在値から離れるほど厚く、キリの良い値段はさらに厚くする。
 * distance は現在値から何本離れているか。
 */
function depthAt(price: number, distance: number, epoch: number): number {
  const rand = mulberry32(hash32(price * 131 + epoch * 7919));
  const thickness = 1 + Math.min(distance, 8) * 0.55;
  const lots = 1 + Math.floor(rand() * 12 * thickness);
  // 100円 / 1000円 のような節目には注文が溜まりやすい
  const round = price % 100 === 0 ? 3 : price % 50 === 0 ? 2 : 1;
  return lots * UNIT * round;
}

/**
 * 板を作る。
 *
 * center が中央に来る値段。通常は現在値そのものなので現在値の行は動かないが、
 * 板をクリックして値段を固定している間は、その時点の値段が center に居座る。
 * 売買気配の振り分けと現在値の強調は、固定中でも生きている last を見る。
 */
export function buildBook(
  last: number,
  center: number,
  tickSize: number,
  rows: number,
  epoch: number,
): BookRow[] {
  const out: BookRow[] = [];
  if (!(last > 0) || !(center > 0) || !(tickSize > 0)) return out;
  const half = Math.floor(rows / 2);

  for (let i = half; i >= -half; i--) {
    const price = center + i * tickSize;
    if (price <= 0) continue;
    const distance = Math.abs(Math.round((price - last) / tickSize));
    out.push({
      price,
      ask: price > last ? depthAt(price, distance, epoch) : 0,
      bid: price < last ? depthAt(price, distance, epoch) : 0,
      isLast: price === last,
    });
  }
  return out;
}
