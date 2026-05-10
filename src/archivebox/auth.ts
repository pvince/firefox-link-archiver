/**
 * Session-based authentication for ArchiveBox
 */

import { storage } from '../shared/storage';
import { logger } from '../shared/logger';
import { AuthError, NetworkError } from '../shared/types';

export class AuthManager {
  /**
   * Fetch the login page and extract the CSRF token via cookie
   * Django sets a csrftoken cookie on GET which matches the form field value
   */
  private async getCsrfToken(loginUrl: string, baseUrl: string): Promise<string> {
    const response = await fetch(loginUrl, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      throw new NetworkError(`Failed to load login page: ${response.status}`);
    }

    // Prefer reading the csrftoken cookie that Django sets on GET
    const cookies = await browser.cookies.getAll({ url: baseUrl, name: 'csrftoken' });
    if (cookies && cookies.length > 0) {
      return cookies[0].value;
    }

    // Fallback: parse the hidden input from the HTML
    const html = await response.text();
    const patterns = [
      /name="csrfmiddlewaretoken"\s+value="([^"]+)"/,
      /value="([^"]+)"\s+name="csrfmiddlewaretoken"/,
      /"csrfmiddlewaretoken"[^>]+value="([^"]+)"/,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) return match[1];
    }

    throw new AuthError('Could not find CSRF token on login page');
  }

  /**
   * Attempt to login with credentials and return session cookie
   */
  async login(
    url: string,
    username: string,
    password: string
  ): Promise<{ cookie: string }> {
    const loginUrl = `${url}/admin/login/`;

    try {
      // Step 1: GET the login page to obtain the CSRF token
      const csrfToken = await this.getCsrfToken(loginUrl, url);

      // Step 2: POST credentials with the CSRF token
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      formData.append('csrfmiddlewaretoken', csrfToken);
      formData.append('next', '/');

      const response = await fetch(loginUrl, {
        method: 'POST',
        body: formData.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': loginUrl,
        },
        credentials: 'include',
      });

      // Django redirects away from /admin/login/ on successful login.
      // If we're still on the login page, credentials were wrong.
      const finalUrl = response.url;
      const stillOnLogin = finalUrl.includes('/admin/login/');

      if (response.status === 403 || (response.ok && stillOnLogin)) {
        throw new AuthError('Invalid username or password');
      }

      if (!response.ok && response.status !== 302) {
        throw new AuthError(
          `Login failed with status ${response.status}: ${response.statusText}`
        );
      }

      // Read the sessionid cookie that the browser stored automatically
      // (set-cookie header is not directly accessible via fetch in extensions)
      const cookies = await browser.cookies.getAll({
        url,
        name: 'sessionid',
      });

      if (!cookies || cookies.length === 0) {
        throw new AuthError('Login appeared to succeed but no session cookie was set');
      }

      const sessionCookie = `sessionid=${cookies[0].value}`;

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
