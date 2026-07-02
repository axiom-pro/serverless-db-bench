# 実測結果テンプレート（TO-MEASURE を埋める）
> 計測日 __YYYY-MM-DD__ / runner region ごとに記録。数値は自分の計測のみ。空欄は未測定。

## A. コールドスタート / 復帰（同一リージョンVM・cold/warm分離）
| DB | idle条件 | connect(ms) | first query cold(ms) | warm p50/p99(ms) | transport TLS(ms) | 備考 |
|---|---|---|---|---|---|---|
| Supabase | 7日pause→Resume | | (=restore実時間) | | | 公式に復帰時間なし＝実測 |
| Neon(direct) | 10分soak | | | | | 「数百ms」公称の検証 |
| Neon(HTTP) | 10分soak | n/a | | | | HTTP vs direct 差 |
| Turso | 数時間soak | | | | | 「no cold start」検証 |
| D1(REST) | 数時間soak | n/a | | | | serverMs(meta.duration)併記 |

## B. クォータ壁（破壊試験・無料・課金なし）
| DB | 次元 | 到達までのiter/rows | 壁の挙動(HTTP status / error本文) | リセット | 復帰確認 |
|---|---|---|---|---|---|
| D1 | writes 10万/日 | | (block/error) | 00:00 UTC | |
| D1 | reads 500万/日(scan) | | | 00:00 UTC | |
| Turso | reads 500M/月 | | BLOCKED? | 月次 | |
| Neon | 100 CU-h / 0.5GB | | suspend / write fail | 月次 | |
| Supabase | egress 5GB / 500MB | | 402 / read-only | 月次/pause | I/O 250 IOPSスロットルと分離 |

## C. 多拠点E2E（クライアント⇄DBペア・p50/p95・接続確立込み）
| client region | DB | primary/最寄り | cold(ms) | warm p50/p95(ms) | 備考 |
|---|---|---|---|---|---|
| Tokyo | Supabase(ap-northeast-1) | 同 | | | |
| Tokyo | Turso(ap-northeast-1) | 同 | | | |
| Tokyo | D1(apac hint) | | | | Sessions APIあり/なし別 |
| Tokyo | Neon(ap-southeast-1) | Singapore | | | 東京不可のハンデ明記 |
| Singapore | …各DB | | | | |
| Frankfurt | …各DB | | | | |
| Virginia | …各DB | | | | |

## D. 課金軸の実証（scan行課金）
| クエリ | 返却行 | rows_read(実測 meta) | 一致するか |
|---|---|---|---|
| pk_lookup | 1 | | |
| unindexed_scan | (count) | (≈SEED_ROWS) | scan行=消費の実証 |
| count | 1 | | |

## 落とし穴ログ（誤→正）※記事の核
- 誤: Supabase無料RAM=1GB / 正: 0.5GB Nano（250 baseline IOPS→容量前にI/O壁）
- 誤: 「無料超過＝自動課金」 / 正: コア4は block/suspend（課金なし）
- 誤: rows_read=返却行 / 正: スキャン行（index無しで急増）
- 誤: 「エッジD1は常に速い」 / 正: primary単一・遠隔読取はSessions/replica要
- 誤: Neon「数百ms」を鵜呑み / 正: 距離・他起動を除く公称。E2Eは実測
- 誤: Worker起動をDBコールドスタートと混同 / 正: Worker空打ちで分離
