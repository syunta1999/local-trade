/**
 * 配色テーマ。
 *
 * 色はすべて index.css の CSS変数に集めてあり、面や文字の階調は
 * `color-mix()` で --bg と --fg から自動で作っている。だからテーマが指定するのは
 * 数色だけで済み、1つ足すのも数行で終わる。
 *
 * チャート（lightweight-charts）とSVGも同じ変数を読むので、色の定義はここが唯一の出どころ。
 *
 * 柄物のテーマは `--bg-art` にチャートの後ろへ敷く柄も書く（下の「柄」の節）。
 */

export type Theme = {
  id: string;
  label: string;
  /** 明るい地のテーマ。フォームの見た目を切り替えるのに使う */
  light?: boolean;
  /** 一覧のボタンに出す短い説明 */
  note?: string;
  /** 上書きするCSS変数。書かなかったものは既定（深夜）のまま */
  vars: Record<string, string>;
};

export const RANDOM_THEME = 'random';

/** a以上b未満のばらつき */
const between = (a: number, b: number) => a + Math.random() * (b - a);

/** 色相を 0..360 に畳む */
const wheel = (h: number) => ((h % 360) + 360) % 360;

const hsl = (h: number, s: number, l: number) =>
  `hsl(${Math.round(wheel(h) * 10) / 10} ${Math.round(s)}% ${Math.round(l)}%)`;

/* ---------- 柄 ----------
 * 柄物のテーマは `--bg-art` に background の層を並べて書く（先頭がいちばん上）。
 * index.css が .chart-wrap に `var(--bg-art), var(--bg)` で敷き、チャート本体は透明なので
 * ローソクの後ろに透ける。板や歩み値は不透明なパネルのままにして、数字の読みやすさは守る。
 *
 * 絵は SVG を data URI にして url() で渡す。CSS のグラデーションだけだと
 * レンガの目地ずらしや星の散らばりが書きにくい。
 * ローソクを読ませるため、柄は地と近い明るさにとどめ、派手な色は小さな絵に限る。
 */

/** SVG を CSS の url() に包む。属性の引用符は ' で書く（外側を " で囲むため） */
const svg = (w: number, h: number, body: string, attrs = '') =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'${attrs}>${body}</svg>`,
  )}")`;

/** background の層を並べる。先頭が手前 */
const art = (...layers: string[]) => layers.join(', ');

/**
 * レンガのタイル。1段おきに半個ずらして積む。
 * faces を順に使うので、色を数個渡すと焼きムラのように見える。
 * 横2個ぶんで1タイルにすると、ずらした段がタイルの継ぎ目で繋がる。
 */
function brickTile(o: {
  w: number;
  h: number;
  rows: number;
  faces: string[];
  seam: string;
  /** レンガの上辺に入れる明るい線。無ければ平らなレンガ */
  shine?: string;
}): string {
  const { w, h, rows, faces, seam, shine } = o;
  const W = w * 2;
  const H = h * rows;
  let body = `<g shape-rendering='crispEdges'><rect width='${W}' height='${H}' fill='${seam}'/>`;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? w / 2 : 0;
    for (let c = -1; c < 3; c++) {
      const x = c * w + off;
      if (x >= W || x + w <= 0) continue;
      const face = faces[n++ % faces.length];
      body += `<rect x='${x + 1}' y='${r * h + 1}' width='${w - 2}' height='${h - 2}' fill='${face}'/>`;
      if (shine) body += `<rect x='${x + 1}' y='${r * h + 1}' width='${w - 2}' height='2' fill='${shine}'/>`;
    }
  }
  return svg(W, H, body + '</g>');
}

/**
 * 星や金粉。点は [x, y, 半径, 不透明度]。
 * 座標は固定で乱数は使わない。描くたびに柄が変わると気が散る。
 */
function dotTile(w: number, h: number, fill: string, pts: [number, number, number, number][]): string {
  return svg(
    w,
    h,
    pts
      .map(([x, y, r, a]) => `<circle cx='${x}' cy='${y}' r='${r}' fill='${fill}' fill-opacity='${a}'/>`)
      .join(''),
  );
}

/** チャートの下端はいつも時間軸なので、地面のような絵はこの高さぶん浮かせる */
const AXIS_H = 26;

/* ---- super mario ---- */
const MARIO_BRICKS = brickTile({
  w: 32,
  h: 16,
  rows: 4,
  faces: ['#b8521c', '#ad4b18'],
  seam: '#1a0a04',
  shine: '#d9772e',
});
const MARIO_STARS = dotTile(160, 120, '#ffffff', [
  [12, 18, 1.2, 0.9],
  [58, 7, 0.8, 0.7],
  [97, 40, 1.4, 0.95],
  [140, 22, 0.9, 0.6],
  [30, 78, 1, 0.8],
  [75, 104, 1.3, 0.85],
  [118, 86, 0.8, 0.6],
  [150, 110, 1.1, 0.75],
  [48, 52, 0.7, 0.5],
  [128, 60, 1, 0.7],
]);
/** 浮いているコイン3枚 */
const MARIO_COINS = svg(
  96,
  28,
  [14, 48, 82]
    .map(
      (cx) =>
        `<ellipse cx='${cx}' cy='14' rx='9' ry='12' fill='#fbd000'/>` +
        `<rect x='${cx - 2}' y='7' width='4' height='14' fill='#e08a00'/>`,
    )
    .join(''),
);

/* ---- sunset drive ---- */
/** 地平線から上の高さ。この下がグリッドの床 */
const SUNSET_FLOOR = 210;
/** 縞の入った夕日。下半分の縞はマスクで抜く */
const SUNSET_SUN = svg(
  200,
  200,
  `<defs>` +
    `<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='#fff06b'/><stop offset='.55' stop-color='#ff7a3c'/><stop offset='1' stop-color='#ff2e88'/>` +
    `</linearGradient>` +
    `<mask id='m'><rect width='200' height='200' fill='#fff'/>` +
    [
      [108, 4],
      [122, 5],
      [138, 7],
      [157, 9],
      [180, 11],
    ]
      .map(([y, h]) => `<rect y='${y}' width='200' height='${h}' fill='#000'/>`)
      .join('') +
    `</mask></defs>` +
    `<circle cx='100' cy='100' r='94' fill='url(#g)' fill-opacity='.4' mask='url(#m)'/>`,
);
/** 消失点へ集まる床のグリッド。横に引き伸ばして使うので線の太さは固定する */
const SUNSET_GRID = (() => {
  const stroke = `fill='none' stroke='rgba(255,46,166,.5)' stroke-width='1' vector-effect='non-scaling-stroke'`;
  const verticals = Array.from({ length: 13 }, (_, i) => i - 6)
    .map((k) => `<line x1='${500 + k * 24}' y1='0' x2='${500 + k * 150}' y2='${SUNSET_FLOOR}' ${stroke}/>`)
    .join('');
  const horizontals = [6, 16, 30, 48, 72, 102, 138, 180]
    .map((y) => `<line x1='0' y1='${y}' x2='1000' y2='${y}' ${stroke}/>`)
    .join('');
  return svg(1000, SUNSET_FLOOR, verticals + horizontals, " preserveAspectRatio='none'");
})();

/* ---- brick alley ---- */
const ALLEY_BRICKS = brickTile({
  w: 60,
  h: 24,
  rows: 4,
  faces: ['#3a1a14', '#3f1d16', '#35170f', '#42221a', '#38180f'],
  seam: '#1e0d08',
});

/* ---- to the moon ---- */
const MOON_STARS_FAR = dotTile(220, 180, '#ffffff', [
  [14, 22, 0.8, 0.6],
  [60, 9, 1, 0.8],
  [105, 48, 0.7, 0.5],
  [150, 26, 1.3, 0.9],
  [200, 70, 0.8, 0.55],
  [30, 110, 1.1, 0.75],
  [88, 140, 0.9, 0.6],
  [130, 96, 0.7, 0.45],
  [176, 150, 1.2, 0.85],
  [205, 120, 0.8, 0.5],
  [50, 168, 0.9, 0.65],
  [112, 12, 0.6, 0.4],
]);
const MOON_STARS_NEAR = dotTile(340, 260, '#ffffff', [
  [40, 60, 1.6, 0.95],
  [210, 30, 1.4, 0.9],
  [300, 150, 1.7, 1],
  [120, 200, 1.5, 0.9],
  [260, 230, 1.2, 0.8],
]);
const MOON_ROCKET = svg(
  40,
  64,
  `<rect x='14' y='14' width='12' height='30' rx='6' fill='#e8ecf5'/>` +
    `<polygon points='20,2 14,16 26,16' fill='#ff6b00'/>` +
    `<circle cx='20' cy='26' r='3.5' fill='#4fa8ff'/>` +
    `<polygon points='14,36 8,48 14,48' fill='#ff6b00'/>` +
    `<polygon points='26,36 32,48 26,48' fill='#ff6b00'/>` +
    `<polygon points='16,45 20,62 24,45' fill='#ffd166'/>`,
);

/* ---- lava ---- */
/**
 * ひび割れ。芯の明るい線と、その外側のにじみの2本で光って見せる。
 * タイルは大きめにして、繰り返しが目に付かないようにする。
 */
const LAVA_CRACKS = (() => {
  const crack = (d: string) =>
    `<path d='${d}' fill='none' stroke='rgba(255,90,0,.16)' stroke-width='6' stroke-linejoin='round'/>` +
    `<path d='${d}' fill='none' stroke='rgba(255,150,40,.5)' stroke-width='1.2' stroke-linejoin='round'/>`;
  // 横に走る線は左右の端で同じ高さにして、タイルの継ぎ目で途切れないようにする
  return svg(
    520,
    360,
    crack('M0 80 L40 92 L70 74 L110 88 L150 66 L190 84 L230 70 L280 90 L320 78 L360 96 L400 72 L450 86 L490 76 L520 80') +
      crack('M150 66 L138 30 L150 12') +
      crack('M400 72 L412 108 L404 130') +
      crack('M0 240 L36 226 L80 250 L120 232 L170 254 L210 236 L260 258 L300 240 L350 262 L390 244 L440 266 L480 248 L520 240') +
      crack('M260 258 L276 300 L262 330') +
      crack('M80 250 L64 290') +
      crack('M330 150 L360 162 L392 148 L420 170'),
  );
})();

/* ---- 億り人 ---- */
const OKU_DUST = dotTile(200, 200, '#ffd25a', [
  [20, 30, 1.2, 0.7],
  [64, 12, 0.8, 0.5],
  [110, 44, 1.6, 0.85],
  [160, 20, 1, 0.6],
  [184, 76, 0.9, 0.5],
  [36, 96, 1.4, 0.8],
  [92, 120, 0.8, 0.45],
  [140, 104, 1.1, 0.65],
  [178, 150, 1.5, 0.9],
  [60, 160, 1, 0.6],
  [118, 186, 0.9, 0.5],
  [16, 140, 0.7, 0.4],
  [150, 60, 0.7, 0.45],
  [86, 70, 0.9, 0.55],
]);
const OKU_DUST_BIG = dotTile(320, 280, '#fff1b0', [
  [50, 40, 2, 0.55],
  [240, 90, 1.8, 0.5],
  [130, 200, 2.2, 0.6],
  [290, 230, 1.6, 0.45],
  [180, 140, 1.4, 0.4],
]);
/** 透かしの「億」 */
const OKU_MARK = svg(
  200,
  200,
  `<text x='100' y='150' text-anchor='middle' font-family='serif' font-weight='700' font-size='150' fill='#ffc300' fill-opacity='.07'>億</text>`,
);

/** hsl を sRGB の相対輝度に直す（WCAGと同じ式） */
function luminance(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const ch = (n: number) => {
    const c = l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(8) + 0.0722 * ch(4);
}

/**
 * 目標の輝度になる明るさを二分探索で求める。
 *
 * 同じ「明るさ50%」でも黄や水色は明るく、青や赤は暗い。明るさをそのまま乱数で決めると、
 * 白地に水色の足のような読めない組み合わせが出るので、見た目の明るさのほうを揃える。
 * 輝度は明るさに対して単調に増えるので、これで一意に決まる。
 */
function lightnessFor(h: number, s: number, target: number): number {
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(h, s, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * random テーマの中身を引く。
 *
 * 地の色相をひとつ決めて、そこから色相環を回して線の色を散らす。
 * 明るさは地の明暗と逆に振るので、白地でも黒地でも線が沈まない。
 */
function makeRandom(): { light: boolean; vars: Record<string, string> } {
  const light = Math.random() < 0.4;
  const base = between(0, 360);
  /** 色相を回す向き。同じ地でも並びが変わる */
  const spin = Math.random() < 0.5 ? 1 : -1;
  /** 線1本ぶんの色。turn は地の色相からのずれ。白地なら暗く、黒地なら明るく置く */
  const tone = (
    turn: number,
    s = between(58, 86),
    lum = light ? between(0.07, 0.13) : between(0.28, 0.42),
  ) => {
    const h = wheel(base + spin * turn);
    return hsl(h, s, lightnessFor(h, s, lum));
  };

  // 上げと下げは色相を半周ぶん離す。近い色だと板と足が読めない
  const upTurn = between(20, 90);
  const downTurn = upTurn + between(140, 200);
  const accTurn = upTurn + between(55, 110);
  /** 線を散らしはじめる位置 */
  const m = between(0, 360);
  // 選択の色には白い文字が乗る。地が白でも黒でも暗めに置いて、文字が沈まないようにする
  const sel = tone(downTurn + 25, between(38, 60), between(0.1, 0.17));
  // 上げと下げは明るさもずらす。色相だけだと、赤と緑の見分けがつきにくい人に厳しい
  const upLum = light ? between(0.06, 0.1) : between(0.32, 0.46);
  const downLum = upLum * (light ? between(1.35, 1.75) : between(0.62, 0.78));

  return {
    light,
    vars: {
      '--bg': hsl(base, between(18, 48), light ? between(93, 97) : between(6, 11)),
      '--fg': hsl(base, between(10, 26), light ? between(17, 26) : between(74, 88)),
      '--edge': light ? '#0c0e12' : '#ffffff',
      '--up': tone(upTurn, between(66, 90), upLum),
      '--down': tone(downTurn, between(60, 86), downLum),
      '--accent': tone(accTurn, between(70, 92)),
      '--sel': sel,
      // 白地は color-mix の淡さだと選択が見えないので、単色で置く
      ...(light ? { '--sel-bg': sel } : {}),
      '--ok': tone(upTurn + 160, between(55, 80)),
      '--shadow': light ? 'rgba(40, 38, 52, 0.18)' : 'rgba(0, 0, 0, 0.5)',
      '--ma-5': tone(m),
      '--ma-10': tone(m + 40),
      '--ma-25': tone(m + 85),
      '--ma-50': tone(m + 130),
      '--ma-75': tone(m + 175),
      '--ma-100': tone(m + 220),
      // 200日線とバンドは彩度を落として、短い線の邪魔をしないようにする
      '--ma-200': tone(m + 265, between(8, 24)),
      '--ma-x': hsl(base, 12, light ? 25 : 82),
      '--bb-band': hsl(base, 14, light ? 52 : 86),
      '--bb-mid': hsl(base, 12, light ? 68 : 52),
      '--rsi-line': tone(accTurn, 78),
      '--rsi-guide': hsl(base, 16, light ? 84 : 26),
      // VWAPは移動平均の色相の隙間に置く（m..m+265 を使い切っているので、その先）
      '--vwap': tone(m + 310, between(74, 92)),
      '--ghost': tone(m + 200, 70),
      '--bot-fade': tone(m + 130, 70),
      '--bot-break': tone(accTurn, 80),
      '--bot-scalp': tone(m + 220, 70),
    },
  };
}

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
      '--vwap': '#a01e6e',
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
      '--vwap': '#ff2e88',
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
      '--vwap': '#e05fb0',
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
      '--vwap': '#9c2b6e',
      '--ghost': '#5b53a8',
      '--bot-fade': '#1a6f92',
      '--bot-break': '#a8720f',
      '--bot-scalp': '#71469f',
    },
  },
  {
    id: 'crazy-rainbow',
    label: 'crazy rainbow',
    note: 'ぜんぶ原色。いちばん強いコントラスト',
    vars: {
      // 漆黒に白。地と文字を振り切ってあるので、階調も線もいちばん際立つ
      '--bg': '#05040a',
      '--fg': '#ffffff',
      '--edge': '#ffffff',
      '--up': '#ff1f4b',
      '--down': '#00e5ff',
      '--accent': '#ffea00',
      '--sel': '#8b2fff',
      '--ok': '#00ff9c',
      // 線は色相をぐるりと一周ぶん散らす。隣どうしが混ざらない
      '--ma-5': '#ffea00',
      '--ma-10': '#ff7a00',
      '--ma-25': '#00ff6a',
      '--ma-50': '#00e5ff',
      '--ma-75': '#c14bff',
      '--ma-100': '#ff2ea6',
      '--ma-200': '#9dff2e',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#8b2fff',
      '--rsi-line': '#ffea00',
      '--rsi-guide': '#5a1a8a',
      '--vwap': '#2e7bff',
      '--ghost': '#c14bff',
      '--bot-fade': '#00e5ff',
      '--bot-break': '#ffea00',
      '--bot-scalp': '#ff2ea6',
    },
  },
  {
    id: 'wild-jungle',
    label: 'wild jungle',
    note: '深い緑の下草に、花と獣の色',
    vars: {
      '--bg': '#0a1a0e',
      '--fg': '#dbe9c4',
      '--up': '#e2553a',
      '--down': '#37b3a4',
      '--accent': '#e3a52a',
      '--sel': '#3f6b2a',
      '--ok': '#8ccf4a',
      '--ma-5': '#e3c04a',
      '--ma-10': '#d97a34',
      '--ma-25': '#7ecb52',
      '--ma-50': '#37b3a4',
      '--ma-75': '#b07ad8',
      '--ma-100': '#eb90ad',
      '--ma-200': '#93a684',
      '--ma-x': '#dfeccb',
      '--bb-band': '#cfe3b4',
      '--bb-mid': '#5d7a52',
      '--rsi-line': '#e3b23a',
      '--rsi-guide': '#2a4531',
      '--vwap': '#f04ba8',
      '--ghost': '#a97fdc',
      '--bot-fade': '#37b3a4',
      '--bot-break': '#e3a52a',
      '--bot-scalp': '#b07ad8',
    },
  },
  {
    id: 'ghost-mansion',
    label: 'ghost mansion',
    note: '霧の中の館。わざと弱いコントラスト',
    vars: {
      // 地と文字を近づけて、ぼんやり浮かぶ見え方にしてある
      '--bg': '#15121c',
      '--fg': '#9c94b2',
      '--up': '#b0596a',
      '--down': '#5f83a8',
      '--accent': '#b09a5c',
      '--sel': '#4b4166',
      '--ok': '#7ba98a',
      '--ma-5': '#b09a5c',
      '--ma-10': '#a06a5c',
      '--ma-25': '#6f9c7d',
      '--ma-50': '#5f8c96',
      '--ma-75': '#8a72b0',
      '--ma-100': '#a3768f',
      '--ma-200': '#6b6580',
      '--ma-x': '#a8a0bc',
      '--bb-band': '#6e6885',
      '--bb-mid': '#4a4560',
      '--rsi-line': '#a8945a',
      '--rsi-guide': '#2e2940',
      '--vwap': '#c07aa8',
      // ゴーストだけは白く光らせる。館の主役なので
      '--ghost': '#cbb6f0',
      '--bot-fade': '#5f8c96',
      '--bot-break': '#b09a5c',
      '--bot-scalp': '#8a72b0',
    },
  },
  {
    id: 'happy-purple',
    label: 'happy purple',
    note: '薄紫の地に、明るい紫とピンク',
    light: true,
    vars: {
      '--bg': '#f7f1fe',
      '--fg': '#3b2b58',
      '--edge': '#140c22',
      '--up': '#e2477f',
      '--down': '#4a63cc',
      '--accent': '#e0930f',
      '--sel': '#8a4fd0',
      '--sel-bg': '#8a4fd0',
      '--ok': '#33a06b',
      '--shadow': 'rgba(72, 44, 116, 0.2)',
      '--ma-5': '#c98a10',
      '--ma-10': '#d4603a',
      '--ma-25': '#2f9a70',
      '--ma-50': '#2b83a8',
      '--ma-75': '#8a4fd0',
      '--ma-100': '#c8479c',
      '--ma-200': '#7a7092',
      '--ma-x': '#4a3a68',
      '--bb-band': '#9b8bbb',
      '--bb-mid': '#b7abd2',
      '--rsi-line': '#b8760f',
      '--rsi-guide': '#ded1f0',
      '--vwap': '#b0006b',
      '--ghost': '#6a35b8',
      '--bot-fade': '#1f7f9f',
      '--bot-break': '#b8760f',
      '--bot-scalp': '#8a3fc8',
    },
  },
  {
    id: 'japan',
    label: 'japan',
    note: '和紙に墨。紅と藍で締める',
    light: true,
    vars: {
      '--bg': '#f4efe4',
      '--fg': '#2c2721',
      '--edge': '#100e0b',
      '--up': '#c3423c',
      '--down': '#23507e',
      '--accent': '#c08a12',
      '--sel': '#2c4f7c',
      '--sel-bg': '#2c4f7c',
      '--ok': '#3f7d4a',
      '--shadow': 'rgba(62, 52, 40, 0.18)',
      '--ma-5': '#c08a12',
      '--ma-10': '#c4652f',
      '--ma-25': '#3f7d4a',
      '--ma-50': '#2e7b78',
      '--ma-75': '#7a52a0',
      '--ma-100': '#b5507a',
      '--ma-200': '#6f6a61',
      '--ma-x': '#38332c',
      '--bb-band': '#8b8478',
      '--bb-mid': '#a9a294',
      '--rsi-line': '#b07a10',
      '--rsi-guide': '#dcd4c3',
      '--vwap': '#a01050',
      '--ghost': '#5a4a99',
      '--bot-fade': '#1f6f8a',
      '--bot-break': '#b07a10',
      '--bot-scalp': '#7a52a0',
    },
  },
  {
    id: 'usa',
    label: 'usa',
    note: '紺地に赤・白・星の金',
    vars: {
      '--bg': '#0a1633',
      '--fg': '#eef2fb',
      '--edge': '#ffffff',
      '--up': '#e03a4a',
      '--down': '#6aa8ff',
      '--accent': '#f5c542',
      '--sel': '#2f5cb0',
      '--ok': '#35d69a',
      '--ma-5': '#f5c542',
      '--ma-10': '#ff8a5b',
      '--ma-25': '#4fd6a0',
      '--ma-50': '#58c8d8',
      '--ma-75': '#b08cf0',
      '--ma-100': '#ff8fb4',
      '--ma-200': '#a3b4d0',
      '--ma-x': '#eef2fb',
      '--bb-band': '#e2eafb',
      '--bb-mid': '#6d84ad',
      '--rsi-line': '#f5c542',
      '--rsi-guide': '#2a3d66',
      '--vwap': '#ff3ea5',
      '--ghost': '#8f9ef0',
      '--bot-fade': '#58c8d8',
      '--bot-break': '#f5c542',
      '--bot-scalp': '#b08cf0',
    },
  },
  // 中身は makeRandom() が作る。ここに置く色は最初の1回ぶん
  {
    id: 'god-zeus',
    label: 'god zeus',
    note: '嵐雲を裂く雷。金と白',
    vars: {
      '--bg': '#090d1b',
      '--fg': '#fdf6e3',
      '--edge': '#ffffff',
      '--up': '#ffd60a',
      '--down': '#4dd0ff',
      '--accent': '#ffffff',
      '--sel': '#3949ab',
      '--ok': '#a3e635',
      '--ma-5': '#ffd60a',
      '--ma-10': '#ff9f1c',
      '--ma-25': '#a3e635',
      '--ma-50': '#4dd0ff',
      '--ma-75': '#c4b5fd',
      '--ma-100': '#ffb3c7',
      '--ma-200': '#9aa5c4',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#5a6a99',
      '--rsi-line': '#ffd60a',
      '--rsi-guide': '#26315c',
      '--vwap': '#ff4fa8',
      '--ghost': '#c4b5fd',
      '--bot-fade': '#4dd0ff',
      '--bot-break': '#ffd60a',
      '--bot-scalp': '#c4b5fd',
    },
  },
  {
    id: 'rising-sun',
    label: 'rising sun',
    note: '白地に日の丸の赤',
    light: true,
    vars: {
      '--bg': '#fffdf8',
      '--fg': '#1a1a1a',
      '--edge': '#000000',
      '--up': '#e60012',
      '--down': '#0b57a4',
      '--accent': '#ff6a00',
      '--sel': '#c8102e',
      '--sel-bg': '#c8102e',
      '--ok': '#007a3d',
      '--shadow': 'rgba(180, 40, 30, 0.22)',
      '--ma-5': '#ff6a00',
      '--ma-10': '#e60012',
      '--ma-25': '#007a3d',
      '--ma-50': '#0b57a4',
      '--ma-75': '#7b2cbf',
      '--ma-100': '#d6006e',
      '--ma-200': '#666666',
      '--ma-x': '#1a1a1a',
      '--bb-band': '#ff9d5c',
      '--bb-mid': '#ffc9a8',
      '--rsi-line': '#ff6a00',
      '--rsi-guide': '#ffd9c2',
      '--vwap': '#00796b',
      '--ghost': '#7b2cbf',
      '--bot-fade': '#0b57a4',
      '--bot-break': '#ff6a00',
      '--bot-scalp': '#d6006e',
    },
  },
  {
    id: 'casino',
    label: 'casino',
    note: '緑のフェルトに赤チップと金',
    vars: {
      '--bg': '#0b3d2e',
      '--fg': '#fff4d6',
      '--edge': '#ffffff',
      '--up': '#ff1f3d',
      '--down': '#3ea9ff',
      '--accent': '#ffd000',
      '--sel': '#8b0f1f',
      '--ok': '#00e676',
      '--ma-5': '#ffd000',
      '--ma-10': '#ff7a00',
      '--ma-25': '#00e676',
      '--ma-50': '#3ea9ff',
      '--ma-75': '#d18aff',
      '--ma-100': '#ff5fa2',
      '--ma-200': '#d8c9a0',
      '--ma-x': '#fff4d6',
      '--bb-band': '#ffe9a8',
      '--bb-mid': '#1f6b52',
      '--rsi-line': '#ffd000',
      '--rsi-guide': '#17513d',
      '--vwap': '#ffffff',
      '--ghost': '#d18aff',
      '--bot-fade': '#3ea9ff',
      '--bot-break': '#ffd000',
      '--bot-scalp': '#ff5fa2',
    },
  },
  {
    id: 'death-metal',
    label: 'death metal',
    note: '漆黒・血の赤・骨の白',
    vars: {
      '--bg': '#000000',
      '--fg': '#f2f2f2',
      '--edge': '#ffffff',
      '--up': '#e10600',
      '--down': '#a9b7c6',
      '--accent': '#d4d4d4',
      '--sel': '#5c0a0a',
      '--ok': '#6b8f00',
      '--ma-5': '#d4d4d4',
      '--ma-10': '#e10600',
      '--ma-25': '#6b8f00',
      '--ma-50': '#7a8b99',
      '--ma-75': '#8b5cf6',
      '--ma-100': '#ff4d6d',
      '--ma-200': '#4d4d4d',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#4d4d4d',
      '--rsi-line': '#e10600',
      '--rsi-guide': '#262626',
      '--vwap': '#ffb300',
      '--ghost': '#8b5cf6',
      '--bot-fade': '#a9b7c6',
      '--bot-break': '#d4d4d4',
      '--bot-scalp': '#ff4d6d',
    },
  },
  {
    id: 'egypt',
    label: 'egypt',
    note: '墓室の闇に黄金とラピスラズリ',
    vars: {
      '--bg': '#17110a',
      '--fg': '#f7e6b8',
      '--edge': '#ffffff',
      '--up': '#d64018',
      '--down': '#3d8fe8',
      '--accent': '#ffc300',
      '--sel': '#1a5f8f',
      '--ok': '#00c2a0',
      '--ma-5': '#ffc300',
      '--ma-10': '#e07b18',
      '--ma-25': '#00c2a0',
      '--ma-50': '#3d8fe8',
      '--ma-75': '#b98cff',
      '--ma-100': '#ff8fb0',
      '--ma-200': '#b9a878',
      '--ma-x': '#f7e6b8',
      '--bb-band': '#f0dca8',
      '--bb-mid': '#7a6a40',
      '--rsi-line': '#ffc300',
      '--rsi-guide': '#3a2c16',
      '--vwap': '#ff3d8a',
      '--ghost': '#b98cff',
      '--bot-fade': '#00c2a0',
      '--bot-break': '#ffc300',
      '--bot-scalp': '#b98cff',
    },
  },
  {
    id: 'atlantis',
    label: 'atlantis',
    note: '深海に沈んだ黄金と珊瑚',
    vars: {
      '--bg': '#01192b',
      '--fg': '#cff5ff',
      '--edge': '#ffffff',
      '--up': '#ff5c8a',
      '--down': '#00e5d4',
      '--accent': '#ffd98a',
      '--sel': '#0a6f96',
      '--ok': '#46f0a8',
      '--ma-5': '#ffd98a',
      '--ma-10': '#ff9e6b',
      '--ma-25': '#46f0a8',
      '--ma-50': '#00e5d4',
      '--ma-75': '#9d8cff',
      '--ma-100': '#ff7fc0',
      '--ma-200': '#8aa8bc',
      '--ma-x': '#cff5ff',
      '--bb-band': '#d8f6ff',
      '--bb-mid': '#2b6a86',
      '--rsi-line': '#ffd98a',
      '--rsi-guide': '#113a52',
      '--vwap': '#b6ff3d',
      '--ghost': '#9d8cff',
      '--bot-fade': '#00e5d4',
      '--bot-break': '#ffd98a',
      '--bot-scalp': '#9d8cff',
    },
  },
  {
    id: 'super-mario',
    label: 'super mario',
    note: '夜のステージ。星空にレンガの地面、コインの金',
    vars: {
      '--bg': '#050818',
      '--fg': '#f4f4ff',
      '--edge': '#ffffff',
      // 上げはマリオの赤、下げはルイージの緑
      '--up': '#ff3a2f',
      '--down': '#4dcf52',
      '--accent': '#fbd000',
      '--sel': '#2a5bd7',
      '--ok': '#5ee35e',
      '--ma-5': '#fbd000',
      '--ma-10': '#ff8c00',
      '--ma-25': '#7fd8ff',
      '--ma-50': '#ff9ad5',
      '--ma-75': '#b388ff',
      '--ma-100': '#e0b070',
      '--ma-200': '#a0a0b0',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#3d4a8a',
      '--rsi-line': '#fbd000',
      '--rsi-guide': '#1c2455',
      '--vwap': '#ff5fe0',
      // ゴーストはテレサ
      '--ghost': '#e6e0ff',
      '--bot-fade': '#7fd8ff',
      '--bot-break': '#fbd000',
      '--bot-scalp': '#b388ff',
      '--bg-art': art(
        `${MARIO_COINS} 120px 64px no-repeat`,
        `${MARIO_BRICKS} left 0 bottom ${AXIS_H}px / 64px 64px repeat-x`,
        // 丘。下半分はレンガの後ろに隠れる
        `radial-gradient(ellipse 170px 100px at 22% calc(100% - ${AXIS_H + 64}px), rgba(72,190,84,.28) 0 99%, transparent 100%)`,
        `radial-gradient(ellipse 110px 64px at 66% calc(100% - ${AXIS_H + 64}px), rgba(72,190,84,.22) 0 99%, transparent 100%)`,
        // 雲
        `radial-gradient(ellipse 64px 22px at 16% 18%, rgba(255,255,255,.16) 0 99%, transparent 100%)`,
        `radial-gradient(ellipse 84px 26px at 72% 30%, rgba(255,255,255,.13) 0 99%, transparent 100%)`,
        `${MARIO_STARS} repeat`,
      ),
    },
  },
  {
    id: 'doraemon',
    label: 'doraemon',
    note: '青い体に白いおなか、赤い首輪と鈴',
    vars: {
      '--bg': '#0b3f86',
      '--fg': '#ffffff',
      '--edge': '#ffffff',
      '--up': '#ff5147',
      '--down': '#5cc8ff',
      '--accent': '#ffd400',
      // 選択はどこでもドアのピンク
      '--sel': '#e8508f',
      '--ok': '#43d47a',
      '--ma-5': '#ffd400',
      '--ma-10': '#ffa040',
      '--ma-25': '#5ff0c0',
      '--ma-50': '#a8e4ff',
      '--ma-75': '#c9b3ff',
      '--ma-100': '#ff8fd0',
      '--ma-200': '#9fb6d6',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#3f76c0',
      '--rsi-line': '#ffd400',
      '--rsi-guide': '#1c5aa8',
      '--vwap': '#ff69b4',
      '--ghost': '#d9c8ff',
      '--bot-fade': '#5cc8ff',
      '--bot-break': '#ffd400',
      '--bot-scalp': '#c9b3ff',
      '--bg-art': art(
        // 鈴
        `radial-gradient(circle at 50% calc(100% - ${AXIS_H + 7}px), #ffd400 0 11px, #8a6d00 11px 13px, transparent 14px)`,
        // 首輪
        `linear-gradient(#e60012, #e60012) left 0 bottom ${AXIS_H}px / 100% 14px no-repeat`,
        // 四次元ポケットの縁
        `radial-gradient(ellipse 16% 24% at 50% calc(100% - ${AXIS_H + 14}px), transparent 0 93%, rgba(255,255,255,.5) 94% 100%, transparent 100%)`,
        // おなか
        `radial-gradient(ellipse 44% 60% at 50% calc(100% - ${AXIS_H + 14}px), rgba(255,255,255,.1) 0 99%, transparent 100%)`,
        // 上へいくほど明るい青
        `linear-gradient(180deg, rgba(58,168,245,.4), transparent 38%)`,
      ),
    },
  },
  {
    id: 'sunset-drive',
    label: 'sunset drive',
    note: '夕日と地平線のグリッド。ネオンのピンクとシアン',
    vars: {
      '--bg': '#12052e',
      '--fg': '#fff0f8',
      '--edge': '#ffffff',
      '--up': '#ff2ea6',
      '--down': '#00e5ff',
      '--accent': '#ffb020',
      '--sel': '#7a2bd6',
      '--ok': '#39ffb0',
      '--ma-5': '#ffb020',
      '--ma-10': '#ff6a2a',
      '--ma-25': '#39ffb0',
      '--ma-50': '#7fb8ff',
      '--ma-75': '#b98cff',
      '--ma-100': '#ff8fd0',
      '--ma-200': '#a08cc0',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#6a3a9a',
      '--rsi-line': '#ffb020',
      '--rsi-guide': '#3a1a66',
      '--vwap': '#ffee55',
      '--ghost': '#c4a5ff',
      '--bot-fade': '#00e5ff',
      '--bot-break': '#ffb020',
      '--bot-scalp': '#b98cff',
      // 地平線は下から SUNSET_FLOOR + 時間軸の高さ。夕日はその上に乗せる
      '--bg-art': art(
        `${SUNSET_GRID} left 0 bottom ${AXIS_H}px / 100% ${SUNSET_FLOOR}px no-repeat`,
        `${SUNSET_SUN} center bottom ${AXIS_H + SUNSET_FLOOR - 6}px / 200px 200px no-repeat`,
        `linear-gradient(180deg, #0a0220 0%, #2a0a52 calc(100% - ${AXIS_H + SUNSET_FLOOR + 190}px), #7a1660 calc(100% - ${AXIS_H + SUNSET_FLOOR + 26}px), #ff6a2a calc(100% - ${AXIS_H + SUNSET_FLOOR + 2}px), #ffb347 calc(100% - ${AXIS_H + SUNSET_FLOOR}px), #2a0838 calc(100% - ${AXIS_H + SUNSET_FLOOR - 2}px), #12052e 100%)`,
      ),
    },
  },
  {
    id: 'brick-alley',
    label: 'brick alley',
    note: '裏路地のレンガ壁にスプレーの蛍光色',
    vars: {
      '--bg': '#24100a',
      '--fg': '#f5efe8',
      '--edge': '#ffffff',
      '--up': '#ff3fa4',
      '--down': '#29e0ff',
      '--accent': '#ffe600',
      '--sel': '#8b3fd9',
      '--ok': '#8fff29',
      '--ma-5': '#ffe600',
      '--ma-10': '#ff7a1a',
      '--ma-25': '#8fff29',
      '--ma-50': '#7fb0ff',
      '--ma-75': '#b46bff',
      '--ma-100': '#ff7ad9',
      '--ma-200': '#b8a59a',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#6b4a3e',
      '--rsi-line': '#ffe600',
      '--rsi-guide': '#4a2418',
      '--vwap': '#ff9a1a',
      '--ghost': '#c8a5ff',
      '--bot-fade': '#29e0ff',
      '--bot-break': '#ffe600',
      '--bot-scalp': '#b46bff',
      '--bg-art': art(
        // スプレーの吹きだまり
        `radial-gradient(circle at 18% 28%, rgba(255,63,164,.22), transparent 140px)`,
        `radial-gradient(circle at 74% 56%, rgba(41,224,255,.16), transparent 160px)`,
        `radial-gradient(circle at 50% 84%, rgba(255,230,0,.14), transparent 120px)`,
        `radial-gradient(circle at 90% 12%, rgba(143,255,41,.12), transparent 110px)`,
        // 上から差す街灯
        `linear-gradient(180deg, rgba(255,255,255,.05), transparent 30%)`,
        `${ALLEY_BRICKS} 0 0 / 120px 96px repeat`,
      ),
    },
  },
  {
    id: 'to-the-moon',
    label: 'to the moon',
    note: '星空と月、ロケット',
    vars: {
      '--bg': '#03040f',
      '--fg': '#eef1ff',
      '--edge': '#ffffff',
      '--up': '#ff6b00',
      '--down': '#4fa8ff',
      '--accent': '#fff3b0',
      '--sel': '#6a3df5',
      '--ok': '#39ff9c',
      '--ma-5': '#fff3b0',
      '--ma-10': '#ffa640',
      '--ma-25': '#39ff9c',
      '--ma-50': '#7fe0ff',
      '--ma-75': '#b58cff',
      '--ma-100': '#ff8fd0',
      '--ma-200': '#8a93b8',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#3a4a8a',
      '--rsi-line': '#fff3b0',
      '--rsi-guide': '#1a2350',
      '--vwap': '#ff3ea5',
      '--ghost': '#c4b5fd',
      '--bot-fade': '#7fe0ff',
      '--bot-break': '#ffa640',
      '--bot-scalp': '#b58cff',
      '--bg-art': art(
        `${MOON_ROCKET} left 28px bottom ${AXIS_H + 20}px / 40px 64px no-repeat`,
        // 月。値段軸に被らないよう右端から少し離す
        `radial-gradient(circle at calc(100% - 120px) 78px, #fff8d6 0 30px, rgba(255,248,214,.25) 31px 40px, transparent 62px)`,
        // 地球の照り返し
        `radial-gradient(ellipse 70% 32% at 12% 104%, rgba(64,150,255,.35), transparent 70%)`,
        // 星雲
        `radial-gradient(ellipse 50% 40% at 32% 42%, rgba(130,70,220,.18), transparent 70%)`,
        `${MOON_STARS_NEAR} repeat`,
        `${MOON_STARS_FAR} repeat`,
      ),
    },
  },
  {
    id: 'lava',
    label: 'lava',
    note: '黒曜石のひび割れから溶岩が光る',
    vars: {
      '--bg': '#0b0604',
      '--fg': '#ffe8d6',
      '--edge': '#ffffff',
      '--up': '#ff4500',
      '--down': '#7fa6c9',
      '--accent': '#ffd54a',
      '--sel': '#8a2a0a',
      '--ok': '#9dff3d',
      '--ma-5': '#ffd54a',
      '--ma-10': '#ff8c1a',
      '--ma-25': '#9dff3d',
      '--ma-50': '#5fd6d0',
      '--ma-75': '#c48cff',
      '--ma-100': '#ff8fb0',
      '--ma-200': '#8a7a70',
      '--ma-x': '#ffe8d6',
      '--bb-band': '#ffffff',
      '--bb-mid': '#5a3a30',
      '--rsi-line': '#ffd54a',
      '--rsi-guide': '#3a1a10',
      '--vwap': '#ff2ea6',
      '--ghost': '#c4a5ff',
      '--bot-fade': '#7fa6c9',
      '--bot-break': '#ffd54a',
      '--bot-scalp': '#c48cff',
      '--bg-art': art(
        `${LAVA_CRACKS} repeat`,
        // 下からの熱
        `linear-gradient(0deg, rgba(255,69,0,.32), rgba(150,25,0,.14) 30%, transparent 62%)`,
        // 溶岩だまりの照り
        `radial-gradient(ellipse 45% 30% at 78% 100%, rgba(255,120,0,.28), transparent 70%)`,
      ),
    },
  },
  {
    id: 'retro-rpg',
    label: 'retro RPG',
    note: '黒地に白い枠のコマンド窓。角は四角',
    vars: {
      '--bg': '#000000',
      '--fg': '#ffffff',
      '--edge': '#ffffff',
      '--up': '#ff3c3c',
      '--down': '#4f8cff',
      '--accent': '#ffd700',
      '--sel': '#3355cc',
      '--ok': '#4cd964',
      // 窓の枠は白い線。角を落とす CSS は index.css の [data-theme='retro-rpg']
      '--border': '#ffffff',
      '--border-2': '#ffffff',
      '--ma-5': '#ffd700',
      '--ma-10': '#ff9b3c',
      '--ma-25': '#4cd964',
      '--ma-50': '#4fdfff',
      '--ma-75': '#b48cff',
      '--ma-100': '#ff8ad8',
      '--ma-200': '#8c8c8c',
      '--ma-x': '#ffffff',
      '--bb-band': '#ffffff',
      '--bb-mid': '#555555',
      '--rsi-line': '#ffd700',
      '--rsi-guide': '#333333',
      '--vwap': '#d066ff',
      '--ghost': '#c8c8ff',
      '--bot-fade': '#4fdfff',
      '--bot-break': '#ffd700',
      '--bot-scalp': '#b48cff',
      // ブラウン管の走査線
      '--bg-art': art(
        `repeating-linear-gradient(180deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)`,
      ),
    },
  },
  {
    id: 'okuribito',
    label: '億り人',
    note: '黒地に金粉。上げは金、下げは銀',
    vars: {
      '--bg': '#0a0800',
      '--fg': '#fff3d0',
      '--edge': '#ffffff',
      '--up': '#ffc300',
      '--down': '#c0c8d0',
      '--accent': '#ffe9a0',
      '--sel': '#6b4a00',
      '--ok': '#7ddc6b',
      '--ma-5': '#ffe9a0',
      '--ma-10': '#ff9f1c',
      '--ma-25': '#7ddc6b',
      '--ma-50': '#5fd0e0',
      '--ma-75': '#c9a3ff',
      '--ma-100': '#ff9ac8',
      '--ma-200': '#8a8270',
      '--ma-x': '#fff3d0',
      '--bb-band': '#ffffff',
      '--bb-mid': '#5a4a20',
      '--rsi-line': '#ffc300',
      '--rsi-guide': '#2e2408',
      '--vwap': '#ff3ea5',
      '--ghost': '#c9a3ff',
      '--bot-fade': '#5fd0e0',
      '--bot-break': '#ffc300',
      '--bot-scalp': '#c9a3ff',
      '--bg-art': art(
        `${OKU_DUST_BIG} repeat`,
        `${OKU_DUST} repeat`,
        `${OKU_MARK} center 55% / auto 56% no-repeat`,
        // 上から差す金の光
        `linear-gradient(180deg, rgba(255,195,0,.24), rgba(255,195,0,.06) 32%, transparent 60%)`,
        // 光の筋
        `repeating-linear-gradient(112deg, transparent 0 70px, rgba(255,215,0,.045) 70px 100px)`,
      ),
    },
  },
  {
    id: RANDOM_THEME,
    label: 'random',
    note: '押すたびに配色を引き直す',
    ...makeRandom(),
  },
];

export const DEFAULT_THEME = 'midnight';

/** ボタンに出す色見本。地・上げ・下げ・アクセントの4色 */
export function swatchOf(id: string): string[] {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const base = THEMES[0].vars;
  return ['--bg', '--up', '--down', '--accent'].map((k) => t.vars[k] ?? base[k]);
}

/**
 * すべてのテーマが触りうる変数。切り替えのときに前の色を消すのに使う。
 * random は毎回ぜんぶ書くので、初回ぶんの鍵で足りる。
 */
const ALL_VARS = [...new Set(THEMES.flatMap((t) => Object.keys(t.vars)))];

export function applyTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  // random は当てるたびに引き直す。同じテーマを選び直せば別の配色になる
  if (t.id === RANDOM_THEME) Object.assign(t, makeRandom());
  const root = document.documentElement;
  // 前のテーマの指定を落としてから当てる。テーマごとに書く変数が違うため
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  if (t.light) root.setAttribute('data-light', '');
  else root.removeAttribute('data-light');
  root.dataset.theme = t.id;
}
