/**
 * Unit tests for ArchiveBox client
 */

jest.mock('../archivebox/auth', () => ({
  authManager: {
    ensureAuthenticated: jest.fn(),
    getApiToken: jest.fn(),
    refreshSessionFromStoredCredential: jest.fn(),
    markInvalidCredentials: jest.fn(),
  },
}));

jest.mock('../shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { ArchiveBoxClient } from '../archivebox/client';
import { authManager } from '../archivebox/auth';
import { AuthError, NetworkError } from '../shared/types';

describe('ArchiveBoxClient', () => {
  let client: ArchiveBoxClient;

  beforeEach(() => {
    client = new ArchiveBoxClient();
    jest.clearAllMocks();
  });

  test('should normalize URLs correctly', () => {
    const testCases = [
      {
        input: 'HTTPS://EXAMPLE.COM/path',
        expected: 'https://example.com/path',
      },
      {
        input: 'https://example.com/path#fragment',
        expected: 'https://example.com/path',
      },
      {
        input: '  https://example.com  ',
        expected: 'https://example.com/',
      },
    ];

    testCases.forEach(({ input, expected }) => {
      // Use private method through bracket access for testing
      const result = client['normalizeUrl'](input);
      expect(result).toBe(expected);
    });
  });

  test('should dedupe URLs', () => {
    const urls = [
      'https://example.com',
      'https://example.com', // duplicate
      'https://example.org',
      'https://example.org', // duplicate
      'https://example.net',
    ];

    const result = client['dedupeUrls'](urls);

    expect(result).toHaveLength(3);
    expect(result).toContain('https://example.com');
    expect(result).toContain('https://example.org');
    expect(result).toContain('https://example.net');
    expect(result[0]).toBe('https://example.com'); // Order preserved
  });

  test('should handle mixed normalization and deduping', () => {
    const urls = [
      'HTTPS://EXAMPLE.COM',
      'https://example.com#frag', // duplicate but different case + fragment
      'https://example.org',
    ];

    // This tests that normalization + deduping work together
    const normalized = urls.map((url) => client['normalizeUrl'](url));
    const deduped = client['dedupeUrls'](normalized);

    expect(deduped).toHaveLength(2);
  });

  test('should refresh session once and retry submit on 401', async () => {
    (authManager.ensureAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (authManager.getApiToken as jest.Mock)
      .mockResolvedValueOnce('old-token')
      .mockResolvedValueOnce('new-token');
    (authManager.refreshSessionFromStoredCredential as jest.Mock).mockResolvedValue(
      undefined
    );

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        ok: true,
        json: async () => ({ success: true, errors: [] }),
      });

    Object.assign(globalThis, { fetch: fetchMock });

    const result = await client.submitUrls('https://archive.example.com', [
      'https://example.com/article',
    ]);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authManager.refreshSessionFromStoredCredential).toHaveBeenCalledTimes(1);
  });

  test('should mark invalid credentials when retry is still unauthorized', async () => {
    (authManager.ensureAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (authManager.getApiToken as jest.Mock)
      .mockResolvedValueOnce('old-token')
      .mockResolvedValueOnce('new-token');
    (authManager.refreshSessionFromStoredCredential as jest.Mock).mockResolvedValue(
      undefined
    );

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
      })
      .mockResolvedValueOnce({
        status: 403,
        statusText: 'Forbidden',
        ok: false,
      });

    Object.assign(globalThis, { fetch: fetchMock });

    await expect(
      client.submitUrls('https://archive.example.com', ['https://example.com/article'])
    ).rejects.toBeInstanceOf(AuthError);

    expect(authManager.refreshSessionFromStoredCredential).toHaveBeenCalledTimes(1);
    expect(authManager.markInvalidCredentials).toHaveBeenCalledTimes(1);
  });

  test('should preserve network errors when one-time session refresh fails', async () => {
    (authManager.ensureAuthenticated as jest.Mock).mockResolvedValue(undefined);
    (authManager.getApiToken as jest.Mock).mockResolvedValue('old-token');
    (authManager.refreshSessionFromStoredCredential as jest.Mock).mockRejectedValue(
      new NetworkError('ArchiveBox unreachable')
    );

    const fetchMock = jest.fn().mockResolvedValue({
      status: 401,
      statusText: 'Unauthorized',
      ok: false,
    });
    Object.assign(globalThis, { fetch: fetchMock });

    await expect(
      client.submitUrls('https://archive.example.com', ['https://example.com/article'])
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
