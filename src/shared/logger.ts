/**
 * Structured logging with redaction of sensitive data
 */

import { DebugLogEntry } from './types';
import { storage } from './storage';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private isDev: boolean = false;

  constructor() {
    // Check if running in development mode
    this.isDev =
      typeof (globalThis as any).chrome === 'undefined' &&
      typeof (globalThis as any).browser !== 'undefined';
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
      let s = value;
      s = s.replace(/https?:\/\/[^\s"']+/g, (url) => url.substring(0, 20) + '...');
      s = s.replace(/password[:\s=]+\S+/gi, 'password=***');
      s = s.replace(/sessionCookie[:\s=]+\S+/gi, 'sessionCookie=***');
      s = s.replace(/encryptedPassword[:\s=]+\S+/gi, 'encryptedPassword=***');
      s = s.replace(/authorization[:\s=]+\S+/gi, 'authorization=***');
      return s;
    }
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => {
          if (/password|session|cookie|token|encrypted|secret|auth/i.test(k)) {
            return [k, '***'];
          }
          return [k, this.redactValue(v)];
        })
      );
    }
    return value;
  }

  private redactSensitiveData(
    data: string | Record<string, unknown>
  ): string {
    if (typeof data === 'string') {
      return this.redactValue(data) as string;
    }
    return JSON.stringify(this.redactValue(data));
  }

  private async logToStorage(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const entry: DebugLogEntry = {
      timestamp: Date.now(),
      level,
      message,
      data: data ? (this.redactValue(data) as Record<string, unknown>) : undefined,
    };

    try {
      await storage.addDebugLog(entry);
    } catch (err) {
      console.error('Failed to log to storage:', err);
    }
  }

  private logToConsole(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const prefix = `[ArchiveBox] [${level}]`;
    const redacted = data
      ? this.redactSensitiveData(data)
      : '';

    if (level === 'ERROR') {
      console.error(prefix, message, redacted);
    } else if (level === 'WARN') {
      console.warn(prefix, message, redacted);
    } else if (this.isDev || level === 'INFO') {
      console.log(prefix, message, redacted);
    }
  }

  async debug(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logToConsole('DEBUG', message, data);
    await this.logToStorage('DEBUG', message, data);
  }

  async info(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logToConsole('INFO', message, data);
    await this.logToStorage('INFO', message, data);
  }

  async warn(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logToConsole('WARN', message, data);
    await this.logToStorage('WARN', message, data);
  }

  async error(message: string, data?: Record<string, unknown>): Promise<void> {
    this.logToConsole('ERROR', message, data);
    await this.logToStorage('ERROR', message, data);
  }
}

export const logger = new Logger();
