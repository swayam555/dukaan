# Permissions and Play data-safety answers

## Runtime permissions

| Permission | Asked when | What the user sees first | If refused |
|---|---|---|---|
| `CAMERA` | The owner taps **Allow camera** on the scan screen. Never asked at startup. | Scan screen: "Dukaan uses the camera only on this screen, to read product barcodes into the bill. No photos or video are saved or sent anywhere." | Billing by search or USB scanner still works. After a refusal the screen shows **Open settings**. Tested in `apps/mobile/test/scan-permission.test.tsx`. |
| `BLUETOOTH_CONNECT` (Android 12+) | First connect or print from the Printer screen | Android dialog. If refused once, the rationale "needed only to talk to the Bluetooth printer you pair…" appears on the next try. | Bills still save. The print job stays queued, and the error says to allow "Nearby devices". |
| `BLUETOOTH_SCAN` | Declared only for listing paired printers. The app reads the bonded list and does not scan for location. | — | — |
| `USE_BIOMETRIC` | Owner turns on fingerprint unlock in Settings | Uses the system biometric prompt | PIN unlock |

**Blocked in the manifest:** `RECORD_AUDIO` and `ACCESS_FINE_LOCATION`. Some libraries pull these in, and the app
never needs them. The `blockedPermissions` setting is in `app.json`.

iOS strings (`NSCameraUsageDescription`, `NSBluetoothAlwaysUsageDescription`, `NSFaceIDUsageDescription`) are in
`app.json` and say the same things.

## Data safety form

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects, **only if cloud sync is turned on**. Not shared with third parties for their own use. |
| Data types | Personal info: phone number (owner login), name and phone number (khata customers, entered by the shop). Financial info: purchase history (bills). App info: crash logs (only if the build has a Sentry DSN). |
| Purpose | App functionality and account management. Crash logs are for diagnostics only. |
| Encrypted in transit | Yes |
| Can users ask for deletion? | Yes, by email (see privacy policy). **Gap:** no in-app "delete cloud data" button yet. Play requires a deletion URL, so we will host a web page that explains the request flow. |
| Optional? | Yes. The app works fully offline without an account. |
