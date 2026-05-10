/**
 * Shared types for the ArchiveBox Auto-Sync extension
 */

export interface Config {
  archiveBoxUrl: string;
  username: string;
  sessionCookie?: string;
  lastLogin?: number;
  batchInterval: number; // milliseconds, default 10000
}

export interface QueueItem {
  id: string;
  urls: string[];
  tags?: string[];
  createdAt: number;
  retries: number;
  nextRetryAt: number;
  lastError?: string;
}

export interface SyncState {
  lastHistorySync: number;
  lastBookmarksSync: number;
}

export interface DebugLogEntry {
  timestamp: number;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  data?: Record<string, unknown>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerError';
  }
}

export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

export class DeadLetterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeadLetterError';
  }
}
