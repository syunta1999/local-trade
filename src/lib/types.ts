/** 1約定（ティック）。時刻は「JSTの壁時計をそのままUTC秒として符号化」した値。 */
export type Tick = {
  /** 時系列順の通し番号（Reactのkey / シーク位置に使う） */
  n: number;
  /** epoch秒。Date.UTC(y, m-1, d, hh, mm, ss)/1000 */
  t: number;
  /** 再生用の時刻。t にランダムジッター(秒未満)を足したもの。表示・足の集計には使わない */
  rt: number;
  /** 値段 */
  price: number;
  /** 株数 */
  size: number;
  /** 金額 */
  value: number;
  /** 直前ティックとの値段比較 (1:上げ / -1:下げ / 0:同値) */
  dir: -1 | 0 | 1;
};

/** lightweight-charts に渡すローソク1本 + 出来高 */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ParsedCsv = {
  ticks: Tick[];
  /** 銘柄コード（ファイル名から推定） */
  symbol: string | null;
  /** セッション日付 YYYY-MM-DD（ファイル名から推定、無ければ本日） */
  dateLabel: string;
  fileName: string;
  /** 解析できずスキップした行数 */
  skipped: number;
};

/** チャートに重ねるテクニカル指標の設定 */
export type IndicatorConfig = {
  /** 表示する移動平均の本数。空なら非表示 */
  maPeriods: number[];
  bb: { on: boolean; period: number; sigma: number };
  rsi: { on: boolean; period: number };
  /** VWAP。本数の指定が無い（その日の寄り付きからの累計）ので真偽値だけ */
  vwap: boolean;
};

/** インジケーターバーが持つUI状態 */
export type IndicatorUi = {
  maOn: boolean;
  maPeriods: number[];
  bbOn: boolean;
  bbPeriod: number;
  bbSigma: number;
  rsiOn: boolean;
  rsiPeriod: number;
  vwapOn: boolean;
};
