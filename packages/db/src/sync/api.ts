import { HttpTransport, type HttpTransportOptions } from './http-transport';

export type ShopInfo = { id: string; name: string; gstin: string; stateCode: string };
export type DeviceInfo = { id: string; name: string; prefix: string };
export type VerifyResult = { token: string; shopId: string; role: 'owner' };
export type ClaimResult = { token: string; shopId: string; shopName: string; gstin: string; stateCode: string; role: 'cashier' };
export type Pairing = { token: string; expiresInSec: number };

/**
 * The account endpoints around sync (services/sync AuthController, PairingController, MeController).
 * The shop is created on the device first and works offline forever; these calls only attach it to the
 * cloud (owner, via phone OTP) or join another phone to it (cashier, via a single-use pairing code).
 */
export class SyncApi {
  readonly http: HttpTransport;

  constructor(opts: HttpTransportOptions) {
    this.http = new HttpTransport(opts);
  }

  requestOtp(phone: string): Promise<{ sent: boolean; devOtp?: string }> {
    return this.http.request('POST', '/v1/auth/otp/request', { phone }, false);
  }

  verifyOtp(phone: string, otp: string, shop: ShopInfo, device: DeviceInfo): Promise<VerifyResult> {
    return this.http.request('POST', '/v1/auth/otp/verify', { phone, otp, shop, device }, false);
  }

  /** Owner only: a short-lived code the cashier phone types (or scans) to join. */
  createPairing(): Promise<Pairing> {
    return this.http.request('POST', '/v1/pairing/token');
  }

  claimPairing(token: string, device: DeviceInfo): Promise<ClaimResult> {
    return this.http.request('POST', '/v1/pairing/claim', { token: token.trim(), device }, false);
  }

  setPushToken(token: string): Promise<void> {
    return this.http.request('PUT', '/v1/me/fcm', { token });
  }
}
