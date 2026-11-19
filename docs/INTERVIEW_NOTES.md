# Interview notes — Dukaan

## 30-second pitch
An offline-first billing app for kirana shops: GST bills, stock and udhaar khata, built in React Native. The phone
is the system of record. Two to five phones in a shop work offline all day and converge when they reconnect,
through my own op-log sync engine and a Spring Boot relay. On a 2 GB emulator, search over 1 lakh SKUs has a
p95 of 16.67 ms.

## Decisions I'd defend

**Why an op log and not "sync the tables"?**
- Row-level last-write-wins loses data in a shop. Two counters each sell 1 soap, and LWW on `stock = 9` ends with 9 instead of 8.
- With ops, each entity gets the merge rule it needs:
  - stock is a PN-counter (deltas add up)
  - item fields are per-field LWW by HLC
  - bills and ledger entries are append-only (a void is a new op, not an edit)
- The same apply code runs on device and in the 3-device simulation, so the simulation tests the real thing.

**Why HLC instead of wall clocks?**
- Shop phones have wrong clocks. HLC keeps causality: an edit made after seeing another edit always sorts after it.
- It stays close to real time, so audit logs still read sensibly.
- Ties break on device ID, which makes the result deterministic.

**Bill numbers with offline phones.**
- GST needs unique, sequential invoice numbers per financial year.
- Offline, each phone uses its own series prefix (A-000001, B-000001), so numbers are unique without coordination.
- When the server receives a bill, it assigns a gap-free global number per FY under a per-shop row lock, and sends back a `bill.number` op.

**Search on a cheap phone.**
- FTS5 trigram index plus a phonetic key column. A transliteration map folds "chawal", "chaawal", "चावल" to the same key, and a synonym table maps rice ↔ chawal.
- Digits go to a barcode-prefix range scan. Everything else: FTS5 picks the best 200 candidates by bm25, then they're re-ranked by how often the item sells, so "maggi" shows the pack the shop actually sells first.
- Measured on device through the JSI bridge, not just in Node: p95 16.67 ms over 100k rows, with SQLCipher on.

**Native modules with Nitro.**
- ESC/POS over classic Bluetooth SPP. Writes go in 512 B chunks with 20 ms gaps, because cheap printers have 4 KB buffers and drop raster rows.
- Hindi receipts: printer fonts have no Devanagari, so each Hindi line is rasterised with Skia into a 1-bit bitmap.
- HID barcode scanners act as keyboards. The native side holds fast key bursts (≤ 50 ms between keys, at least 6 characters) and replays them as typing if they turn out not to be a scan.

**Server.**
- Push takes a per-shop row lock and gives a gap-free `server_seq`, so pull is a simple cursor.
- The `ops` table is hash-partitioned ×16 by shop, then range-partitioned by month.
- An outbox goes to Kafka (key = shop, which keeps per-shop order), feeding a projector that builds the read models for reports and the dashboard.
- The server is a relay plus a backup. Billing never waits on it.

**Security.**
- SQLCipher key in the Keystore. PIN hashed with PBKDF2-SHA256, with lock-out after repeated failures.
- Per-device JWTs that can be revoked. Owner-only op types (void, price change, khata opening) are rejected for cashiers on the device and again on the server; refused ops are quarantined and shown in the audit log.
- Dashboard tokens can only GET `/v1/dashboard/**`.
- Backups use scrypt + AES-256-GCM, with the plain header bound in as associated data.

## Bugs worth telling
- **Hermes has no `crypto.getRandomValues`.** UUIDv7 generation crashed shop setup on the device, while every Node test passed. Fixed with an expo-crypto polyfill. Lesson: run on the real runtime early.
- **Tomcat returned 400 for every proxied request.** nginx sent `Host: sync_api`, and an underscore is not a valid hostname. Fixed by forwarding the real Host.
- **Postgres jsonb `?` operator vs JDBC placeholders.** Rewritten as `payload->>'name' IS NOT NULL`.
- **Save button under the Android nav bar** on edge-to-edge screens. Fixed by padding stack screens for the bottom inset.

## What I'd do next
- Snapshot bootstrap, so a new phone doesn't replay the whole op log. Real FCM push instead of polling.
- Run the k6 test and the Maestro flows (both are written), then release-build perf numbers on a real ₹8k phone.
- An in-app "delete my cloud data" button (DPDP erasure). It is a manual request today.

## Likely questions
- **"What if two phones edit the same customer's phone number offline?"** Per-field LWW by HLC: the later edit wins, and the other field edits survive. Khata balances are never LWW: they are sums of append-only entries.
- **"What if a phone is offline for a month?"** It pushes up to 500 ops per request, in HLC order. The server assigns numbers and the phone pulls the rest. Ops are idempotent by op ID, so retries are safe.
- **"Why not WatermelonDB, PowerSync or ElectricSQL?"** I wanted merge rules per entity type (counters, append-only, LWW) and roles enforced on the ops. Owning the engine also meant I could property-test it end to end.
- **"Clock skew?"** HLC absorbs normal skew. A remote clock more than 24 h ahead is refused (`MAX_DRIFT_MS`), so one phone with a wrong date can't drag every clock in the shop into the future.
