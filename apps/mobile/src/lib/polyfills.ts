/**
 * Hermes has no WebCrypto. `@dukaan/core` ids (uuidv7) call `globalThis.crypto.getRandomValues`,
 * so back it with expo-crypto's CSPRNG before anything else runs. Imported first in the root layout.
 */
import * as Crypto from 'expo-crypto';

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== 'function') {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: Crypto.getRandomValues };
}
