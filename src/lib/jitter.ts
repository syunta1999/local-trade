import type { Tick } from './types';

/**
 * 同一秒に固まったティックへ、秒未満のオフセット (rt) を与える。
 *
 * 歩み値CSVの時刻は秒までしか無いので、そのまま再生すると1秒分の約定が
 * 1フレームにまとめて流れてしまう。かといって均等割 (1÷件数) にすると
 * メトロノームのような不自然な流れ方になる。
 *
 * 実際の板は等間隔には約定しない。成行が板を食えば数msの間に連続約定し、
 * そのあと空白が来る。そこで「間隔を指数分布から引いて累積する」という
 * ランダム到着モデルでオフセットを作る。指数を BURST(>1) 乗することで
 * 裾を重くし、かたまりと空白のリズムを強調している。
 *
 * 乱数はその秒の値を種にした決定的PRNGなので、同じCSVは何度読み込んでも
 * 必ず同じ再生になる（同じ場面を繰り返し練習できるようにするため）。
 */

/** 1 = 素のランダム到着。大きいほど「ダダッ…(間)…ダダダッ」が強くなる */
const BURST = 1.6;

/** 連番の秒でも乱数列が相関しないように32bit整数を撹拌する */
function hash32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 — 種が同じなら必ず同じ列を返す軽量PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 小数第3位で切り捨て。cumsum < 1 なので結果は 0.000〜0.999 に収まる */
function trunc3(x: number): number {
  return Math.floor(x * 1000) / 1000;
}

/**
 * 秒 sec に n 件ある場合のオフセット列（昇順・0.000〜0.999）を返す。
 * n+1 本の間隔を引いて累積・正規化するので、最後の1件も必ず1秒未満に収まる。
 */
export function secondOffsets(sec: number, n: number): number[] {
  const rand = mulberry32(hash32(sec));
  const gaps = new Array<number>(n + 1);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    // -ln(1-u) は指数分布。BURST 乗で裾を重くする
    const g = Math.pow(-Math.log(1 - rand()), BURST);
    gaps[i] = g;
    total += g;
  }

  const out = new Array<number>(n);
  if (!(total > 0)) {
    // 天文学的に起きないが、全間隔0なら均等割に落とす
    for (let i = 0; i < n; i++) out[i] = trunc3(i / n);
    return out;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += gaps[i];
    out[i] = trunc3(acc / total);
  }
  return out;
}

/** ticks（時系列順）に rt を書き込む。t は実時刻のまま触らない。 */
export function assignReplayTimes(ticks: Tick[]): void {
  let i = 0;
  while (i < ticks.length) {
    const sec = ticks[i].t;
    let j = i;
    while (j < ticks.length && ticks[j].t === sec) j++;

    const offsets = secondOffsets(sec, j - i);
    for (let k = i; k < j; k++) ticks[k].rt = sec + offsets[k - i];
    i = j;
  }
}
