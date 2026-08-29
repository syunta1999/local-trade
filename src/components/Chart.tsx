import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ReplaySink } from '../hooks/useReplay';
import { BG, BORDER, DOWN, DOWN_FILL, GRID, TEXT, UP, UP_FILL } from '../lib/colors';

/** 初期表示で見せる本数 */
const VISIBLE_BARS = 120;

type Props = {
  ref?: React.Ref<ReplaySink | null>;
};

export function Chart({ ref }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  /** 足が VISIBLE_BARS に満たない間は左詰めで表示するため本数を数える */
  const barCountRef = useRef(0);
  const lastBarTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: BG },
        textColor: TEXT,
        fontSize: 11,
        attributionLogo: false,
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

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

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
        barCountRef.current = candles.length;
        lastBarTimeRef.current = candles.length ? candles[candles.length - 1].time : null;
        applyRange();
      },
      updateCandle(c) {
        if (lastBarTimeRef.current !== c.time) {
          lastBarTimeRef.current = c.time;
          barCountRef.current += 1;
          // 満杯になるまでは左詰め。以降は lightweight-charts の自動スクロールに任せる。
          if (barCountRef.current <= VISIBLE_BARS) applyRange();
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
      },
    }),
    [applyRange],
  );

  return <div className="chart" ref={containerRef} />;
}
