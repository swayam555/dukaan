# Dukaan — Build plan

Versions verified 2026-11-18 (npm registry): Expo SDK 58 (`expo@58.0.26`), React Native 0.88,
React 19.3, op-sqlite 19, FlashList 2.3, Nitro Modules 0.37, VisionCamera 5.2, Skia 2.14,
Expo Router 58, Zustand 5.1, fast-check 4.10. Backend: Java 21, Spring Boot (latest stable at build
time), PostgreSQL 17, Redis 8, Kafka (KRaft), MinIO, Nginx 1.30.

GST slabs verified 2026-11-18: GST 2.0 (effective 22 Sep 2025) → **0 / 5 / 18 / 40 %**, plus special
rates (3 % gold, 0.25 % rough diamonds). 12 % and 28 % kept only as legacy rates for old purchase
bills. Slabs are data, not code.

## Environment constraints (honest)

- Dev box: 7 GB RAM, Docker VM 3.8 GB, one x86_64 Android 15 emulator image, no physical phone.
- "Target-class phone" numbers come from an emulator AVD capped to 2 GB RAM / 4 cores, release
  build. They are labelled as such in `docs/perf/REPORT.md`; nothing is quoted as a physical-device
  number.
- Running two emulators + the full backend stack at once may not fit in RAM. The Maestro
  convergence flow is written for two emulators; if both can't run alongside Docker, the backend
  runs alone and the second "device" is the Node headless client (same `packages/db` engine).
- iOS code (Swift BLE) is written and type-checked against Nitro's generated specs but can't be
  built on Linux. Stated in README.

## Phases (each ends: runnable, tested, committed, CHANGELOG updated)

1. **Foundation** — pnpm workspace, `packages/core` (money, HLC, UUIDv7), `packages/db`
   (migration runner + `SqlDriver` + Node driver), Expo app shell with op-sqlite (SQLCipher + FTS5),
   design system, PIN lock, Docker Compose (Postgres, Redis, Kafka KRaft, MinIO, Nginx), Spring Boot
   skeleton with OTP auth, GitHub Actions.
2. **Catalogue at scale** — seeder, transliteration map + phonetic key, FTS5 trigram search with
   ranking, Node benchmark on 100k rows, streamed resumable CSV import, FlashList catalogue with
   keyset pagination. Gate: search p95 < 50 ms.
3. **Billing** — GST engine (paise, CGST/SGST vs IGST by place of supply, line/bill discounts,
   rounding) with fast-check properties, billing screen (search, scan, keypad, loose weight),
   hold/park, split payments, UPI QR, PDF invoice + WhatsApp share.
4. **Native modules** — Nitro Bluetooth ESC/POS printer (Kotlin + Swift), Skia raster for Hindi,
   print queue with retry; Nitro HID scanner event emitter; VisionCamera continuous scan.
5. **Sync engine** — op log, HLC, PN-Counter / LWW apply, push/pull client, sync-service endpoints,
   Postgres partitions, outbox → Kafka, projector, notifier, snapshot builder, 3-device
   property-based partition simulation.
6. **Inventory, khata, reports** — purchases, adjustments, low stock + expiry, ledger with reminders
   and statement PDF, Skia charts, GSTR-1-style export.
7. **Hardening** — roles + audit log, encrypted backups, QR pairing, Maestro E2E, k6 load test,
   Sentry, diagnostics screen, perf report.
8. **Publish-readiness** — icons, store listing, DPDP privacy policy, permission rationale, EAS
   config, demo video script, owner web dashboard, README + interview notes + resume bullets.
