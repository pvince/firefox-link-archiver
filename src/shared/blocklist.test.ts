import {
  buildArchiveBoxBlockPattern,
  filterUrlsByBlocklist,
  getEffectiveBlocklistPatterns,
} from '../shared/blocklist';
import { Config } from '../shared/types';

const baseConfig: Config = {
  archiveBoxUrl: '',
  username: '',
  batchInterval: 10000,
  blocklistPatterns: [],
};

describe('blocklist helpers', () => {
  test('should build ArchiveBox block pattern that matches the base URL and child paths', () => {
    const pattern = buildArchiveBoxBlockPattern('https://archive.example.com');

    expect(pattern).toBe('^https://archive\\.example\\.com(?:/.*)?$');

    const regex = new RegExp(pattern as string);
    expect(regex.test('https://archive.example.com/')).toBe(true);
    expect(regex.test('https://archive.example.com/add/')).toBe(true);
    expect(regex.test('https://other.example.com/')).toBe(false);
  });

  test('should include ArchiveBox URL as an effective default block pattern', () => {
    const config: Config = {
      ...baseConfig,
      archiveBoxUrl: 'https://archive.example.com',
      blocklistPatterns: [],
    };

    const patterns = getEffectiveBlocklistPatterns(config);

    expect(patterns).toContain('^https://archive\\.example\\.com(?:/.*)?$');
  });

  test('should filter blocked URLs and preserve allowed URLs', () => {
    const config: Config = {
      ...baseConfig,
      blocklistPatterns: ['^https://blocked\\.example\\.com'],
    };

    const result = filterUrlsByBlocklist(
      [
        'https://blocked.example.com/path',
        'https://allowed.example.com/path',
      ],
      config
    );

    expect(result.blockedUrls).toEqual(['https://blocked.example.com/path']);
    expect(result.allowedUrls).toEqual(['https://allowed.example.com/path']);
  });

  test('should ignore invalid regex patterns and continue filtering', () => {
    const config: Config = {
      ...baseConfig,
      blocklistPatterns: ['[invalid-regex', '^https://blocked\\.example\\.com'],
    };

    const result = filterUrlsByBlocklist(
      [
        'https://blocked.example.com/path',
        'https://allowed.example.com/path',
      ],
      config
    );

    expect(result.invalidPatterns).toEqual(['[invalid-regex']);
    expect(result.blockedUrls).toEqual(['https://blocked.example.com/path']);
    expect(result.allowedUrls).toEqual(['https://allowed.example.com/path']);
  });
});
