/**
 * Structured logging with redaction of sensitive data
 */

import { DebugLogEntry } from './types';
import { storage } from './storage';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const REDACT_PATTERNS = [
  { pattern: /https?:\/\/[^\s]+/g, replacement: '[URL]' },
  { pattern: /password[:\s=]+[^\s,}]+/gi, replacement: 'password=***' },
  { pattern: /password[:\s=]+"[^"]+"/gi, replacement: 'password="***"' },
  { pattern: /sessionCookie[:\s=]+[^\s,}]+/gi, replacement: 'sessionCookie=***' },
  { pattern: /sessionCookie[:\s=]+"[^"]+"/gi, replacement: 'sessionCookie="***"' },
];

export class Logger {
  private isDev: boolean = false;

  constructor() {
    // Check if running in development mode
    this.isDev =
      typeof (globalThis as any).chrome === 'undefined' &&
      typeof (globalThis as any).browser !== 'undefined';
  }

  private redactSensitiveData(
    data: string | Record<string, unknown>
  ): string {
    let str = typeof data === 'string' ? data : JSON.stringify(data);

    for (const { pattern, replacement } of REDACT_PATTERNS) {
      str = str.replace(pattern, replacement);
    }

    // Redact first 20 chars of URLs
    str = str.replace(/\[URL\]/g, (match) => {
      const match2 = str.match(/https?:\/\/[^\s]+/);
      if (match2) {
        return match2[0].substring(0, 20) + '...';
      }
      return match;
    });

    return str;
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
      data: data ? JSON.parse(this.redactSensitiveData(data)) : undefined,
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
