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
- Import screen (owner only, More → Import items): pick a CSV (copied into app storage), live progress with rows/s,
  Stop, and resume after Stop or an app kill; header errors are rejected before anything is written. The importer
  now honours Stop after every committed batch, not only between 256 KB reads (added 2026-11-19).

## Phase 3 — Billing (2026-11-19)
- GST engine (CGST/SGST vs IGST, cess, line + bill discounts, round-off) with fast-check property tests.
- Op log: `OpWriter`, exactly-once `applyOp`, per-field LWW, PN-counter stock; bill save / void / hold.
- Billing screen: debounced search, HID scanner capture (digits + Enter → barcode lookup), cart, parked bills
  with resume (current cart auto-parked), loose items forced through the weight keypad before checkout.
- Payment screen: cash/UPI/card/khata split, change calculator, UPI QR (`upi://pay`), new-customer khata.
- A4 tax invoice / bill of supply HTML → PDF share; owner-editable shop profile; seeder CLI (SQLite and/or CSV).
- Tests: core 58, db 30, app component tests 7 (RNTL 14 + jest-expo against real SQLite via better-sqlite3).

## Phase 4 — Hardware (2026-11-19; emulator-verified, camera/printer need hardware)
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
- Device run on `dukaan_lowram` (2 GB emulator): 100k-SKU search **p95 16.67 ms** (p50 5.32, 250 queries) and seed
  64.6 s. See docs/perf/REPORT.md. Setup → search → cash bill → HID wedge scan all pass on device.
- Fixed two device-only bugs: Hermes lacks `crypto.getRandomValues` (uuidv7 ids), so setup failed; now polyfilled via
  expo-crypto. Bottom buttons on stack screens sat under the Android nav bar; `Screen` now pads the bottom inset
  (tab screens opt out with `inTabs`).

## Phase 5 — Sync (2026-11-19)
- Device engine: push (≤ 500 ops, HLC order) → pull pages applied in one transaction with the cursor → ack;
  single-flight, backoff 2 s·2ⁿ with jitter; HLC receive on every pulled op. `item.bulk` for catalogue imports.
- 3-device simulation (in-memory server, random interleavings, drops and duplicates) converges every run.
- Spring service: OTP login that registers a device-created shop, single-use pairing codes (Redis), JWT device
  auth, push with a per-shop row lock and gap-free `server_seq`, server-assigned gap-free bill numbers per FY
  (`bill.number` ops), owner-only op types rejected for cashiers, `ops` hash-partitioned ×16 then monthly by range
  (job creates next month), outbox → Kafka relay (`shop.ops`, 12 partitions, key = shop), projector read
  models (daily sales, item sales, stock, khata), notifier. Testcontainers `SyncFlowTest` 7/7.
- App: `HttpTransport` + `SyncApi`, Settings → Cloud sync (OTP connect, sync status, add a counter phone),
  Join-a-shop at setup, background sync loop; JWT in SecureStore.
- nginx now forwards `Host` (Tomcat answered every proxied request with 400 because of the `sync_api` upstream name).
- Live e2e against the compose stack: 3 phones, 86 ops, 41 bills — converged, numbers 1..41 gap-free, read models
  match; two runs: whole script 1.9 s / 1.1 s, 2×3 sync round 295 ms / 240 ms (laptop, localhost).
- Tests: db 49, app 11 (OTP connect, pairing join + push, against a fetch fake backed by the reference server).
- Deferred: snapshot bootstrap, real FCM delivery.


## Phase 6 — Khata, inventory, reports (2026-11-19)
- Khata list (to-collect total, due/all filter, search, add customer) and customer ledger: payments (cash/UPI/card), opening balance (owner), WhatsApp reminder with UPI link, PDF statement via expo-print.
- Stock (owner): low-stock and expiring-batch views, reasoned adjustments, purchases with suppliers, batches, cost update and GST totals, purchase history.
- Reports: date presets, sales/bills/avg/profit (owner)/tax/voids, Skia daily bar chart, payment-mode split, top items, GSTR-1 CSV export (B2B, B2CL, B2CS, HSN, docs) via share sheet.
- Tests: app 8 suites / 23 tests green; db 14 suites / 58 tests green.

## Phase 7 — Hardening (2026-11-19)
- Audit log (owner): voids, discounts, ledger changes, stock and price edits, imports, and ops refused from other
  phones, with synced / not synced / rejected / refused status and filters. It is a read-only view over the op log.
- Encrypted backup/restore: the op log plus boot meta, scrypt (N=2^14) → AES-256-GCM. The header is plain but bound
  as AAD. Restore replays ops onto a fresh install and keeps the bill series and sync cursor. A wrong passphrase or
  an edited header is refused before anything is written.
- Diagnostics: sync counters (log size, pending, rejected, quarantined, server position), an on-device KDF timing
  button, and a 500-item demo seed.
- Observability: Spring OpenTelemetry starter (10 % trace sampling, OTLP export off by default, no OTLP metrics).
  The app has opt-in Sentry (only when `EXPO_PUBLIC_SENTRY_DSN` is set): no PII, no screenshots, breadcrumbs reduced
  to navigation without messages.
- Load test `tools/k6/sync.js` (50 shops × owner + cashier, push/pull 40 req/s each, thresholds p95 push < 250 ms,
  pull < 150 ms). **Not run yet.**
- Maestro flows `apps/mobile/.maestro` (setup + demo seed, cash bill with change, khata sale + part payment).
  **Not run yet.**
- Tests: db 64, app 12 suites / 29 tests; tsc and lint clean; backend compiles.
- Not run in Phase 7: the k6 test and the Maestro flows. While this phase was built, Docker and about 6.5 GB of the
  7 GB RAM were held by another project's stack, so neither the compose stack nor the emulator could start.


## Phase 8 — Publish-readiness (2026-11-19)
- Owner web dashboard at `/dashboard/`:
  - OTP login → a 12 h token that can only GET `/v1/dashboard/**`.
  - Summary: sales, bills, voids, GST, gross profit, khata dues, a daily chart, top items, biggest dues, phones, and projector lag ("catching up").
  - Plain HTML/CSS/JS with no third-party scripts, behind a strict CSP in nginx.
  - Projected bill lines now keep item names.
  - `DashboardTest` (Testcontainers) is written, **not run yet**: Docker is held by another stack.
  - Plan change: a static page served by sync-service instead of a React + Vite app. It is one read-only page, and this needs no build step and no second origin.
- App icon, adaptive icon (with monochrome) and splash (light and dark), drawn from code (`tools/icons.py`). They replace the Expo defaults.
- Permission rationale:
  - The scan screen explains the camera before the system dialog and offers **Open settings** after a refusal (new test).
  - The Bluetooth request carries a rationale.
- `eas.json`: development (dev-client APK), preview (APK), production (AAB, Play internal draft).
- Docs:
  - `docs/store/`: listing, DPDP privacy policy, permissions + data-safety answers.
  - `docs/DEMO_SCRIPT.md`, `README.md`, `docs/INTERVIEW_NOTES.md`, `docs/RESUME_BULLETS.md`.
  - `docs/ARCHITECTURE.md` now describes the static dashboard.
- Tests: core 83, db 16 suites / 64, app 13 suites / 30, all green; tsc clean; backend `test-compile` OK.
- Still pending (see PROGRESS.md):
  - k6, Maestro, `mvn verify` incl. DashboardTest
  - release-build device numbers → `docs/perf/BACKEND.md` and REPORT.md
  - in-app cloud-data deletion

