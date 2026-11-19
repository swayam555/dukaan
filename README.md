# Dukaan — offline-first GST billing, stock and khata for kirana shops

A React Native POS that does all its work on the phone and syncs between 2–5 phones when there's internet.
There is no AI in it. The hard parts are a local-first sync engine, 1-lakh-SKU search on a cheap phone, native
Bluetooth printing and correct GST.

| | |
|---|---|
| App | Expo SDK 58 / React Native 0.88 (New Architecture), Expo Router, Zustand, op-sqlite + **SQLCipher** + FTS5 |
| Native | One Nitro module: Bluetooth ESC/POS printer (Kotlin SPP, Swift BLE) and a USB/HID barcode-wedge catcher; VisionCamera scanning; Skia raster for Hindi receipts |
| Sync | Op log + hybrid logical clocks. LWW per field for master data, PN-counter for stock, append-only bills and ledger. Server-assigned gap-free bill numbers per FY. |
| Backend | Spring Boot 4 (Java 21), PostgreSQL 17 (ops partitioned by shop hash × month), Redis 8, Kafka 4 (outbox → projector → read models), nginx, Prometheus/Grafana, OpenTelemetry |
| Web | Read-only owner dashboard at `/dashboard/` (OTP login, no third-party scripts) |

## What it does

- **Billing:**
  - Search in Hindi, English or Hinglish, with typo tolerance. Barcode scanning by camera or USB scanner, and a weight keypad for loose items.
  - Line and bill discounts. CGST/SGST or IGST by place of supply, with round-off.
  - Split payments (cash, UPI QR, card, khata) and park/resume of bills.
  - PDF bill shared on WhatsApp, or a Bluetooth print with Hindi item names.
- **Khata:** credit sales post to the customer ledger. Payments and opening balances, WhatsApp reminders and a PDF statement.
- **Stock:** purchases, adjustments with reasons, low-stock and expiry lists.
- **Reports:** sales, profit, GST, top items, payment split and a GSTR-1-style CSV.
- **Multi-phone:**
  - Pair a cashier with a QR code. Each phone has its own bill series and works offline all day.
  - Cashier limits are enforced on both device and server.
  - Owner audit log.
- **Safety:**
  - PIN or biometric lock, encrypted database.
  - Encrypted backup file (scrypt + AES-256-GCM), restored by op-log replay.
  - Diagnostics screen, opt-in Sentry with PII scrubbing.

## Measured numbers

All measured. Environment and method are in [`docs/perf/REPORT.md`](docs/perf/REPORT.md).

| What | Result | Where |
|---|---|---|
| Catalogue search, 100,000 SKUs, 250 queries | **p95 16.67 ms**, p50 5.32 ms (gate 50 ms) | 2 GB Android emulator, debug build, SQLCipher on |
| Seed 100k SKUs with FTS5 | 64.6 s, 67.1 MB encrypted DB | same |
| Live sync e2e, 3 phones, 86 ops, 41 bills | converged; bill numbers 1..41 gap-free; 2×3 sync round 295 ms / 240 ms | laptop, compose stack, localhost |
| 3-device partition simulation (random interleavings, drops, duplicates) | converges in 500 / 500 fast-check runs per CI run | Node |

**Not measured yet** (scripts are written, but the dev box's RAM and Docker were taken by another project's stack):
- k6 load test (`tools/k6/sync.js`)
- Maestro flows (`apps/mobile/.maestro`)
- release-build cold start, bill-save latency, memory, and backup-KDF time on device

The commands are listed in `PROGRESS.md`.

## Run it

Needs Node 24, pnpm 12, JDK 21, Docker, and an Android SDK with an emulator.

**Keys:** none are required, and there is no AI key because Dukaan has no AI. Two optional env files:

| File | Copy from | Variables |
|---|---|---|
| `.env` (repo root, read by compose) | `.env.example` | `JWT_SECRET` (change outside your laptop), `DEV_OTP` (`true` returns the OTP in the response) |
| `apps/mobile/.env` | `apps/mobile/.env.example` | `EXPO_PUBLIC_SYNC_URL` (default `http://localhost:4780`), `EXPO_PUBLIC_SENTRY_DSN` (optional) |

```bash
pnpm install
pnpm backend                       # compose: postgres, redis, kafka, minio, sync-service, nginx (:4780), grafana (:4730)
pnpm --filter @dukaan/mobile android    # dev client build; then `pnpm dev` for Metro
```

- **Cloud sync in the app:** Settings → Cloud sync. The dev server returns the OTP in the response.
- **Owner dashboard:** http://localhost:4780/dashboard/
- **Build profiles:** `apps/mobile/eas.json` has `development` (dev client APK), `preview` (internal APK) and
  `production` (AAB, Play internal track). Set `EXPO_PUBLIC_SYNC_URL`, and optionally `EXPO_PUBLIC_SENTRY_DSN`, as
  EAS environment variables.

### Tests

```bash
pnpm test                          # core + db (Node, real SQLite) + app (RNTL against real SQLite)
pnpm test:backend                  # Spring + Testcontainers (Postgres, Redis, Kafka)
pnpm --filter @dukaan/db e2e:sync  # 3 headless phones against the running compose stack
maestro test apps/mobile/.maestro  # device flows: setup → bill → khata
k6 run tools/k6/sync.js            # 50 shops × 2 phones
```

## Layout

```
apps/mobile         Expo app (screens in src/app, state in src/state, platform glue in src/lib)
packages/core       pure TS: money, GST, HLC, ops, merge rules, transliteration, ESC/POS encoder
packages/db         migrations, repositories, sync engine, backup — tested in Node against better-sqlite3
packages/native     Nitro module: BluetoothPrinter + HidScanner (Kotlin / Swift)
services/sync       Spring Boot sync-service, projector, notifier, owner dashboard (static)
infra/              nginx, prometheus
tools/              seeder, k6 script, icon generator
docs/               ARCHITECTURE, PLAN, CHANGELOG, perf/, store/, INTERVIEW_NOTES, RESUME_BULLETS, DEMO_SCRIPT
```

## Honest limits

- **iOS:** the Swift BLE printer is written against the Nitro specs but has never been built. The dev box is Linux.
- **No physical phone was used.** Camera scanning and Bluetooth printing are covered by unit tests and an emulator HID test, not by hardware.
- **Snapshot bootstrap and real FCM delivery are deferred.** A new phone pulls the whole op log, and phones poll instead of receiving a push.
- **Cloud-data deletion is by request**, not an in-app button yet (see `docs/store/permissions.md`).

Store and compliance drafts are in `docs/store/`: listing, DPDP privacy policy, permission rationale and data-safety answers.

## License

MIT. See [LICENSE](LICENSE).
