/**
 * Lightweight encryption wrapper for local credential obfuscation.
 *
 * This is intentionally low-friction: a key is derived from extension runtime id
 * and an installation salt persisted in extension storage. It reduces casual
 * disclosure in storage dumps, but it is not equivalent to OS keychain-backed
 * secret storage.
 */

const KEY_DERIVE_ITERATIONS = 120000;
const IV_LENGTH = 12;

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export class EncryptionManager {
  private key: CryptoKey | null = null;

  async initialize(seed: string, salt: string): Promise<void> {
    const enc = new TextEncoder();
    const seedBytes = enc.encode(seed);
    const saltBytes = enc.encode(salt);

    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      seedBytes,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.key = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations: KEY_DERIVE_ITERATIONS,
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = this.ensureKey();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const payload = new TextEncoder().encode(plaintext);

    const cipher = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      payload
    );

    const cipherBytes = new Uint8Array(cipher);
    const packed = new Uint8Array(iv.length + cipherBytes.length);
    packed.set(iv, 0);
    packed.set(cipherBytes, iv.length);
    return bytesToBase64(packed);
  }

  async decrypt(encodedCiphertext: string): Promise<string> {
    const key = this.ensureKey();
    const packed = base64ToBytes(encodedCiphertext);

    if (packed.length <= IV_LENGTH) {
      throw new Error('Malformed encrypted payload');
    }

    const iv = packed.slice(0, IV_LENGTH);
    const cipherBytes = packed.slice(IV_LENGTH);

    const plaintextBuffer = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      cipherBytes
    );

    return new TextDecoder().decode(plaintextBuffer);
  }

  private ensureKey(): CryptoKey {
    if (!this.key) {
      throw new Error('EncryptionManager not initialized');
    }
    return this.key;
  }
}

export const encryptionManager = new EncryptionManager();
