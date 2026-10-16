/**
 * API-token authentication for ArchiveBox (REST API v1)
 */

import { storage } from '../shared/storage';
import { logger } from '../shared/logger';
import {
  AuthError,
  NetworkError,
  AuthHealth,
  AuthHealthStatus,
  EncryptedCredential,
} from '../shared/types';
import { encryptionManager } from '../shared/crypto';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface LoginOptions {
  persistCredential?: boolean;
  persistSession?: boolean;
}

export class AuthManager {
  private cryptoInitialized = false;

  private async initializeCrypto(): Promise<void> {
    if (this.cryptoInitialized) {
      return;
    }

    const salt = await storage.getOrCreateEncryptionSalt();
    const seed = browser.runtime?.id || 'archivebox-autosync';
    await encryptionManager.initialize(seed, salt);
    this.cryptoInitialized = true;
  }

  private async updateAuthHealth(
    status: AuthHealthStatus,
    {
      lastError,
      requiresUserAction,
      recoveryAction,
      retryCount,
    }: {
      lastError?: string;
      requiresUserAction: boolean;
      recoveryAction: 'none' | 'save-credentials' | 'refresh-session';
      retryCount?: number;
    }
  ): Promise<void> {
    const current = await storage.getAuthHealth();
    const health: AuthHealth = {
      status,
      updatedAt: Date.now(),
      retryCount: retryCount ?? current?.retryCount ?? 0,
      requiresUserAction,
      recoveryAction,
      lastError,
    };

    await storage.setAuthHealth(health);
  }

  private async incrementAuthRetry(
    status: AuthHealthStatus,
    lastError: string,
    recoveryAction: 'none' | 'save-credentials' | 'refresh-session'
  ): Promise<void> {
    const current = await storage.getAuthHealth();
    await this.updateAuthHealth(status, {
      lastError,
      requiresUserAction: status !== AuthHealthStatus.SessionValid,
      recoveryAction,
      retryCount: (current?.retryCount || 0) + 1,
    });
  }

  private async storeEncryptedCredential(
    username: string,
    password: string
  ): Promise<void> {
    if (!password) {
      return;
    }

    await this.initializeCrypto();
    const encryptedPassword = await encryptionManager.encrypt(password);
    const now = Date.now();
    const credential: EncryptedCredential = {
      username,
      encryptedPassword,
      createdAt: now,
      updatedAt: now,
      scheme: 'aes-gcm-v1',
    };

    await storage.setEncryptedCredential(credential);
    await this.updateAuthHealth(AuthHealthStatus.CredentialsStored, {
      requiresUserAction: false,
      recoveryAction: 'none',
    });
  }

  private async loadStoredPassword(username: string): Promise<string | null> {
    const credential = await storage.getEncryptedCredential();
    if (!credential) {
      return null;
    }

    if (credential.username !== username) {
      return null;
    }

    await this.initializeCrypto();
    return encryptionManager.decrypt(credential.encryptedPassword);
  }

  /**
   * Exchange username/password for an API token via the ArchiveBox REST API
   */
  async login(
    url: string,
    username: string,
    password: string,
    options: LoginOptions = {}
  ): Promise<{ token: string }> {
    const tokenUrl = `${url}/api/v1/auth/get_api_token`;

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'omit',
      });

      if (response.status === 401 || response.status === 403) {
        throw new AuthError('Invalid username or password');
      }

      if (response.status === 404) {
        throw new NetworkError(
          'ArchiveBox REST API not found. This extension requires ArchiveBox 0.8 or newer.'
        );
      }

      if (!response.ok) {
        throw new NetworkError(
          `Login request failed with status ${response.status}: ${response.statusText}`
        );
      }

      const data = (await response.json()) as { success?: boolean; token?: string };
      if (!data.success || !data.token) {
        throw new AuthError('Invalid username or password');
      }

      const apiToken = data.token;

      await logger.info('Login successful', { url, username });

      if (options.persistCredential !== false && password) {
        await this.storeEncryptedCredential(username, password);
      }

      if (options.persistSession !== false) {
        await storage.setConfig({
          archiveBoxUrl: url,
          username,
          apiToken,
          lastLogin: Date.now(),
        });
        await this.updateAuthHealth(AuthHealthStatus.SessionValid, {
          requiresUserAction: false,
          recoveryAction: 'none',
          retryCount: 0,
        });
      }

      return { token: apiToken };
    } catch (err) {
      if (
        err instanceof AuthError ||
        err instanceof NetworkError
      ) {
        throw err;
      }

      if (err instanceof TypeError) {
        throw new NetworkError(`Network error during login: ${err.message}`);
      }

      throw new NetworkError(`Login failed: ${String(err)}`);
    }
  }

  /**
   * Test credentials without persisting session
   */
  async testCredentials(
    url: string,
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.login(url, username, password, {
        persistCredential: false,
        persistSession: false,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logger.warn('Credential test failed', { url, username, error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Check if session is still valid
   */
  async isSessionValid(): Promise<boolean> {
    try {
      const config = await storage.getConfig();
      if (!config.apiToken) {
        return false;
      }

      // Check if session is older than 24 hours
      const now = Date.now();
      const lastLogin = config.lastLogin || 0;
      const ageMs = now - lastLogin;
      return ageMs < SESSION_MAX_AGE_MS;
    } catch (err) {
      await logger.error('Failed to check session validity', { error: err });
      return false;
    }
  }

  /**
   * Ensure authenticated, re-logging in if needed
   */
  async ensureAuthenticated(): Promise<void> {
    const config = await storage.getConfig();
    if (!config.archiveBoxUrl || !config.username) {
      await this.updateAuthHealth(AuthHealthStatus.NoCredentials, {
        requiresUserAction: true,
        recoveryAction: 'save-credentials',
        lastError: 'ArchiveBox configuration is incomplete',
      });
      throw new AuthError('ArchiveBox configuration missing');
    }

    const isValid = await this.isSessionValid();
    if (isValid) {
      await this.updateAuthHealth(AuthHealthStatus.SessionValid, {
        requiresUserAction: false,
        recoveryAction: 'none',
      });
      return;
    }

    await this.incrementAuthRetry(
      AuthHealthStatus.SessionExpired,
      'Session expired or missing',
      'refresh-session'
    );

    await logger.info('Session expired or missing, re-logging in');

    let storedPassword: string | null;
    try {
      storedPassword = await this.loadStoredPassword(config.username);
    } catch {
      await this.incrementAuthRetry(
        AuthHealthStatus.InvalidCredentials,
        'Stored credentials could not be decrypted',
        'save-credentials'
      );
      throw new AuthError('Stored credentials are unreadable. Please save credentials again.');
    }

    if (!storedPassword) {
      await this.updateAuthHealth(AuthHealthStatus.NoCredentials, {
        requiresUserAction: true,
        recoveryAction: 'save-credentials',
        lastError: 'No stored credentials available for automatic re-login',
      });
      throw new AuthError('Session expired and no stored credentials were found. Open settings and save credentials.');
    }

    // Re-login to get fresh session
    try {
      await this.login(config.archiveBoxUrl, config.username, storedPassword, {
        persistCredential: false,
        persistSession: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof AuthError) {
        await this.incrementAuthRetry(
          AuthHealthStatus.InvalidCredentials,
          message,
          'save-credentials'
        );
        throw err;
      }

      if (err instanceof NetworkError) {
        await this.incrementAuthRetry(
          AuthHealthStatus.SessionExpired,
          message,
          'refresh-session'
        );
        throw err;
      }

      await this.incrementAuthRetry(
        AuthHealthStatus.SessionExpired,
        message,
        'refresh-session'
      );
      throw new NetworkError(`Login failed: ${message}`);
    }

    await logger.info('Re-login successful, session refreshed');
  }

  async invalidateSession(reason: string): Promise<void> {
    await storage.setConfig({
      apiToken: undefined,
      lastLogin: undefined,
    });
    await this.incrementAuthRetry(
      AuthHealthStatus.SessionExpired,
      reason,
      'refresh-session'
    );
  }

  async markInvalidCredentials(reason: string): Promise<void> {
    await this.incrementAuthRetry(
      AuthHealthStatus.InvalidCredentials,
      reason,
      'save-credentials'
    );
  }

  async refreshSessionFromStoredCredential(reason: string): Promise<void> {
    await this.invalidateSession(reason);
    await this.ensureAuthenticated();
  }

  async getApiToken(): Promise<string> {
    await this.ensureAuthenticated();
    const config = await storage.getConfig();
    return config.apiToken || '';
  }

  /**
   * Clear session (logout)
   */
  async logout(): Promise<void> {
    await storage.setConfig({
      apiToken: undefined,
      lastLogin: undefined,
    });
    await storage.clearEncryptedCredential();
    await storage.clearAuthHealth();
    await logger.info('Logged out');
  }
}

export const authManager = new AuthManager();
