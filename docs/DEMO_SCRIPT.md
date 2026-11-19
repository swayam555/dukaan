# Demo video script (about 3 minutes)

Record on the `dukaan_lowram` emulator (2 GB) with a second emulator or the Node headless client as the cashier.
Show the backend from `docker compose up -d`. Screen-record with `adb shell screenrecord`, and keep the status bar
visible so the airplane-mode toggle shows on screen.

| # | Time | Screen | Do | Say |
|---|---|---|---|---|
| 1 | 0:00 | Setup | Type "Sharma Kirana", set PIN 2468 | "A kirana billing app that never waits for the internet. Setup takes ten seconds and there's no login." |
| 2 | 0:12 | Diagnostics | Seed 100k items, then run the search benchmark | "A real shop has thousands of SKUs. This is 1 lakh items on a 2 GB phone. Search p95 is under 17 ms." |
| 3 | 0:30 | Billing | Type "chawal", then "चावल", then "rice". Add basmati. Scan or type 1.25 kg of loose sugar. | "Hindi, English, Hinglish, typos: same results. Loose items go through a weight keypad." |
| 4 | 0:50 | Pay | Split: ₹200 cash + rest UPI QR. Save. Bill number shows. | "GST per line, CGST and SGST split, round-off. The bill saves locally in milliseconds." |
| 5 | 1:05 | Printer (if hardware) / PDF share | Print a Hindi receipt, or share the PDF | "Hindi names are rasterised with Skia, because cheap printers have no Devanagari font." |
| 6 | 1:20 | Airplane mode ON | Make 3 bills on the owner phone and 3 on the cashier | "Both counters keep working offline. Each has its own bill series, so numbers can't clash." |
| 7 | 1:40 | Airplane mode OFF | Pull to sync on both. Show Reports totals matching. | "They converge: same totals, same khata, same stock. Stock is a counter CRDT, so concurrent sales add up instead of overwriting." |
| 8 | 2:00 | Cashier tries to void | Void button missing. Show the owner's audit log with the refused op. | "Roles are enforced on the device and again on the server." |
| 9 | 2:15 | Khata | Credit sale to Ramesh, send the WhatsApp reminder, record ₹100 | "Udhaar is the heart of a kirana shop. Every credit sale lands here automatically." |
| 10 | 2:30 | Browser `/dashboard/` | OTP login, then the 7-day view | "The owner can check the shop from home. The page is read-only and shows how far behind the phones it is." |
| 11 | 2:45 | Backup | Make an encrypted backup, show the file header | "Lose the phone, keep the shop: AES-GCM backup with the owner's passphrase, restored by replaying the op log." |
| 12 | 2:55 | — | End card: repo link, stack | "React Native, op-sqlite with SQLCipher, own sync engine, Spring Boot, Kafka." |

**Don't** show the dev OTP banner in the final cut: blur it, or point the stack at a profile without `devOtp`.
