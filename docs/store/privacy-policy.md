# Dukaan privacy policy

_Last updated: 19 November 2026. Draft for review before publishing; replace the bracketed contact details._

This policy explains what the Dukaan app and the optional Dukaan cloud sync service do with personal data.
It is written for the Digital Personal Data Protection Act, 2023 (DPDP Act) and the DPDP Rules, 2025.

## Who is who

- **You (the shop owner)** decide what goes into the app: items, customers, bills, khata. For your customers' data,
  you are the Data Fiduciary.
- **Dukaan** stores and syncs that data for you only when you turn on cloud sync. For that data we act as your
  processor. For your own login phone number we are the Data Fiduciary.
- **Your customers** (people whose names and numbers you add to the khata) are Data Principals. Their rights are
  exercised through you, and we will help you answer them.

## Without cloud sync (the default)

Everything stays on the phone, in a database encrypted with a key held in the phone's secure keystore. Nothing is
sent to us. Crash reporting is off. The app has no ads and no analytics SDKs.

## With cloud sync turned on

| Data | Why | Where |
|---|---|---|
| Owner's mobile number | One-time password login; linking phones to the shop | Server database |
| Shop name, GSTIN, state | Bill numbering and the owner dashboard | Server database |
| Phone name, role, last sync time | Showing your phones and blocking removed ones | Server database |
| The changes you make (items, prices, bills, payments, stock, khata entries, customer names and numbers) | Copying them to your other phones, and building the dashboard | Server database, encrypted in transit (TLS) |
| A hash of the OTP | Checking the code you type | Cache, deleted after 5 minutes |

We do not sell data, show ads, or share data with anyone except:

- the SMS provider that delivers the OTP (it receives the phone number and the code), and
- if the build has crash reporting on, the crash service (Sentry). Crash reports carry the app version and the
  error. Item names, customer names, phone numbers and amounts are stripped before sending.

## Your rights (DPDP Act, sections 11–14)

- **Access and correction.** Every record is visible and editable in the app.
- **Erasure.** Turn off cloud sync and ask for deletion by writing to [privacy contact]. We delete the shop's
  server data within 30 days and confirm in writing. Data on your phones stays until you uninstall the app or
  clear its storage. Bills you are required to keep under the CGST Act, which is generally 72 months from the
  due date of the annual return, are your responsibility to keep, for example with an encrypted backup.
- **Customer requests.** If a khata customer asks you to delete their details, you can edit the customer in the
  app once nothing is owed. The change syncs to the server copy.
- **Grievances.** Contact [Grievance Officer name, email, address]. We reply within 7 days and resolve
  within 30. If you are not satisfied, you can complain to the Data Protection Board of India.
- **Nominee.** You can name a person to exercise these rights if you die or are incapacitated, by writing to the
  contact above.

## Security

- On the phone: SQLCipher database encryption, PIN or biometric lock, and lock-out after repeated wrong PINs.
- Backups: AES-256-GCM with a key from your passphrase (scrypt). We never see the passphrase.
- In transit: TLS.
- On the server: per-device tokens that can be revoked, and per-device rate limits. Each shop's data is kept
  separate by shop ID on every query.

If a breach affects your data, we will tell you and the Data Protection Board as the DPDP Rules require.

## Children

Dukaan is a business tool and is not meant for anyone under 18.

## Changes

We will show a notice in the app before any change to this policy takes effect.
