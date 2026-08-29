import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const DATA_DIR = join(process.cwd(), 'public', 'data')
/** チャレンジの記録置き場。.csv 以外の名前なので再生用CSVの一覧には出ない */
const LOG_DIR = join(DATA_DIR, 'challenges')
/** 取り込むCSVの上限。歩み値1日分でも数MBなので十分 */
const MAX_UPLOAD = 64 * 1024 * 1024

/** 危険な文字とディレクトリ移動を落として "○○.csv" だけ通す */
function safeName(raw: string): string | null {
  const name = basename(decodeURIComponent(raw)).replace(/[^\w.\-一-龥ぁ-んァ-ヶー]/g, '_')
  if (!name || name.startsWith('.') || !name.toLowerCase().endsWith('.csv')) return null
  return name
}

async function listCsv() {
  const names = await readdir(DATA_DIR).catch(() => [] as string[])
  return names.filter((n) => n.toLowerCase().endsWith('.csv') && !n.startsWith('.')).sort()
}

/**
 * public/data のCSVを一覧・取得・保存するための開発サーバー用API。
 * ブラウザからはローカルのファイルシステムに書けないので dev サーバーに肩代わりさせる。
 *
 * 取得も Vite の public 配信ではなくここを通す。public 配信は起動時に作った
 * ファイル一覧を見るので、起動後に書いたファイルが index.html にフォールバックしてしまう。
 * 本番ビルド (vite build) には含まれない。
 */
function dataFilesApi(): Plugin {
  return {
    name: 'data-files-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/data', (req, res, next) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        const path = (req.url ?? '/').split('?')[0]

        if (req.method === 'GET' && (path === '/' || path === '')) {
          listCsv().then(
            (files) => send(200, { files }),
            (e) => send(500, { error: String(e) }),
          )
          return
        }

        if (req.method === 'GET' && path.startsWith('/file/')) {
          const name = safeName(path.slice('/file/'.length))
          if (!name) return send(400, { error: 'CSVファイル名が不正です' })
          readFile(join(DATA_DIR, name)).then(
            (buf) => {
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/csv; charset=utf-8')
              res.setHeader('Cache-Control', 'no-store')
              res.end(buf)
            },
            () => send(404, { error: `${name} がありません` }),
          )
          return
        }

        if (req.method === 'PUT') {
          const name = safeName(path.replace(/^\//, ''))
          if (!name) return send(400, { error: 'CSVファイル名が不正です' })

          const chunks: Buffer[] = []
          let size = 0
          let aborted = false
          req.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_UPLOAD) {
              aborted = true
              send(413, { error: 'ファイルが大きすぎます' })
              req.destroy()
              return
            }
            chunks.push(c)
          })
          req.on('end', () => {
            if (aborted) return
            const body = Buffer.concat(chunks)
            const target = join(DATA_DIR, name)
            // 同名で中身も同じなら書き直さない
            readFile(target)
              .then((cur) => cur.equals(body))
              .catch(() => false)
              .then((same) =>
                same
                  ? send(200, { name, saved: false })
                  : writeFile(target, body).then(() => send(200, { name, saved: true })),
              )
              .catch((e) => send(500, { error: String(e) }))
          })
          return
        }

        next()
      })
    },
  }
}

/**
 * チャレンジ（分析用の記録）を溜めるAPI。
 * CSVの整形はクライアント側(csvfile.ts)に任せ、ここは追記だけを受け持つ。
 */
function challengeApi(): Plugin {
  return {
    name: 'challenge-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/challenges', (req, res, next) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        const safe = (n: string) => (/^[\w-]+\.csv$/.test(n) ? n : null)
        const path = (req.url ?? '/').split('?')[0]

        if (req.method === 'GET' && (path === '/' || path === '')) {
          readdir(LOG_DIR)
            .catch(() => [] as string[])
            .then(async (names) => {
              const files: Record<string, string> = {}
              for (const n of names.filter((x) => safe(x))) {
                files[n] = await readFile(join(LOG_DIR, n), 'utf8').catch(() => '')
              }
              send(200, { files })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        // DELETE /api/challenges/<id> … そのチャレンジの行を全ファイルから消す
        if (req.method === 'DELETE') {
          const id = decodeURIComponent(path.replace(/^\//, '')).trim()
          if (!/^[\w-]+$/.test(id)) return send(400, { error: 'IDが不正です' })

          readdir(LOG_DIR)
            .catch(() => [] as string[])
            .then(async (names) => {
              let removed = 0
              for (const n of names.filter((x) => safe(x))) {
                const target = join(LOG_DIR, n)
                const text = await readFile(target, 'utf8').catch(() => '')
                if (!text) continue
                const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
                const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
                const head = lines[0]
                const body = lines.slice(1).filter((l) => l.trim() !== '')
                const kept = body.filter((l) => l.split(',')[0] !== id)
                removed += body.length - kept.length
                const next = [head, ...kept].join('\r\n')
                await writeFile(target, `${bom}${next}\r\n`)
              }
              send(200, { id, removed })
            })
            .catch((e) => send(500, { error: String(e) }))
          return
        }

        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                files?: { name: string; header: string; rows: string[]; replace?: boolean }[]
              }
              if (!Array.isArray(body.files)) return send(400, { error: 'files がありません' })
              await mkdir(LOG_DIR, { recursive: true })

              const saved: { name: string; appended: number }[] = []
              for (const f of body.files) {
                const name = safe(f.name ?? '')
                if (!name || !Array.isArray(f.rows)) continue
                const target = join(LOG_DIR, name)

                // replace は毎回まるごと書き直す（ルールのような「いまの状態」向け）
                if (f.replace) {
                  await writeFile(target, `\uFEFF${[f.header, ...f.rows].join('\r\n')}\r\n`)
                  saved.push({ name, appended: f.rows.length })
                  continue
                }

                if (f.rows.length === 0) continue
                const exists = await readFile(target, 'utf8').then(
                  () => true,
                  () => false,
                )
                // 無ければ BOM とヘッダーから書き起こす
                if (!exists) await writeFile(target, `\uFEFF${f.header}\r\n`)
                await appendFile(target, `${f.rows.join('\r\n')}\r\n`)
                saved.push({ name, appended: f.rows.length })
              }
              send(200, { saved })
            } catch (e) {
              send(500, { error: String(e) })
            }
          })
          return
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dataFilesApi(), challengeApi()],
  server: {
    // public/data への保存でページ全体がリロードされると再生位置が飛ぶので監視から外す
    watch: { ignored: ['**/public/data/**'] },
  },
})
