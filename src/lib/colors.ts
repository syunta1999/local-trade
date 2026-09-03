/**
 * チャートに渡す色。
 *
 * 実体は index.css の CSS変数で、ここはそれを読むだけ。色の定義を1か所に集めておくと、
 * テーマを足したときに CSS だけ書けば済む。
 *
 * `color-mix()` は getPropertyValue では文字列のまま返ってくるので、
 * 隠し要素に一度当てて、ブラウザに rgb() まで解決させてから読む。
 */

let probe: HTMLElement | null = null;

function resolve(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  if (!probe) {
    probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
  }
  probe.style.color = '';
  probe.style.color = `var(${name})`;
  const got = getComputedStyle(probe).color;
  return got && got !== 'rgba(0, 0, 0, 0)' ? got : fallback;
}

/** 日本の板・チャート慣習に合わせて 上げ=赤 / 下げ=青 */
export type Palette = {
  up: string;
  down: string;
  flat: string;
  upFill: string;
  downFill: string;
  bg: string;
  panel: string;
  grid: string;
  border: string;
  text: string;
  muted: string;
  ma: (period: number) => string;
  bbBand: string;
  bbMid: string;
  rsiLine: string;
  rsiGuide: string;
  vwap: string;
  ghost: string;
  ghostWin: string;
  ghostLose: string;
};

/**
 * いまのテーマの色。テーマを変えたら refreshPalette() で入れ替える。
 * チャートは rAF ループの中からも色を読むので、都度 getComputedStyle を叩かずに
 * ここへ写しておく。
 */
export const C: Palette = {
  up: '#ef5350',
  down: '#42a5f5',
  flat: '#8b949e',
  upFill: 'rgba(239, 83, 80, 0.45)',
  downFill: 'rgba(66, 165, 245, 0.45)',
  bg: '#0e1116',
  panel: '#141922',
  grid: '#1c2128',
  border: '#2b313a',
  text: '#c9d1d9',
  muted: '#7d8590',
  ma: () => '#d0d7de',
  bbBand: '#dfe6f0',
  bbMid: '#6f7a8a',
  rsiLine: '#ffb74d',
  rsiGuide: '#4a5361',
  vwap: '#ff5ec8',
  ghost: '#8b7fd4',
  ghostWin: 'rgba(239, 83, 80, 0.75)',
  ghostLose: 'rgba(66, 165, 245, 0.75)',
};

/** CSS変数を読み直して C に反映する */
export function refreshPalette(): Palette {
  Object.assign(C, palette());
  return C;
}

/** いまのテーマの色をまとめて取る。テーマを変えたら呼び直す */
function palette(): Palette {
  const v = (n: string, fb: string) => resolve(n, fb);
  const up = v('--up', '#ef5350');
  const down = v('--down', '#42a5f5');
  const maFallback = v('--ma-x', '#d0d7de');
  const fade = (c: string, a: number) => c.replace(/^rgba?\(([^)]+)\)$/, (_m, inner) => {
    const p = inner.split(',').map((s: string) => s.trim());
    return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${a})`;
  });
  return {
    up,
    down,
    flat: v('--muted', '#8b949e'),
    upFill: fade(up, 0.45),
    downFill: fade(down, 0.45),
    bg: v('--bg', '#0e1116'),
    panel: v('--panel', '#141922'),
    grid: v('--grid', '#1c2128'),
    border: v('--border', '#2b313a'),
    text: v('--text', '#c9d1d9'),
    muted: v('--muted', '#7d8590'),
    // ローソク(赤/青)と喧嘩しないよう、本数ごとに固定色を割り当てる
    ma: (period: number) =>
      [5, 10, 25, 50, 75, 100, 200].includes(period)
        ? v(`--ma-${period}`, maFallback)
        : maFallback,
    bbBand: v('--bb-band', '#dfe6f0'),
    bbMid: v('--bb-mid', '#6f7a8a'),
    rsiLine: v('--rsi-line', '#ffb74d'),
    rsiGuide: v('--rsi-guide', '#4a5361'),
    vwap: v('--vwap', '#ff5ec8'),
    ghost: v('--ghost', '#8b7fd4'),
    ghostWin: fade(up, 0.75),
    ghostLose: fade(down, 0.75),
  };
}
