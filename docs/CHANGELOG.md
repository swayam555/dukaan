# Changelog

## Phase 0 — Plan (2026-11-18)
- docs/ARCHITECTURE.md (system, data model, conflict rules, sync sequence, engine state machine) and docs/PLAN.md.

## Phase 1 — Foundation (2026-11-18, device/backend verification pending)
- `packages/core`: integer-paise money, units (milli-quantities), GSTIN validation + state codes, HLC, UUIDv7.
- `packages/db`: SQL migrations (generated into TS), driver interface, better-sqlite3 driver for tests/tools.
- Expo SDK 58 app shell: op-sqlite + SQLCipher (key in SecureStore), WAL pragmas, setup → lock → tabs flow
  (`Stack.Protected`), English/Hindi strings.
- Spring Boot 4.1 sync-service skeleton: device auth, Flyway; docker compose (Postgres, Redis, Kafka, nginx); CI.
- Pending: Android APK on `dukaan_lowram`, `./mvnw verify`, `docker compose up` — not yet run to completion.

## Phase 2 — Catalogue & search (2026-11-18)
- Devanagari ↔ Latin transliteration and phonetic keys; one-column trigram FTS5 index over keys.
- Search planner: bm25 for narrow queries, popularity ranking for broad ones, bounded typo fallback; keyset pagination.
- Deterministic 100k-SKU seeder; host benchmark p95 ≈ 6–7 ms (file-backed, laptop — **not** a device number).
- Streamed, resumable CSV import with byte-offset checkpoints; FlashList v2 catalogue; Diagnostics screen
  that seeds and benchmarks on device (pending APK).

## Phase 3 — Billing (2026-11-19)
- GST engine (CGST/SGST vs IGST, cess, line + bill discounts, round-off) with fast-check property tests.
- Op log: `OpWriter`, exactly-once `applyOp`, per-field LWW, PN-counter stock; bill save / void / hold.
- Billing screen: debounced search, HID scanner capture (digits + Enter → barcode lookup), cart, parked bills
  with resume (current cart auto-parked), loose items forced through the weight keypad before checkout.
- Payment screen: cash/UPI/card/khata split, change calculator, UPI QR (`upi://pay`), new-customer khata.
- A4 tax invoice / bill of supply HTML → PDF share; owner-editable shop profile; seeder CLI (SQLite and/or CSV).
- Tests: core 58, db 30, app component tests 7 (RNTL 14 + jest-expo against real SQLite via better-sqlite3).

## Phase 4 — Hardware (2026-11-19, device verification pending)
- `@dukaan/native` Nitro module (nitrogen 0.37): Bluetooth ESC/POS printer (Android SPP with insecure-socket
  fallback, chunked writes 512 B / 20 ms on one IO thread; iOS BLE) and an Android HID scanner that catches
  keyboard-wedge bursts in `dispatchKeyEvent` and replays non-scan typing untouched.
- ESC/POS encoder in core (text, alignment, bold/double, QR, cut, `GS v 0` raster); 58/80 mm widths.
- Hindi/Devanagari receipt lines drawn with Skia SkParagraph off-screen and thresholded to 1-bit raster.
- Durable print queue (migration 0002): claim → print → finish/fail with exponential backoff, retry, crash
  reclaim; receipts rebuilt from the stored bill (khata dues add a UPI QR, void bills are marked).
- Printer screen (paired devices, paper size, auto-print, test print with timing, queue with retry);
  bill screen auto-prints once and shows print status.
- Continuous camera scanner (VisionCamera 5 `CodeScanner`, EAN/UPC/Code-128): camera stays open, every new
  code goes straight into the cart with haptics. A scan gate turns ~30 reads/s of the same code into one scan
  (re-arms after 1.2 s out of view); GS1 check digits drop misreads before the DB lookup.
- ESLint (eslint-config-expo flat) added; fixed 5 findings (setState in effect bodies, ref write in render,
  missing display name). Tests: core 81, db 36, app 9.
