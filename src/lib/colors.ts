/** 日本の板・チャート慣習に合わせて 上げ=赤 / 下げ=青 */
export const UP = '#ef5350';
export const DOWN = '#42a5f5';
export const FLAT = '#8b949e';
export const UP_FILL = 'rgba(239, 83, 80, 0.45)';
export const DOWN_FILL = 'rgba(66, 165, 245, 0.45)';

export const BG = '#0e1116';
export const PANEL = '#141922';
export const GRID = '#1c2128';
export const BORDER = '#2b313a';
export const TEXT = '#c9d1d9';
export const MUTED = '#7d8590';

// ---- テクニカル指標 ----
/** ローソク(赤/青)と喧嘩しないよう、本数ごとに固定色を割り当てる */
export const MA_COLORS: Record<number, string> = {
  5: '#ffd166',
  10: '#f78c6c',
  25: '#06d6a0',
  50: '#4db6ac',
  75: '#c792ea',
  100: '#f2a4d0',
  200: '#a0a8b4',
};
export const MA_FALLBACK = '#d0d7de';

/** ボリンジャーバンドは包絡線なので彩度を落とした白系 */
export const BB_BAND = '#dfe6f0';
export const BB_MID = '#6f7a8a';

export const RSI_LINE = '#ffb74d';
export const RSI_GUIDE = '#4a5361';

/** ゴースト（前回の自分）のマーカー */
export const GHOST = '#8b7fd4';
export const GHOST_WIN = 'rgba(239, 83, 80, 0.75)';
export const GHOST_LOSE = 'rgba(66, 165, 245, 0.75)';
