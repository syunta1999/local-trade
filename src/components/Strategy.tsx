import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 戦略の図を見る窓。public/data/strategy にある画像を一覧から選んで大きく映す。
 * 新しい図はここから追加すると同じ場所に保存され、git を通してどの端末でも同じ一覧になる。
 *
 * 戦略図は白地に黒文字で描かれたものが多く、暗いテーマの画面にそのまま置くと
 * 文字が沈んで読めない。ここでは必ず白い紙の上に載せてから見せている。
 */

/** 開発サーバーのAPI（vite.config.ts）。一覧はここからしか取れない */
const LIST_URL = '/api/strategy';
const fileUrl = (name: string) => `/api/strategy/file/${encodeURIComponent(name)}`;
const putUrl = (name: string) => `/api/strategy/${encodeURIComponent(name)}`;

/** 最後に見ていた図。次に開いたときも同じ図から始める */
const LAST_KEY = 'hyperscape.strategy.last';
const readLast = () => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
const writeLast = (name: string) => {
  try {
    localStorage.setItem(LAST_KEY, name);
  } catch {
    // 覚えられなくても困らない
  }
};

const isImage = (f: File) => f.type.startsWith('image/') || /\.svg$/i.test(f.name);
const isSvg = (name: string) => /\.svg$/i.test(name);
/** 一覧に出す名前。拡張子は見分けに要らない */
const label = (name: string) => name.replace(/\.[^.]+$/, '');

async function fetchList(): Promise<string[]> {
  const res = await fetch(LIST_URL).catch(() => null);
  if (!res || !res.ok || res.headers.get('content-type')?.includes('text/html')) {
    throw new Error('一覧を取れませんでした。npm run dev で起動した画面で使えます');
  }
  const body = (await res.json()) as { files?: string[] };
  return Array.isArray(body.files) ? body.files : [];
}

/** 1枚ずつ public/data/strategy に置く。返ってくる名前は実ファイルの字面（NFD/NFC）に揃っている */
async function upload(file: File): Promise<string> {
  const res = await fetch(putUrl(file.name), { method: 'PUT', body: file });
  const body = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `${file.name} を保存できませんでした`);
  return body.name ?? file.name;
}

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
  /** null は読み込み中 */
  const [files, setFiles] = useState<string[] | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const show = useCallback((name: string) => {
    setNow(name);
    setZoom(false);
    writeLast(name);
  }, []);

  // 開いたら一覧を取り、前回見ていた図（無ければ先頭）を出す
  useEffect(() => {
    let alive = true;
    fetchList().then(
      (list) => {
        if (!alive) return;
        setFiles(list);
        const last = readLast();
        const first = last && list.includes(last) ? last : list[0];
        if (first) show(first);
      },
      (e) => {
        if (!alive) return;
        setFiles([]);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [show]);

  /** 新しい図を保存して一覧に足す。同じ名前があれば差し替わる */
  const add = useCallback(
    async (picked: FileList | File[] | null) => {
      const imgs = [...(picked ?? [])].filter(isImage);
      if (imgs.length === 0) {
        setError('画像ファイル（SVG・PNG・JPEG）を選んでください');
        return;
      }
      setError(null);
      setBusy(true);
      try {
        let lastName = '';
        for (const f of imgs) lastName = await upload(f);
        const list = await fetchList();
        setFiles(list);
        show(list.includes(lastName) ? lastName : (list[list.length - 1] ?? lastName));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [show],
  );

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    void add(e.dataTransfer.files);
  };

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
            <span className="an-sub">public/data/strategy の図。新しい図はここから追加する</span>
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
            <button type="button" className="mini" disabled={busy} onClick={() => pick.current?.click()}>
              {busy ? '保存中…' : '画像を追加'}
            </button>
            <button type="button" className="mini" onClick={onClose}>
              閉じる
            </button>
          </div>
        </header>

        <div className="strat-main">
          <nav className="strat-list" aria-label="戦略の図の一覧">
            {files === null ? (
              <p className="strat-note">読み込み中…</p>
            ) : files.length === 0 ? (
              <p className="strat-note">まだ図がありません</p>
            ) : (
              files.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={name === now ? 'on' : ''}
                  onClick={() => show(name)}
                  title={name}
                >
                  {label(name)}
                </button>
              ))
            )}
          </nav>

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
                  key={now}
                  className={isSvg(now) ? 'svg' : undefined}
                  src={fileUrl(now)}
                  alt={label(now)}
                  onError={() => setError(`${now} を読めませんでした`)}
                />
              </div>
            ) : (
              files !== null && (
                <button type="button" className="strat-empty" onClick={() => pick.current?.click()}>
                  <b>戦略の図を追加</b>
                  <span>SVG・PNG・JPEG。ここに画像をドロップしても保存されます</span>
                </button>
              )
            )}
          </div>
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
