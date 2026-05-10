/**
 * URL blocklist helpers
 */

import { Config } from './types';

interface CompiledPatterns {
  patterns: RegExp[];
  invalidPatterns: string[];
}

export interface BlocklistFilterResult {
  allowedUrls: string[];
  blockedUrls: string[];
  invalidPatterns: string[];
}

export function normalizeUrlForMatching(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    return parsed.toString().toLowerCase();
  } catch (_err) {
    return url.trim().toLowerCase();
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildArchiveBoxBlockPattern(
  archiveBoxUrl: string
): string | null {
  const trimmed = archiveBoxUrl.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeUrlForMatching(trimmed);
  const base = normalized.replace(/\/+$/, '');

  if (!base) {
    return null;
  }

  const escapedBase = escapeRegex(base);
  return `^${escapedBase}(?:/.*)?$`;
}

export function getEffectiveBlocklistPatterns(config: Config): string[] {
  const userPatterns = (config.blocklistPatterns || [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  const archiveBoxPattern = buildArchiveBoxBlockPattern(config.archiveBoxUrl);

  if (archiveBoxPattern && !userPatterns.includes(archiveBoxPattern)) {
    return [...userPatterns, archiveBoxPattern];
  }

  return userPatterns;
}

function compilePatterns(patterns: string[]): CompiledPatterns {
  const compiled: RegExp[] = [];
  const invalidPatterns: string[] = [];

  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern));
    } catch (_err) {
      invalidPatterns.push(pattern);
    }
  }

  return { patterns: compiled, invalidPatterns };
}

export function filterUrlsByBlocklist(
  urls: string[],
  config: Config
): BlocklistFilterResult {
  if (urls.length === 0) {
    return {
      allowedUrls: [],
      blockedUrls: [],
      invalidPatterns: [],
    };
  }

  const effectivePatterns = getEffectiveBlocklistPatterns(config);

  if (effectivePatterns.length === 0) {
    return {
      allowedUrls: urls,
      blockedUrls: [],
      invalidPatterns: [],
    };
  }

  const compiled = compilePatterns(effectivePatterns);
  const allowedUrls: string[] = [];
  const blockedUrls: string[] = [];

  for (const url of urls) {
    const normalizedUrl = normalizeUrlForMatching(url);
    const isBlocked = compiled.patterns.some((pattern) =>
      pattern.test(normalizedUrl)
    );

    if (isBlocked) {
      blockedUrls.push(url);
    } else {
      allowedUrls.push(url);
    }
  }

  return {
    allowedUrls,
    blockedUrls,
    invalidPatterns: compiled.invalidPatterns,
  };
}
