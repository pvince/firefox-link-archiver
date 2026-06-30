/**
 * Unit tests for auth manager behavior.
 */

jest.mock('../shared/storage', () => ({
  storage: {
    getOrCreateEncryptionSalt: jest.fn(),
    getAuthHealth: jest.fn(),
    setAuthHealth: jest.fn(),
    setEncryptedCredential: jest.fn(),
    getEncryptedCredential: jest.fn(),
    clearEncryptedCredential: jest.fn(),
    getConfig: jest.fn(),
    setConfig: jest.fn(),
    clearAuthHealth: jest.fn(),
  },
}));

jest.mock('../shared/crypto', () => ({
  encryptionManager: {
    initialize: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  },
}));

jest.mock('../shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { AuthManager } from '../archivebox/auth';
import { AuthHealthStatus, NetworkError } from '../shared/types';
import { storage } from '../shared/storage';
import { encryptionManager } from '../shared/crypto';

describe('AuthManager', () => {
  let manager: AuthManager;

  beforeEach(() => {
    manager = new AuthManager();
    jest.clearAllMocks();

    (storage.getOrCreateEncryptionSalt as jest.Mock).mockResolvedValue('salt-1');
    (storage.getAuthHealth as jest.Mock).mockResolvedValue(null);
    (storage.getConfig as jest.Mock).mockResolvedValue({
      archiveBoxUrl: 'https://archive.example.com',
      username: 'alice',
      sessionCookie: undefined,
      lastLogin: 0,
      batchInterval: 10000,
      blocklistPatterns: [],
    });
    (storage.getEncryptedCredential as jest.Mock).mockResolvedValue({
      username: 'alice',
      encryptedPassword: 'ciphertext',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheme: 'aes-gcm-v1',
    });

    (encryptionManager.initialize as jest.Mock).mockResolvedValue(undefined);
    (encryptionManager.decrypt as jest.Mock).mockResolvedValue('pw123');

    (globalThis as any).browser = {
      cookies: {
        getAll: jest.fn(({ name }: { name: string }) => {
          if (name === 'csrftoken') {
            return Promise.resolve([{ value: 'csrf-token' }]);
          }
          return Promise.resolve([]);
        }),
      },
    };
  });

  test('classifies transient login endpoint failures as network errors', async () => {
    (globalThis as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html></html>',
        url: 'https://archive.example.com/admin/login/',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        url: 'https://archive.example.com/admin/login/',
      });

    await expect(
      manager.login('https://archive.example.com', 'alice', 'pw123')
    ).rejects.toBeInstanceOf(NetworkError);
  });

  test('does not downgrade transient re-login failures to invalid-credential state', async () => {
    (globalThis as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html></html>',
        url: 'https://archive.example.com/admin/login/',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        url: 'https://archive.example.com/admin/login/',
      });

    await expect(manager.ensureAuthenticated()).rejects.toBeInstanceOf(NetworkError);

    const statuses = (storage.setAuthHealth as jest.Mock).mock.calls.map(
      ([health]) => health.status
    );
    expect(statuses).toContain(AuthHealthStatus.SessionExpired);
    expect(statuses).not.toContain(AuthHealthStatus.InvalidCredentials);
  });

  test('logout clears encrypted credentials as well as session data', async () => {
    await manager.logout();

    expect(storage.clearEncryptedCredential).toHaveBeenCalledTimes(1);
    expect(storage.clearAuthHealth).toHaveBeenCalledTimes(1);
    expect(storage.setConfig).toHaveBeenCalledWith({
      sessionCookie: undefined,
      lastLogin: undefined,
    });
  });
});