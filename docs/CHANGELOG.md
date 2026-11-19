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
