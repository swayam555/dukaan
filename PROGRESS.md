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
- Next: verify APK + on-device bench, mvnw verify, compose up; then Phase 4 (Nitro printer/HID, VisionCamera).
- Background builds die when the Claude session restarts: launch Gradle with `setsid nohup … &`.

## Build commands
- Android: `cd apps/mobile/android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 -Dorg.gradle.jvmargs="-Xmx1536m" --max-workers=3`
- Backend tests: `cd services/sync && ./mvnw -B verify`
