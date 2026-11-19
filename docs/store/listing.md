# Play Store listing — draft

**App name (30):** Dukaan: GST Billing & Khata
**Short description (80):** Fast GST billing, stock and udhaar khata for kirana shops. Works without internet.

## Full description

Dukaan is a billing counter for kirana and general stores that keeps working when the internet doesn't.

**Bill in seconds**
- Search 1 lakh items in Hindi or English. "chawal", "चावल" and "rice" all find basmati.
- Scan barcodes with the camera or a USB scanner, or type the weight for loose items.
- GST worked out per line (CGST + SGST, or IGST for another state), with line and bill discounts and round-off.
- Split payments: cash, UPI QR on screen, card, or khata.
- Print on a 58 mm or 80 mm Bluetooth printer, with Hindi item names, or share a PDF bill on WhatsApp.

**Udhaar khata**
- Every credit sale goes into the customer's khata automatically.
- Record payments, see the running balance, and send a polite reminder or a PDF statement.

**Stock**
- Purchases, damage and corrections, with low-stock and expiry alerts.

**Reports**
- Daily sales, profit, top items, GST summary and a GSTR-1-style CSV for your accountant.

**More than one counter**
- Add a cashier phone with a QR code. Phones sync with each other when online, and nothing is lost if one was offline all day.
- Cashiers cannot void bills, change prices or edit khata openings. Every such action is in the owner's audit log.
- Owner dashboard on the web, read-only.

**Your data stays yours**
- The shop database on the phone is encrypted. A PIN or fingerprint is needed to open the app.
- Cloud sync is optional, and the app is fully usable without an account.
- Encrypted backup file with your own passphrase.

## Assets checklist

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG | `apps/mobile/assets/images/icon.png` (1024, downscale) |
| Feature graphic | 1024×500 | to make from the icon + billing screenshot |
| Phone screenshots | 2–8, 1080×1920+ | take from the emulator: billing, pay, khata, reports, stock, pairing |
| Category | Business | |
| Content rating | Everyone (no user-generated public content) | |
| Contact email | shop-owner support address | to fill before submit |
| Privacy policy URL | host `docs/store/privacy-policy.md` | to host before submit |

## Release notes (v0.1.0)

First release: billing with GST, Bluetooth printing, barcode scanning, khata, stock, reports, multi-phone sync, encrypted backup.
