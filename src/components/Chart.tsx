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
import {
  BB_BAND,
  BB_MID,
  GHOST,
  GHOST_LOSE,
  GHOST_WIN,
  BG,
  BORDER,
  DOWN,
  DOWN_FILL,
  GRID,
  MA_COLORS,
  MA_FALLBACK,
  RSI_GUIDE,
  RSI_LINE,
  TEXT,
  UP,
  UP_FILL,
} from '../lib/colors';
import {
  bollingerAt,
  bollingerSeries,
  rsiAdvance,
  rsiPeek,
  rsiSeries,
  smaAt,
  smaSeries,
  type LinePoint,
  type RsiState,
} from '../lib/indicators';
import type { GhostTrade } from '../lib/csvfile';
import type { IndicatorConfig } from '../lib/types';

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
  /** 足の秒数。ゴーストの時刻を足に丸めるのに使う */
  interval: number;
};

export function Chart({ ref, indicators, ghost, interval }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /** 足が VISIBLE_BARS に満たない間は左詰めで表示するため本数を数える */
  const barCountRef = useRef(0);
  const lastBarTimeRef = useRef<number | null>(null);

  /** 指標計算の元データ。終値だけあれば足りる */
  const barsRef = useRef<{ times: number[]; closes: number[] }>({ times: [], closes: [] });
  const maRef = useRef(new Map<number, Line>());
  const bbRef = useRef<{ mid: Line; upper: Line; lower: Line } | null>(null);
  const rsiRef = useRef<Line | null>(null);
  const rsiStateRef = useRef<RsiState | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const ghostRef = useRef<GhostTrade[]>(ghost);
  const intervalRef = useRef(interval);

  /** rAF ループ（レンダーの外）から最新の設定を読むための控え */
  const cfgRef = useRef(indicators);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const maSeries = maRef.current;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: BG },
        textColor: TEXT,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: BORDER, separatorHoverColor: 'rgba(255,255,255,0.08)' },
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      rightPriceScale: {
        borderColor: BORDER,
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: BORDER,
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
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: UP_FILL,
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
      bbRef.current = null;
      rsiRef.current = null;
      rsiStateRef.current = null;
    };
  }, []);

  /**
   * 前回のトレードをマーカーで重ねる。
   * まだ描かれていない足には打てないので、いま出ている足までに絞る。
   *
   * 対戦botの売買はここには出さない。3体ぶんを同じチャートに重ねると読めなくなるので、
   * botごとのミニチャート（components/BotBoard.tsx）に分けてある。
   */
  const applyGhost = useCallback(() => {
    const api = markersRef.current;
    if (!api) return;
    const times = barsRef.current.times;
    const lastBar = times.length ? times[times.length - 1] : 0;
    const iv = intervalRef.current;
    const bucket = (t: number) => Math.floor(t / iv) * iv;

    const marks: SeriesMarker<Time>[] = [];

    for (const g of ghostRef.current) {
      const inTime = bucket(g.entryAt);
      const outTime = bucket(g.exitAt);
      const buy = g.side === 'long';
      if (inTime <= lastBar) {
        marks.push({
          time: inTime as UTCTimestamp,
          position: buy ? 'belowBar' : 'aboveBar',
          shape: buy ? 'arrowUp' : 'arrowDown',
          color: GHOST,
          text: buy ? '前回 買' : '前回 売',
          size: 1,
        });
      }
      if (outTime <= lastBar) {
        marks.push({
          time: outTime as UTCTimestamp,
          position: buy ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: g.pnl >= 0 ? GHOST_WIN : GHOST_LOSE,
          size: 1,
        });
      }
    }
    marks.sort((a, b) => (a.time as number) - (b.time as number));
    api.setMarkers(marks);
  }, []);

  useEffect(() => {
    ghostRef.current = ghost;
    intervalRef.current = interval;
    applyGhost();
  }, [ghost, interval, applyGhost]);

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
  }, []);

  /** 進行中の足の分だけ引き直す。ティック毎に呼ばれるので定数時間で済ませる */
  const updateIndicatorsLast = useCallback(() => {
    const { times, closes } = barsRef.current;
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
  }, []);

  // ---- 指標シリーズの生成 / 破棄 ---------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    cfgRef.current = indicators;

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
          color: MA_COLORS[period] ?? MA_FALLBACK,
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
          color: BB_BAND,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      bbRef.current = {
        upper: band(),
        lower: band(),
        mid: chart.addSeries(LineSeries, {
          color: BB_MID,
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

    // RSI は 0〜100 の別スケールなので専用ペインに置く
    if (indicators.rsi.on && !rsiRef.current) {
      const pane = chart.addPane();
      const s = chart.addSeries(
        LineSeries,
        {
          color: RSI_LINE,
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
          color: RSI_GUIDE,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });
      }
      // 0〜100 に固定しているので余白を詰めてペインを目一杯使う
      s.priceScale().applyOptions({
        borderColor: BORDER,
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
  }, [indicators, redrawIndicators]);

  useImperativeHandle<ReplaySink | null, ReplaySink>(
    ref,
    () => ({
      setCandles(candles) {
        const cs = candleRef.current;
        const vs = volumeRef.current;
        if (!cs || !vs) return;
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
            color: c.close >= c.open ? UP_FILL : DOWN_FILL,
          })),
        );
        barsRef.current = {
          times: candles.map((c) => c.time),
          closes: candles.map((c) => c.close),
        };
        rsiStateRef.current = null;
        redrawIndicators();

        barCountRef.current = candles.length;
        lastBarTimeRef.current = candles.length ? candles[candles.length - 1].time : null;
        applyRange();
        applyGhost();
      },
      updateCandle(c) {
        const isNewBar = lastBarTimeRef.current !== c.time;
        const bars = barsRef.current;
        if (isNewBar) {
          lastBarTimeRef.current = c.time;
          barCountRef.current += 1;
          bars.times.push(c.time);
          bars.closes.push(c.close);
          // 満杯になるまでは左詰め。以降は lightweight-charts の自動スクロールに任せる。
          if (barCountRef.current <= VISIBLE_BARS) applyRange();
          applyGhost();
        } else if (bars.closes.length > 0) {
          bars.closes[bars.closes.length - 1] = c.close;
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
          color: c.close >= c.open ? UP_FILL : DOWN_FILL,
        });
        updateIndicatorsLast();
      },
    }),
    [applyGhost, applyRange, redrawIndicators, updateIndicatorsLast],
  );

  return <div className="chart" ref={containerRef} />;
}
