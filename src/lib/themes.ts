/**
 * 配色テーマ。
 *
 * 色はすべて index.css の CSS変数に集めてあり、面や文字の階調は
 * `color-mix()` で --bg と --fg から自動で作っている。だからテーマが指定するのは
 * 数色だけで済み、1つ足すのも数行で終わる。
 *
 * チャート（lightweight-charts）とSVGも同じ変数を読むので、色の定義はここが唯一の出どころ。
 */

export type Theme = {
  id: string;
  label: string;
  /** 明るい地のテーマ。フォームの見た目を切り替えるのに使う */
  light?: boolean;
  /** 上書きするCSS変数。書かなかったものは既定（深夜）のまま */
  vars: Record<string, string>;
};

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    label: 'midnight',
    // index.css の :root と同じ値。色見本を出すために明示しておく
    vars: {
      '--bg': '#0e1116',
      '--fg': '#c9d1d9',
      '--edge': '#ffffff',
      '--up': '#ef5350',
      '--down': '#42a5f5',
      '--accent': '#f0b429',
      '--sel': '#4a6ea8',
      '--ok': '#06d6a0',
    },
  },
  {
    id: 'spring',
    label: 'spring',
    light: true,
    vars: {
      '--bg': '#f7f5f0',
      '--fg': '#3a352d',
      '--edge': '#141210',
      '--up': '#d1495b',
      '--down': '#3d7ea6',
      '--accent': '#c98a1e',
      '--sel': '#5f8f4a',
      '--sel-bg': '#5f8f4a',
      '--ok': '#4a9a5e',
      '--shadow': 'rgba(80, 70, 55, 0.18)',
      // 白地では淡い線が飛ぶので、指標はどれも濃いめに置き換える
      '--ma-5': '#c98a1e',
      '--ma-10': '#c2612f',
      '--ma-25': '#2f8f6b',
      '--ma-50': '#2c7f78',
      '--ma-75': '#7a52a8',
      '--ma-100': '#b4568c',
      '--ma-200': '#6f7684',
      '--ma-x': '#4a4740',
      '--bb-band': '#8e8779',
      '--bb-mid': '#a8a294',
      '--rsi-line': '#c07818',
      '--rsi-guide': '#c9c3b6',
      '--ghost': '#6a5bb0',
      '--bot-fade': '#1f7fa0',
      '--bot-break': '#c07818',
      '--bot-scalp': '#8250b5',
    },
  },
  {
    id: 'summer',
    label: 'summer',
    vars: {
      '--bg': '#061019',
      '--fg': '#cfe7f2',
      '--up': '#ff6f61',
      '--down': '#35c6f0',
      '--accent': '#ffd166',
      '--sel': '#1c7fa8',
      '--ok': '#2ee6a8',
      '--ma-5': '#ffd166',
      '--ma-10': '#ff9f68',
      '--ma-25': '#2ee6a8',
      '--ma-50': '#4dd0c4',
      '--ma-75': '#b48cf0',
      '--ma-100': '#ff9ed2',
      '--ma-200': '#8fa6b4',
      '--bb-band': '#d7ecf6',
      '--bb-mid': '#5f8496',
      '--rsi-line': '#ffc04d',
      '--rsi-guide': '#3d5b6b',
      '--ghost': '#7f8ce0',
      '--bot-fade': '#4fd6f0',
      '--bot-break': '#ffd166',
      '--bot-scalp': '#c792ea',
    },
  },
  {
    id: 'fall',
    label: 'fall',
    vars: {
      '--bg': '#161009',
      '--fg': '#e8d8c0',
      '--up': '#e2603c',
      '--down': '#5f9ea0',
      '--accent': '#e8a33d',
      '--sel': '#8a5a24',
      '--ok': '#9dbf4a',
      '--ma-5': '#e8a33d',
      '--ma-10': '#d97440',
      '--ma-25': '#9dbf4a',
      '--ma-50': '#7fae8a',
      '--ma-75': '#c08ad0',
      '--ma-100': '#dd93a8',
      '--ma-200': '#a89880',
      '--bb-band': '#efe3cd',
      '--bb-mid': '#8a7a62',
      '--rsi-line': '#f0b25c',
      '--rsi-guide': '#4f4234',
      '--ghost': '#a98ad6',
      '--bot-fade': '#5fb0b8',
      '--bot-break': '#e8a33d',
      '--bot-scalp': '#c98ad8',
    },
  },
  {
    id: 'winter',
    label: 'winter',
    light: true,
    vars: {
      '--bg': '#f1f4f8',
      '--fg': '#2a3441',
      '--edge': '#0e1319',
      '--up': '#c8434f',
      '--down': '#2f74ad',
      '--accent': '#b07d1c',
      '--sel': '#3a6a99',
      '--sel-bg': '#3a6a99',
      '--ok': '#2f8f78',
      '--shadow': 'rgba(42, 52, 65, 0.18)',
      '--ma-5': '#b07d1c',
      '--ma-10': '#b8562e',
      '--ma-25': '#1f8a72',
      '--ma-50': '#2b7d8c',
      '--ma-75': '#6b4fa8',
      '--ma-100': '#a84f86',
      '--ma-200': '#68717e',
      '--ma-x': '#3c454f',
      '--bb-band': '#7e8794',
      '--bb-mid': '#9aa3af',
      '--rsi-line': '#a86d10',
      '--rsi-guide': '#c3cad2',
      '--ghost': '#5b53a8',
      '--bot-fade': '#1a6f92',
      '--bot-break': '#a8720f',
      '--bot-scalp': '#71469f',
    },
  },
];

export const DEFAULT_THEME = 'midnight';

/** ボタンに出す色見本。地・上げ・下げ・アクセントの4色 */
export function swatchOf(id: string): string[] {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const base = THEMES[0].vars;
  return ['--bg', '--up', '--down', '--accent'].map((k) => t.vars[k] ?? base[k]);
}

/** すべてのテーマが触りうる変数。切り替えのときに前の色を消すのに使う */
const ALL_VARS = [...new Set(THEMES.flatMap((t) => Object.keys(t.vars)))];

export function applyTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const root = document.documentElement;
  // 前のテーマの指定を落としてから当てる。テーマごとに書く変数が違うため
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  if (t.light) root.setAttribute('data-light', '');
  else root.removeAttribute('data-light');
  root.dataset.theme = t.id;
}
