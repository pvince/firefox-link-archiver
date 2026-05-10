/**
 * Unit tests for ArchiveBox client
 */

import { ArchiveBoxClient } from '../archivebox/client';

describe('ArchiveBoxClient', () => {
  let client: ArchiveBoxClient;

  beforeEach(() => {
    client = new ArchiveBoxClient();
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
      // Use private method via type casting for testing
      const result = (client as any).normalizeUrl(input);
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

    const result = (client as any).dedupeUrls(urls);

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
    const normalized = urls.map((u) => (client as any).normalizeUrl(u));
    const deduped = (client as any).dedupeUrls(normalized);

    expect(deduped).toHaveLength(2);
  });
});
