import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 戦略の図を見る窓。手元の画像（SVG/PNG/JPEG）を選んで大きく映す。
 *
 * 戦略図は白地に黒文字で描かれたものが多く、暗いテーマの画面にそのまま置くと
 * 文字が沈んで読めない。ここでは必ず白い紙の上に載せてから見せている。
 * 選んだ画像はブラウザに覚えさせて、次に開いたときもそのまま出す。
 */

type Sheet = { name: string; url: string };

const KEY = 'hyperscape.strategy.images';
/** 覚えておく上限。data URL は元のファイルより3割ほど太るので余裕をみる */
const KEEP_BYTES = 4 * 1024 * 1024;

function load(): Sheet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Sheet[];
    return Array.isArray(list) ? list.filter((s) => s && s.name && s.url) : [];
  } catch {
    return [];
  }
}

/** 入り切らないぶんは古いほうから落とす。落ちても今見ている画像は消さない */
function save(list: Sheet[]) {
  const keep: Sheet[] = [];
  let size = 0;
  for (const s of [...list].reverse()) {
    size += s.url.length;
    if (size > KEEP_BYTES) break;
    keep.unshift(s);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    // 容量オーバーなどで覚えられなくても、表示は続ける
  }
}

const readAsUrl = (file: File) =>
  new Promise<string>((ok, ng) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => ng(new Error(`${file.name} を読めませんでした`));
    fr.readAsDataURL(file);
  });

/** ヘッダー右の「戦略」ボタン。押すと図の窓が開く */
export function StrategyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`btn tool-btn${open ? ' on' : ''}`}
        onClick={() => setOpen(true)}
        title="戦略の図を開く"
      >
        戦略
      </button>
      {open && <StrategyView onClose={() => setOpen(false)} />}
    </>
  );
}

function StrategyView({ onClose }: { onClose: () => void }) {
  const [sheets, setSheets] = useState<Sheet[]>(load);
  const [at, setAt] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 同じ名前で選び直したら差し替える。並べても見分けがつかない */
  const add = useCallback(
    async (files: FileList | File[] | null) => {
      const imgs = [...(files ?? [])].filter(
        (f) => f.type.startsWith('image/') || /\.svg$/i.test(f.name),
      );
      if (imgs.length === 0) {
        setError('画像ファイル（SVG・PNG・JPEG）を選んでください');
        return;
      }
      setError(null);
      try {
        const added: Sheet[] = [];
        for (const f of imgs) added.push({ name: f.name, url: await readAsUrl(f) });
        const next = [...sheets.filter((s) => !added.some((a) => a.name === s.name)), ...added];
        save(next);
        setSheets(next);
        setAt(next.length - 1);
        setZoom(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [sheets],
  );

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    void add(e.dataTransfer.files);
  };

  const remove = (i: number) => {
    const next = sheets.filter((_, k) => k !== i);
    save(next);
    setSheets(next);
    setAt((a) => Math.min(a > i ? a - 1 : a, Math.max(0, next.length - 1)));
  };

  const now = sheets[Math.min(at, sheets.length - 1)];

  return (
    <div
      className="an-back"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="strat" onClick={(e) => e.stopPropagation()}>
        <header className="an-head">
          <div>
            <strong>戦略</strong>
            <span className="an-sub">手元の図を選んで大きく見る</span>
          </div>
          <div className="an-acts">
            {now && (
              <button
                type="button"
                className={`mini${zoom ? ' on' : ''}`}
                onClick={() => setZoom((z) => !z)}
                title="原寸で見る（はみ出したぶんはスクロール）"
              >
                {zoom ? 'ぴったり' : '拡大'}
              </button>
            )}
            <button type="button" className="mini" onClick={() => pick.current?.click()}>
              画像を選ぶ
            </button>
            <button type="button" className="mini" onClick={onClose}>
              閉じる
            </button>
          </div>
        </header>

        {sheets.length > 0 && (
          <nav className="strat-tabs">
            {sheets.map((s, i) => (
              <span key={s.name} className={`strat-tab${i === Math.min(at, sheets.length - 1) ? ' on' : ''}`}>
                <button type="button" onClick={() => { setAt(i); setZoom(false); }} title={s.name}>
                  {s.name.replace(/\.[^.]+$/, '')}
                </button>
                <button type="button" className="strat-x" onClick={() => remove(i)} title="一覧から外す">
                  ✕
                </button>
              </span>
            ))}
          </nav>
        )}

        <div
          className={`strat-body${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          {now ? (
            /* 白い紙。図の黒い文字が暗いテーマでも読めるようにここだけ明るくする */
            <div className={`strat-sheet${zoom ? ' zoom' : ''}`}>
              {/* viewBox しか持たないSVGは大きさを持たないので、幅はこちらで決める */}
              <img
                className={now.url.startsWith('data:image/svg') ? 'svg' : undefined}
                src={now.url}
                alt={now.name}
              />
            </div>
          ) : (
            <button type="button" className="strat-empty" onClick={() => pick.current?.click()}>
              <b>戦略の図を選ぶ</b>
              <span>SVG・PNG・JPEG。ここに画像をドロップしても開きます</span>
            </button>
          )}
        </div>

        {error && <p className="strat-err">{error}</p>}

        <input
          ref={pick}
          type="file"
          accept="image/*,.svg"
          multiple
          hidden
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
