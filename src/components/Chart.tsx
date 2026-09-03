import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ReplaySink } from '../hooks/useReplay';
import { C, refreshPalette } from '../lib/colors';
import {
  bollingerAt,
  bollingerSeries,
  rsiAdvance,
  rsiPeek,
  rsiSeries,
  smaAt,
  smaSeries,
  vwapAdvance,
  vwapPeek,
  vwapSeries,
  type LinePoint,
  type RsiState,
  type VwapState,
} from '../lib/indicators';
import type { GhostTrade } from '../lib/csvfile';
import type { Candle, IndicatorConfig } from '../lib/types';

/** 初期表示で見せる本数 */
const VISIBLE_BARS = 120;
/** RSIペインの高さ(px) */
const RSI_PANE_HEIGHT = 120;

type Line = ISeriesApi<'Line'>;

const toLine = (pts: LinePoint[]) =>
  pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));

type Props = {
  ref?: React.Ref<ReplaySink | null>;
  indicators: IndicatorConfig;
  /** 前回の自分の取引。空なら何も出さない */
  ghost: GhostTrade[];
  /**
   * リプレイ中のチャレンジの取引。空なら通常モード。
   * ゴーストより濃く、建値→返済値を線で結んで値段まで書く。
   */
  replayTrades: GhostTrade[];
  /** 足の秒数。ゴーストの時刻を足に丸めるのに使う */
  interval: number;
  /** 配色テーマの鍵。変わったら色を読み直して塗り直す（randomは引き直すたびに変わる） */
  theme: string;
};

/** 値段と損益の表示。小数のある呼値でも桁が伸びないように丸める */
const label = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export function Chart({ ref, indicators, ghost, replayTrades, interval, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /** 足が VISIBLE_BARS に満たない間は左詰めで表示するため本数を数える */
  const barCountRef = useRef(0);
  const lastBarTimeRef = useRef<number | null>(null);

  /** 指標計算の元データ。typical は VWAP 用の代表値 (高値+安値+終値)/3 */
  const barsRef = useRef<{ times: number[]; closes: number[]; typical: number[]; volumes: number[] }>(
    { times: [], closes: [], typical: [], volumes: [] },
  );
  const maRef = useRef(new Map<number, Line>());
  const bbRef = useRef<{ mid: Line; upper: Line; lower: Line } | null>(null);
  const rsiRef = useRef<Line | null>(null);
  const rsiStateRef = useRef<RsiState | null>(null);
  const vwapRef = useRef<Line | null>(null);
  const vwapStateRef = useRef<VwapState | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const ghostRef = useRef<GhostTrade[]>(ghost);
  const replayRef = useRef<GhostTrade[]>(replayTrades);
  /** リプレイの取引ごとに引く建玉→返済の線。添字は replayRef の位置 */
  const tradeLinesRef = useRef(new Map<number, Line>());
  const intervalRef = useRef(interval);

  /** rAF ループ（レンダーの外）から最新の設定を読むための控え */
  const cfgRef = useRef(indicators);
  /** いま出しているローソク。テーマを変えたときに色だけ塗り直すのに使う */
  const dataRef = useRef<Candle[]>([]);
  const themeRef = useRef(theme);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const maSeries = maRef.current;
    const tradeLines = tradeLinesRef.current;
    refreshPalette();

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        // 背景は描かない。柄物テーマが .chart-wrap に敷いた柄を透かすため（index.css の --bg-art）
        background: { color: 'transparent' },
        textColor: C.text,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: C.border, separatorHoverColor: 'rgba(255,255,255,0.08)' },
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 6,
        barSpacing: 7,
      },
      localization: {
        // 壁時計をそのまま UTC 秒として持たせているので UTC で描画する
        locale: 'ja-JP',
      },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: C.upFill,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(candle);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      maSeries.clear();
      tradeLines.clear();
      bbRef.current = null;
      rsiRef.current = null;
      rsiStateRef.current = null;
      vwapRef.current = null;
      vwapStateRef.current = null;
    };
  }, []);

  // テーマを切り替えたら、CSS変数を読み直して枠とローソクに当て直す
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleRef.current;
    const vs = volumeRef.current;
    if (!chart || !cs || !vs) return;
    refreshPalette();
    chart.applyOptions({
      layout: { background: { color: 'transparent' }, textColor: C.text },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border },
    });
    cs.applyOptions({
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
    });
    // 出来高は棒ごとに色を持つので、いまのデータで塗り直す
    vs.setData(
      dataRef.current.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? C.upFill : C.downFill,
      })),
    );
  }, [theme]);

  /**
   * ゴーストとリプレイのトレードをマーカーで重ねる。
   * まだ描かれていない足には打てないので、いま出ている足までに絞る。
   * リプレイでは先の値動きを見せないためでもある。
   *
   * 対戦botの売買はここには出さない。3体ぶんを同じチャートに重ねると読めなくなるので、
   * botごとのミニチャート（components/BotBoard.tsx）に分けてある。
   */
  const applyMarks = useCallback(() => {
    const api = markersRef.current;
    if (!api) return;
    const times = barsRef.current.times;
    const last = times.length ? times[times.length - 1] : 0;
    const iv = intervalRef.current;
    const bucket = (t: number) => Math.floor(t / iv) * iv;

    const marks: SeriesMarker<Time>[] = [];

    for (const g of ghostRef.current) {
      const inTime = bucket(g.entryAt);
      const outTime = bucket(g.exitAt);
      const buy = g.side === 'long';
      if (inTime <= last) {
        marks.push({
          time: inTime as UTCTimestamp,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: C.ghost,
          text: buy ? '前回 買' : '前回 売',
          size: 1,
        });
      }
      if (outTime <= last) {
        marks.push({
          time: outTime as UTCTimestamp,
          position: buy ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: g.pnl >= 0 ? C.ghostWin : C.ghostLose,
          size: 1,
        });
      }
    }

    // リプレイは「いつ・いくらで・どうなったか」を読ませたいので、値段と損益まで書く
    for (const t of replayRef.current) {
      const inTime = bucket(t.entryAt);
      const outTime = bucket(t.exitAt);
      const buy = t.side === 'long';
      if (inTime <= last) {
        marks.push({
          time: inTime as UTCTimestamp,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: buy ? C.up : C.down,
          text: `${t.id} ${buy ? '買' : '売'} ${label(t.entry)}`,
          size: 1,
        });
      }
      if (outTime <= last) {
        marks.push({
          time: outTime as UTCTimestamp,
          position: buy ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: t.pnl >= 0 ? C.up : C.down,
          text: `返 ${label(t.exit)} ${t.pnl >= 0 ? '+' : ''}${label(t.pnl)}`,
          size: 1,
        });
      }
    }

    marks.sort((a, b) => (a.time as number) - (b.time as number));
    api.setMarkers(marks);
  }, []);

  /**
   * リプレイのトレードを、建値から返済値まで1本の線で結ぶ。
   * どの値段で入ってどこで降りたかが、マーカーだけより一目で分かる。
   * 勝ちは赤 / 負けは青（botの売買パネルと同じ読み方）。
   */
  const applyTradeLines = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const times = barsRef.current.times;
    const last = times.length ? times[times.length - 1] : 0;
    const iv = intervalRef.current;
    const bucket = (t: number) => Math.floor(t / iv) * iv;
    const trades = replayRef.current;
    const lines = tradeLinesRef.current;

    // 巻き戻したときは、まだ来ていない取引の線を片付ける
    for (const [i, s] of lines) {
      if (i < trades.length && bucket(trades[i].exitAt) <= last) continue;
      chart.removeSeries(s);
      lines.delete(i);
    }

    for (let i = 0; i < trades.length; i++) {
      if (lines.has(i)) continue;
      const t = trades[i];
      const from = bucket(t.entryAt);
      const to = bucket(t.exitAt);
      // 返済の足まで来ていなければ引かない。先の値動きを教えてしまう
      if (to > last) continue;
      // 同じ足で建てて返した取引は線にならないので、マーカーだけで示す
      if (from >= to) continue;
      const s = chart.addSeries(LineSeries, {
        color: t.pnl >= 0 ? C.up : C.down,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData([
        { time: from as UTCTimestamp, value: t.entry },
        { time: to as UTCTimestamp, value: t.exit },
      ]);
      lines.set(i, s);
    }
  }, []);

  useEffect(() => {
    ghostRef.current = ghost;
    replayRef.current = replayTrades;
    intervalRef.current = interval;
    // 取引・足種・配色のどれが変わっても、引いてある線は色も位置も合わなくなる
    const chart = chartRef.current;
    const lines = tradeLinesRef.current;
    if (chart) {
      for (const [, s] of lines) chart.removeSeries(s);
      lines.clear();
    }
    applyTradeLines();
    applyMarks();
  }, [ghost, replayTrades, interval, theme, applyMarks, applyTradeLines]);

  /** 足数に応じた表示レンジを適用する */
  const applyRange = useCallback(() => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const n = barCountRef.current;
    if (n === 0) return;
    if (n > VISIBLE_BARS) {
      ts.setVisibleLogicalRange({ from: n - VISIBLE_BARS, to: n + 8 });
      return;
    }
    // 足が少ないうちは左詰めのまま、本数に応じて窓を広げる
    const span = Math.min(VISIBLE_BARS, Math.max(30, n + 10));
    ts.setVisibleLogicalRange({ from: -2, to: span });
  }, []);

  // ---- 指標の描画 ------------------------------------------------------

  /** 全期間を引き直す。シーク・足変更・指標設定の変更で呼ぶ */
  const redrawIndicators = useCallback(() => {
    const { times, closes } = barsRef.current;
    const cfg = cfgRef.current;

    for (const [period, s] of maRef.current) {
      s.setData(toLine(smaSeries(times, closes, period)));
    }

    const bb = bbRef.current;
    if (bb) {
      const b = bollingerSeries(times, closes, cfg.bb.period, cfg.bb.sigma);
      bb.upper.setData(toLine(b.upper));
      bb.mid.setData(toLine(b.mid));
      bb.lower.setData(toLine(b.lower));
    }

    const rsi = rsiRef.current;
    if (rsi) {
      const r = rsiSeries(times, closes, cfg.rsi.period);
      rsi.setData(toLine(r.points));
      rsiStateRef.current = r.state;
    }

    const vwap = vwapRef.current;
    if (vwap) {
      const v = vwapSeries(times, barsRef.current.typical, barsRef.current.volumes);
      vwap.setData(toLine(v.points));
      vwapStateRef.current = v.state;
    }
  }, []);

  /** 進行中の足の分だけ引き直す。ティック毎に呼ばれるので定数時間で済ませる */
  const updateIndicatorsLast = useCallback(() => {
    const { times, closes, typical, volumes } = barsRef.current;
    const n = closes.length;
    if (n === 0) return;
    const i = n - 1;
    const time = times[i] as UTCTimestamp;
    const cfg = cfgRef.current;

    for (const [period, s] of maRef.current) {
      const v = smaAt(closes, i, period);
      if (v !== undefined) s.update({ time, value: v });
    }

    const bb = bbRef.current;
    if (bb) {
      const b = bollingerAt(closes, i, cfg.bb.period, cfg.bb.sigma);
      if (b) {
        bb.upper.update({ time, value: b.upper });
        bb.mid.update({ time, value: b.mid });
        bb.lower.update({ time, value: b.lower });
      }
    }

    const rsi = rsiRef.current;
    if (rsi) {
      const st = rsiStateRef.current;
      if (!st || !st.ready || st.period !== cfg.rsi.period) {
        // 暫定計算の土台が作れる本数に届いていない。足が少ないので毎回作り直して構わない
        const r = rsiSeries(times, closes, cfg.rsi.period);
        rsi.setData(toLine(r.points));
        rsiStateRef.current = r.state;
      } else {
        // 閉じた足を平均損益に織り込む。追いついていれば何もしない
        rsiAdvance(st, closes, n - 2);
        const v = rsiPeek(st, closes, i);
        if (v !== undefined) rsi.update({ time, value: v });
      }
    }

    const vwap = vwapRef.current;
    if (vwap) {
      const st = vwapStateRef.current;
      if (!st) {
        const v = vwapSeries(times, typical, volumes);
        vwap.setData(toLine(v.points));
        vwapStateRef.current = v.state;
      } else {
        // 閉じた足を累計に入れる。追いついていれば何もしない
        vwapAdvance(st, times, typical, volumes, n - 2);
        const v = vwapPeek(st, times, typical, volumes, i);
        if (v !== undefined) vwap.update({ time, value: v });
      }
    }
  }, []);

  // ---- 指標シリーズの生成 / 破棄 ---------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    cfgRef.current = indicators;

    // テーマが変わったときは、色を持ったまま残っている線を一度捨てる
    if (themeRef.current !== theme) {
      themeRef.current = theme;
      for (const [, s] of maRef.current) chart.removeSeries(s);
      maRef.current.clear();
      if (bbRef.current) {
        chart.removeSeries(bbRef.current.mid);
        chart.removeSeries(bbRef.current.upper);
        chart.removeSeries(bbRef.current.lower);
        bbRef.current = null;
      }
      if (rsiRef.current) {
        const panes = chart.panes();
        chart.removeSeries(rsiRef.current);
        rsiRef.current = null;
        rsiStateRef.current = null;
        if (panes.length > 1) chart.removePane(1);
      }
      if (vwapRef.current) {
        chart.removeSeries(vwapRef.current);
        vwapRef.current = null;
        vwapStateRef.current = null;
      }
    }

    // 移動平均: 選択されている本数だけを残す
    for (const [period, s] of maRef.current) {
      if (indicators.maPeriods.includes(period)) continue;
      chart.removeSeries(s);
      maRef.current.delete(period);
    }
    for (const period of indicators.maPeriods) {
      if (maRef.current.has(period)) continue;
      maRef.current.set(
        period,
        chart.addSeries(LineSeries, {
          color: C.ma(period),
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }),
      );
    }

    // ボリンジャーバンド
    if (indicators.bb.on && !bbRef.current) {
      const band = () =>
        chart.addSeries(LineSeries, {
          color: C.bbBand,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      bbRef.current = {
        upper: band(),
        lower: band(),
        mid: chart.addSeries(LineSeries, {
          color: C.bbMid,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }),
      };
    } else if (!indicators.bb.on && bbRef.current) {
      chart.removeSeries(bbRef.current.upper);
      chart.removeSeries(bbRef.current.lower);
      chart.removeSeries(bbRef.current.mid);
      bbRef.current = null;
    }

    // VWAP は値段と同じスケールなので、ローソクと同じペインに重ねる。
    // その日の基準値として見るものなので、移動平均より太く引く
    if (indicators.vwap && !vwapRef.current) {
      vwapRef.current = chart.addSeries(LineSeries, {
        color: C.vwap,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    } else if (!indicators.vwap && vwapRef.current) {
      chart.removeSeries(vwapRef.current);
      vwapRef.current = null;
      vwapStateRef.current = null;
    }

    // RSI は 0〜100 の別スケールなので専用ペインに置く
    if (indicators.rsi.on && !rsiRef.current) {
      const pane = chart.addPane();
      const s = chart.addSeries(
        LineSeries,
        {
          color: C.rsiLine,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        },
        pane.paneIndex(),
      );
      for (const price of [70, 30]) {
        s.createPriceLine({
          price,
          color: C.rsiGuide,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });
      }
      // 0〜100 に固定しているので余白を詰めてペインを目一杯使う
      s.priceScale().applyOptions({
        borderColor: C.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      });
      pane.setHeight(RSI_PANE_HEIGHT);
      rsiRef.current = s;
    } else if (!indicators.rsi.on && rsiRef.current) {
      const index = rsiRef.current.getPane().paneIndex();
      chart.removeSeries(rsiRef.current);
      rsiRef.current = null;
      rsiStateRef.current = null;
      if (index > 0 && chart.panes().length > 1) chart.removePane(index);
    }

    redrawIndicators();
    // theme が変わると上で指標を作り直しているので、新しい色が乗る
  }, [indicators, theme, redrawIndicators]);

  useImperativeHandle<ReplaySink | null, ReplaySink>(
    ref,
    () => ({
      setCandles(candles) {
        const cs = candleRef.current;
        const vs = volumeRef.current;
        if (!cs || !vs) return;
        dataRef.current = candles;
        cs.setData(
          candles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        vs.setData(
          candles.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? C.upFill : C.downFill,
          })),
        );
        barsRef.current = {
          times: candles.map((c) => c.time),
          closes: candles.map((c) => c.close),
          typical: candles.map((c) => (c.high + c.low + c.close) / 3),
          volumes: candles.map((c) => c.volume),
        };
        rsiStateRef.current = null;
        vwapStateRef.current = null;
        redrawIndicators();

        barCountRef.current = candles.length;
        lastBarTimeRef.current = candles.length ? candles[candles.length - 1].time : null;
        applyRange();
        applyMarks();
        applyTradeLines();
      },
      updateCandle(c) {
        const isNewBar = lastBarTimeRef.current !== c.time;
        const bars = barsRef.current;
        if (isNewBar) {
          lastBarTimeRef.current = c.time;
          barCountRef.current += 1;
          bars.times.push(c.time);
          bars.closes.push(c.close);
          bars.typical.push((c.high + c.low + c.close) / 3);
          bars.volumes.push(c.volume);
          // 満杯になるまでは左詰め。以降は lightweight-charts の自動スクロールに任せる。
          if (barCountRef.current <= VISIBLE_BARS) applyRange();
          applyMarks();
          applyTradeLines();
        } else if (bars.closes.length > 0) {
          const last = bars.closes.length - 1;
          bars.closes[last] = c.close;
          bars.typical[last] = (c.high + c.low + c.close) / 3;
          bars.volumes[last] = c.volume;
        }

        candleRef.current?.update({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        });
        volumeRef.current?.update({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? C.upFill : C.downFill,
        });
        updateIndicatorsLast();
      },
    }),
    [applyMarks, applyTradeLines, applyRange, redrawIndicators, updateIndicatorsLast],
  );

  return <div className="chart" ref={containerRef} />;
}
