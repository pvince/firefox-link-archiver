/**
 * Session-based authentication for ArchiveBox
 */

import { storage } from '../shared/storage';
import { logger } from '../shared/logger';
import { AuthError, NetworkError } from '../shared/types';

export class AuthManager {
  /**
   * Attempt to login with credentials and return session cookie
   */
  async login(
    url: string,
    username: string,
    password: string
  ): Promise<{ cookie: string }> {
    const loginUrl = `${url}/admin/login/`;

    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('csrfmiddlewaretoken', ''); // CSRF exempt in v0.7.3

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        body: formData.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        credentials: 'include', // Include cookies in request
      });

      if (response.status === 401 || response.status === 403) {
        throw new AuthError('Invalid username or password');
      }

      if (!response.ok) {
        throw new AuthError(
          `Login failed with status ${response.status}: ${response.statusText}`
        );
      }

      // Extract session cookie from response headers
      const setCookieHeader = response.headers.get('set-cookie');
      if (!setCookieHeader) {
        throw new AuthError('No session cookie received from server');
      }

      // Parse sessionid from Set-Cookie header
      // Format: sessionid=abc123; Path=/; HttpOnly; SameSite=Lax
      const sessionMatch = setCookieHeader.match(/sessionid=([^;]+)/);
      if (!sessionMatch || !sessionMatch[1]) {
        throw new AuthError('Failed to extract session cookie');
      }

      const sessionCookie = `sessionid=${sessionMatch[1]}`;

      await logger.info('Login successful', {
        url,
        username,
        cookieLength: sessionCookie.length,
      });

      return { cookie: sessionCookie };
    } catch (err) {
      if (err instanceof AuthError) {
        throw err;
      }
      if (err instanceof TypeError) {
        throw new NetworkError(`Network error during login: ${err.message}`);
      }
      throw new AuthError(`Login failed: ${err}`);
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
      await this.login(url, username, password);
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
      if (!config.sessionCookie) {
        return false;
      }

      // Check if session is older than 24 hours
      const now = Date.now();
      const lastLogin = config.lastLogin || 0;
      const ageMs = now - lastLogin;
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

      return ageMs < maxAgeMs;
    } catch (err) {
      await logger.error('Failed to check session validity', { error: err });
      return false;
    }
  }

  /**
   * Ensure authenticated, re-logging in if needed
   */
  async ensureAuthenticated(): Promise<void> {
    const isValid = await this.isSessionValid();
    if (isValid) {
      return;
    }

    const config = await storage.getConfig();
    if (!config.archiveBoxUrl || !config.username) {
      throw new AuthError('ArchiveBox configuration missing');
    }

    await logger.info('Session expired or missing, re-logging in');

    // Re-login to get fresh session
    const { cookie } = await this.login(
      config.archiveBoxUrl,
      config.username,
      '' // Password should be stored separately or retrieved from user
    );

    // Update config with new session cookie
    await storage.setConfig({
      sessionCookie: cookie,
      lastLogin: Date.now(),
    });

    await logger.info('Re-login successful, session refreshed');
  }

  /**
   * Get session cookie for requests
   */
  async getSessionCookie(): Promise<string> {
    await this.ensureAuthenticated();
    const config = await storage.getConfig();
    return config.sessionCookie || '';
  }

  /**
   * Clear session (logout)
   */
  async logout(): Promise<void> {
    await storage.setConfig({
      sessionCookie: undefined,
      lastLogin: undefined,
    });
    await logger.info('Logged out');
  }
}

export const authManager = new AuthManager();
