import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStateCsv, saveStateCsv } from '../lib/csvfile';
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  SETTINGS_HEAD,
  settingsFromCsv,
  settingsToRows,
  type Settings,
} from '../lib/settings';

/** 書き込みをまとめる間隔(ms)。倍速ボタンの連打などで毎回書かないように */
const SAVE_MS = 500;

/**
 * 画面の設定をCSVに覚えさせる。
 *
 * 読み込みが済むまでは書き戻さない。起動直後の既定値で、
 * 保存済みの設定を上書きしてしまうのを防ぐため。
 */
export function useSettings() {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const timer = useRef(0);
  const lastRef = useRef('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const text = await loadStateCsv(SETTINGS_FILE);
      if (!alive) return;
      const s = text ? settingsFromCsv(text) : DEFAULT_SETTINGS;
      lastRef.current = settingsToRows(s).join('\n');
      setLoaded(s);
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  /** いまの設定を書き戻す。中身が変わっていなければ何もしない */
  const save = useCallback(
    (s: Settings) => {
      if (!loaded) return;
      const rows = settingsToRows(s);
      const text = rows.join('\n');
      if (text === lastRef.current) return;
      lastRef.current = text;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => void saveStateCsv(rows, SETTINGS_HEAD, SETTINGS_FILE),
        SAVE_MS,
      );
    },
    [loaded],
  );

  return { loaded, save };
}
