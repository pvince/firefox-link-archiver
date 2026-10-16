/**
 * ArchiveBox HTTP client for URL submission
 */

import { authManager } from './auth';
import { logger } from '../shared/logger';
import {
  AuthError,
  NetworkError,
  ServerError,
  ClientError,
} from '../shared/types';

export class ArchiveBoxClient {
  private async submitRequest(
    submitUrl: string,
    payload: Record<string, unknown>,
    apiToken: string
  ): Promise<Response> {
    return fetch(submitUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      credentials: 'omit',
    });
  }

  /**
   * Submit URLs to ArchiveBox via the REST API
   */
  async submitUrls(
    archiveBoxUrl: string,
    urls: string[],
    tags?: string[]
  ): Promise<{ success: boolean }> {
    if (!urls || urls.length === 0) {
      return { success: true };
    }

    // Normalize and dedupe URLs
    const normalizedUrls = this.dedupeUrls(
      urls.map((url) => this.normalizeUrl(url))
    );

    const payload: Record<string, unknown> = {
      urls: normalizedUrls,
      depth: 0,
      parser: 'auto',
    };
    if (tags && tags.length > 0) {
      payload.tag = tags.join(',');
    }

    const submitUrl = `${archiveBoxUrl}/api/v1/cli/add`;

    try {
      await logger.info('Submitting URLs to ArchiveBox', {
        urlCount: normalizedUrls.length,
        tags: tags,
      });

      await authManager.ensureAuthenticated();
      let apiToken = await authManager.getApiToken();

      let response = await this.submitRequest(submitUrl, payload, apiToken);

      if (response.status === 401 || response.status === 403) {
        await logger.warn('ArchiveBox rejected session, attempting one-time refresh');
        await authManager.refreshSessionFromStoredCredential(
          `ArchiveBox rejected session with status ${response.status}`
        );
        apiToken = await authManager.getApiToken();
        response = await this.submitRequest(submitUrl, payload, apiToken);
      }

      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        await logger.warn('Authentication failed, session may have expired');
        await authManager.markInvalidCredentials(
          `ArchiveBox rejected authentication after retry (${response.status})`
        );
        throw new AuthError('Authentication failed. Open settings and save valid credentials.');
      }

      // Handle server errors
      if (response.status >= 500 && response.status < 600) {
        throw new ServerError(
          `ArchiveBox server error: ${response.status} ${response.statusText}`
        );
      }

      // Handle client errors (except auth)
      if (response.status >= 400 && response.status < 500) {
        throw new ClientError(
          `Client error: ${response.status} ${response.statusText}`
        );
      }

      // Success (200-399)
      if (!response.ok) {
        throw new Error(`Unexpected status: ${response.status}`);
      }

      const result = (await response.json()) as { success?: boolean; errors?: string[] };
      if (result.success === false) {
        throw new ServerError(
          `ArchiveBox rejected submission: ${(result.errors || []).join('; ') || 'unknown error'}`
        );
      }

      await logger.info('URLs submitted successfully', {
        urlCount: normalizedUrls.length,
      });

      return { success: true };
    } catch (err) {
      if (
        err instanceof AuthError ||
        err instanceof NetworkError ||
        err instanceof ServerError ||
        err instanceof ClientError
      ) {
        throw err;
      }

      if (err instanceof TypeError) {
        throw new NetworkError(`Network error: ${err.message}`);
      }

      throw new ServerError(`Submission failed: ${err}`);
    }
  }

  /**
   * Normalize URL: lowercase, trim, remove fragment
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove fragment
      urlObj.hash = '';
      return urlObj.toString().toLowerCase();
    } catch (err) {
      // If URL is invalid, return original trimmed
      return url.trim().toLowerCase();
    }
  }

  /**
   * Remove duplicate URLs, maintain order
   */
  private dedupeUrls(urls: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const url of urls) {
      if (!seen.has(url)) {
        seen.add(url);
        result.push(url);
      }
    }

    return result;
  }
}

export const archiveBoxClient = new ArchiveBoxClient();
