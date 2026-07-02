# serverless-db-bench

無料枠サーバレスDB（Supabase / Neon / Turso / Cloudflare D1）の**コールドスタート × クォータ壁 × 多拠点レイテンシ**を同一条件で実測するハーネス。東京から測った結果と考察は解説記事（Qiita）にまとめています。

> **役割分担**: このリポはコードとRunbook。**DB無料アカウント・多拠点VM・実DBへの計測はあなたが実行**（資格情報と課金判断が要るため）。creds を `.env` に差せば回る。

## 0. 何が計測できるか（＝TO-MEASURE を埋める）
- **A コールドスタート/復帰**: DNS/TCP/TLS を分解した transport ＋ driver接続 ＋ 初回クエリを cold/warm 別に。
- **B クォータ壁**: 無料上限に安全に当てて、エラー本文/HTTPステータス/到達までのiter/リセット復帰を記録。
- **C 多拠点E2E**: 同一runnerを各リージョンVMに置き `REGION` を変えて回す。

数値は**すべてあなたの計測から**。ハーネスは実測値を創作しない（設計方針＝反捏造）。

## 1. セットアップ
```bash
npm install                 # pg / @neondatabase/serverless / @libsql/client（D1はfetchのみ）
cp .env.example .env        # creds を記入（無料アカウント・CC未登録・spend cap ON）
npm run selftest            # ← creds不要。transport+統計が動くか検証
```
`selftest` が「probes ok」「percentile check PASS」を出せば土台はOK。

## 2. スキーマ投入（各ターゲット1回）
```bash
node --env-file=.env bin/setup.mjs --target d1
# targets: supabase | supabase-pooler | neon | neon-http | turso | d1
```
`bench(id,k,v)` を作り `SEED_ROWS`(既定1万) 行を投入。`unindexed_scan` が full scan＝**rows_read=スキャン行**のクォータ検証に使える。

## 3. Phase A: コールドスタート/ウォーム
**cold（1回=1コールド標本。都度アイドルに戻す→cron/タスクで反復）**
```bash
# 事前に：Neonは10分放置しconsoleで"Idle"確認 / Supabaseは7日pause→手動Resume / Turso・D1は数時間放置
node --env-file=.env bin/coldstart.mjs --target neon --mode cold --label 10min-idle
```
**warm（同一接続でp50/p99）**
```bash
node --env-file=.env bin/coldstart.mjs --target neon --mode warm
```
結果は `results/<target>-<region>.jsonl` に追記。

### コールドスタートを正しく測るための必須手順（交絡対策）
- **pooler/keepalive/health-check/ISR を全停止**してから cold（pingが1本でもあると scale-to-zero に落ちない）。
- Neonは **direct 接続**で、consoleで **Active/Idle** を目視確認してから初回クエリ。
- **初回クエリのみ cold**。2本目以降は Postgres buffer が温まる → 毎回 re-idle。
- **Workerのコールドスタートと混同しない**：D1/Vectorize を Worker 経由で測るなら Worker を空打ちで温めてから。REST直叩き(このハーネス)は Worker 起動を含まない。
- クライアントは **DBと同一/最寄りリージョンのVM**（ローカルPC禁止）。**Neonは東京不可→Singapore**。

## 4. Phase C: 多拠点
各リージョンのVM（例: AWS Tokyo/Singapore/Frankfurt/Virginia）に配置し `.env` の `REGION` を変えて `cold`/`warm` を回す。集計時は**拠点⇄DBのペアで報告**（p99は拠点横断で平均しない＝生標本を集約）。

## 5. Phase B: クォータ壁（破壊試験・危険）
**全て block/suspend 型＝課金なし。ただし課金無効が前提。**
```bash
# 必ずまず DRY RUN
node --env-file=.env bin/quota.mjs --target d1 --dimension writes
# 実行（gate: env BILLING_SAFE=confirmed かつ --confirm-destructive）
BILLING_SAFE=confirmed node --env-file=.env bin/quota.mjs --target d1 --dimension writes --confirm-destructive
```
- 最安の壁＝**D1 writes(10万/日)**。D1は **日次00:00 UTCリセット**で反復が速い。Turso/Neonは月次＝当月DBが使えなくなる覚悟で計画的に。
- 到達時の `wall`（status/error本文/iter/rows）を `results/quota-*.jsonl` に記録。リセット後に再クエリして復帰を確認。

## 6. 安全の要（読む）
- 使うのは**無料アカウントのみ**。**カード未登録・spend cap ON・overages OFF** を確認（有料化で block→課金に変わる。実例: 有料D1で$4,868請求）。
- `quota.mjs` は `BILLING_SAFE=confirmed` と `--confirm-destructive` が揃わない限り書き込まない。
- `.env` はコミットしない（`.gitignore` 済）。

## 7. 出力→記事へ
`results/*.jsonl` を集計し `results/RESULTS_TEMPLATE.md` の表を埋める。表は実測系テンプレv2の「事実表／結果①②③」に対応。

## ファイル
- `lib/transport.mjs` … curl -w 段階分解（依存なし）
- `lib/stats.mjs` … percentile/summary（CO注意書きあり・依存なし）
- `lib/targets.mjs` … 4DBアダプタ（driverは動的import）
- `config.mjs` … SQLセット・サンプル数・アイドル指針
- `bin/{selftest,setup,coldstart,quota}.mjs`
- `results/RESULTS_TEMPLATE.md`
