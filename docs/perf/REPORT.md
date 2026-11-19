# Dukaan — device performance report

All numbers are measured. Each one comes with its environment. Rows still to be measured say "pending", never an estimate.

## Environment

| | |
|---|---|
| Device | Android emulator `dukaan_lowram`: android-35 x86_64, **2 GB RAM**, 4 vCPU, swiftshader GPU |
| Host | 7 GB laptop, heavily swapping during the run (kswapd ~50% CPU), so this is pessimistic for a real phone |
| Build | Debug (dev client + Metro, Hermes, **no** release optimisations), SQLCipher on, WAL |
| Date | 2026-11-19 |

## Catalogue search (gate: p95 < 50 ms on 100k SKUs)

From the Diagnostics screen → "Seed 100k demo catalogue" → "Run search benchmark".
Each run is 6 rounds × the fixed query set (Latin, Devanagari, Hinglish transliteration, typos, barcode prefixes).
Round 1 is warm-up and is discarded, leaving 250 timed queries through `searchItems(db, q, 30)` over the op-sqlite JSI bridge.

| Items | Queries | p50 | p95 | p99 | max |
|---:|---:|---:|---:|---:|---:|
| 100,000 | 250 | 5.32 ms | **16.67 ms** | 23.96 ms | 24.55 ms |

Raw log line: `[DUKAAN_BENCH] {"label":"search","samples":250,"p50":5.32,"p95":16.67,"p99":23.96,"max":24.55,"items":100000}`

**Result: passes the gate (16.67 ms vs 50 ms).**

## Seeding

100,000 items, 2,000-row transactions with FTS5 index maintenance, then `optimize` and `ANALYZE`: **64.6 s** on the
device above. The encrypted DB is **67.1 MB** afterwards.
(The diagnostics seeder writes rows directly and does not go through the op log; CSV import emits `item.bulk` ops.)

## Device smoke checks (2026-11-19, same emulator)

| Check | Result |
|---|---|
| First-run shop setup (PIN hash, SQLCipher key) | Pass after fix: Hermes has no `crypto.getRandomValues`. Added an expo-crypto polyfill (`src/lib/polyfills.ts`) |
| Transliterated search "chawal" → चावल items | Pass |
| Cart → payment (cash) → bill saved `C1-000001` | Pass after fix: stack screens now respect the bottom safe-area inset (the Save button was under the nav bar) |
| HID keyboard-wedge burst (13 digits + Enter, search field focused) | Pass: item added, no digits leaked into the field |
| VisionCamera scanning | Pending: needs a physical camera |
| Bluetooth ESC/POS print | Pending: emulator has no Bluetooth; covered by encoder/queue unit tests only |

## Pending
- Release build (R8/Hermes bytecode) numbers, cold start, bill-save latency, memory: Phase 7.
