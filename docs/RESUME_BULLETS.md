# Resume bullets — Dukaan

Pick 3–4. Every number is measured (see docs/perf/REPORT.md and docs/CHANGELOG.md).

- Built **Dukaan**, an offline-first GST billing, inventory and credit-ledger app for Indian grocery stores, in **React Native (Expo SDK 58, New Architecture)** with an encrypted on-device database (op-sqlite + SQLCipher).
- Designed and built a **local-first sync engine**: op log, hybrid logical clocks, and per-entity merge rules (PN-counter stock, field-level LWW, append-only bills). It converged in **500/500 randomized 3-device partition simulations** and in a live 3-phone run (86 ops, 41 bills, gap-free invoice numbers).
- Made catalogue search over **100,000 SKUs** run at **16.67 ms p95** on a 2 GB Android emulator, using FTS5 trigram indexing plus a Hindi/English/Hinglish phonetic key. The target was 50 ms.
- Wrote **Nitro native modules** in Kotlin and Swift: a Bluetooth ESC/POS printer with chunked writes and Skia-rasterised Devanagari receipts, and a USB HID barcode-scanner catcher.
- Built the **Spring Boot 4 / Java 21** sync service: gap-free per-shop sequencing under row locks, Postgres hash×month partitioning, a transactional outbox to **Kafka** feeding read-model projections, revocable device JWTs, and a read-only owner web dashboard. Tested with **Testcontainers**.
- Added encrypted backups (scrypt + AES-256-GCM, restored by op-log replay), role enforcement on both device and server with an audit log, OpenTelemetry metrics, and a DPDP-compliant privacy policy and Play listing.
