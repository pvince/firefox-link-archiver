/**
 * Shared types for the ArchiveBox Auto-Sync extension
 */

export enum AuthHealthStatus {
  NoCredentials = 'no-credentials',
  CredentialsStored = 'credentials-stored',
  SessionValid = 'session-valid',
  SessionExpired = 'session-expired',
  InvalidCredentials = 'invalid-credentials',
}

export type AuthRecoveryAction =
  | 'none'
  | 'save-credentials'
  | 'refresh-session';

export interface AuthHealth {
  status: AuthHealthStatus;
  updatedAt: number;
  retryCount: number;
  requiresUserAction: boolean;
  recoveryAction: AuthRecoveryAction;
  lastError?: string;
}

export interface EncryptedCredential {
  username: string;
  encryptedPassword: string;
  createdAt: number;
  updatedAt: number;
  scheme: 'aes-gcm-v1';
}

export enum QueueItemStatus {
  Pending = 'pending',
  AuthBlocked = 'auth-blocked',
  AwaitingRetry = 'awaiting-retry',
  Submitted = 'submitted',
  Failed = 'failed',
}

export interface Config {
  archiveBoxUrl: string;
  username: string;
  apiToken?: string;
  lastLogin?: number;
  hasEncryptedCredential?: boolean;
  authHealth?: AuthHealth;
  batchInterval: number; // milliseconds, default 10000
  blocklistPatterns: string[];
}

export interface QueueItem {
  id: string;
  urls: string[];
  tags?: string[];
  createdAt: number;
  retries: number;
  nextRetryAt: number;
  status?: QueueItemStatus;
  authBlockedAt?: number;
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
