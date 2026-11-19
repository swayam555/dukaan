# Progress (handover file — read first after a restart)

Ports: nginx 4780 (TLS 4743), sync-service 4781, postgres 4732, redis 4779, kafka 4792, s3 (RustFS) 4790/4791, prometheus 4709, grafana 4730.
Compose project: dukaan. AVD: dukaan_lowram (2 GB / 4 cores, android-35 x86_64).
Machine: 7 GB RAM shared with other sessions (Arth, Fixr, Kaarkhana). Run Gradle/Maven/Docker one at a time;
jest with `-w 2`. A jest run and the first Gradle build were OOM-killed on 2026-11-18.

## Status
- [x] Phase 0 plan
- [ ] Phase 1 Foundation — code done (core, db migrations, app shell w/ SQLCipher, setup/lock/tabs, i18n,
      sync-service auth + Flyway, compose, nginx, CI). PENDING VERIFY: Android debug build (x86_64),
      `./mvnw verify` (Testcontainers), `docker compose up`.
- [ ] Phase 2 Catalogue — translit, search repo (narrow bm25 / broad popularity regimes, bounded typo fallback),
      100k seeder, host bench (p95 ~6-7 ms file-backed), resumable CSV import, FlashList catalogue, Diagnostics
      (on-device seed + search bench) DONE. PENDING: on-device bench on dukaan_lowram (needs the APK).
- [x] Phase 3 Billing — GST engine, op log core, saveBill/void/hold, billing screen (search + HID enter + cart +
      held bills), line keypad, payments (split/change/UPI QR/khata), invoice PDF share, settings, seeder CLI.
      App component tests: `cd apps/mobile && npx jest -w 2` (getDb mocked with real better-sqlite3; RNTL 14 =
      async render/fireEvent). Phase 3 camera scan screen is a placeholder until Phase 4.
- [ ] Phase 4 Hardware — DONE in code: `packages/native` Nitro module (printer + HID, Kotlin; Swift BLE printer
      untested), print queue (`print_job.next_at`, backoff 2s→60s, 5 attempts, stale `printing` reclaimed after
      60 s), receipt from stored bill, Skia raster for Devanagari lines, Printer screen (pair/paper/auto/test/
      queue+retry), auto-print on bill, HID wired into billing, VisionCamera continuous scan screen (scan gate +
      GTIN check). Tests: core 81, db 36, app 9; eslint clean
      (`pnpm --filter mobile lint`; `expo lint` itself wrongly rejects eslint 9.39). PENDING: rebuild APK,
      install on dukaan_lowram, on-device search bench, camera scan on device, real printer smoke test.
- [x] Phase 1/2/4 device + backend verification done (on-device p95 16.67 ms; mvnw verify; compose up healthy).
- [x] Phase 5 Sync — engine + sim, Spring service (OTP, pairing, push/pull/ack, bill numbers, partitions,
      outbox→Kafka, projector, notifier), app connect/join/sync loop. Live e2e:
      `docker compose up -d --wait nginx && pnpm --filter @dukaan/db e2e:sync` (all green 2026-11-19).
      Deferred: snapshot endpoint, real FCM sender.
- [x] Phase 2 leftover: CSV import screen (`app/import.tsx`, `lib/csv-import.ts`, test/import.test.tsx).
- Next: Phase 6 inventory/khata/reports; 7 hardening (Maestro, k6, OTel,
  perf REPORT/BACKEND); 8 deliverables (README, INTERVIEW_NOTES, RESUME_BULLETS, EAS).
- Gotcha: nginx.conf is a single-file bind mount — after editing use `docker compose up -d --force-recreate nginx`.
- Background builds die when the Claude session restarts: launch Gradle with `setsid nohup … &`.

## Build commands
- Android: `cd apps/mobile/android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 -Dorg.gradle.jvmargs="-Xmx1536m" --max-workers=3`
- Backend tests: `cd services/sync && ./mvnw -B verify`

## Phase 6 — DONE (760b307, 2026-11-19)
Khata + customer ledger, stock/purchases, reports + GSTR-1 export. Next: Phase 7.

## Phase 7 — DONE in code (2026-11-19, commits 1fabeb9..8143ee8)
Audit log, encrypted backup/restore, diagnostics sync counters + KDF bench + 500-item seed, OTel (backend), Sentry
(opt-in, scrubbed), k6 script, Maestro flows.
PENDING RUNS (need free RAM/Docker):
- k6: `docker compose up -d --wait nginx` then
  `docker run --rm --network host -v "$PWD/tools/k6:/k6" grafana/k6 run /k6/sync.js` → write docs/perf/BACKEND.md
  (measured numbers only), `docker compose down`.
- Maestro: install (`curl -fsSL https://get.maestro.mobile.dev | bash`), boot dukaan_lowram, install the APK,
  `maestro test apps/mobile/.maestro`.
- Device: KDF time (Diagnostics → KDF), cold start, bill-save latency, memory → docs/perf/REPORT.md.
Phase 8 done — see below.

## Phase 8 — DONE in code (2026-11-19, 630f376 + docs commit)
- Owner web dashboard: `/dashboard/`, an OTP login that gives a read-only token.
- Icons and splash: `tools/icons.py`.
- Permission rationale and eas.json.
- Docs: `docs/store/*`, DEMO_SCRIPT, README, INTERVIEW_NOTES, RESUME_BULLETS.

ALL PHASES DONE IN CODE. Remaining work is *runs*, blocked on RAM and Docker held by other sessions:
1. `cd services/sync && ./mvnw -B verify`. This includes the new DashboardTest, which has never run.
2. Dashboard smoke test:
   - `docker compose up -d --build --wait nginx && docker compose up -d --force-recreate nginx`
   - Open http://localhost:4780/dashboard/ and check the OTP login and summary.
   - The phone must have connected cloud sync first.
3. k6, then write docs/perf/BACKEND.md. Commands are under Phase 7.
4. Maestro flows (see Phase 7).
5. Release APK on dukaan_lowram:
   - Measure cold start, bill-save latency, memory and KDF time, and write them to docs/perf/REPORT.md.
   - Then update the "Not measured yet" list in README.md and RESUME_BULLETS.md.
6. Gap: in-app "delete cloud data" (DPDP erasure). It is a manual request today.
