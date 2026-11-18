/**
 * Axios API client
 * Replaces the original src/core/api-client.js
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { ApiClientConfig, ApiError } from '@/types';
import {
  BUILD_DATE_HEADER_KEYS,
  CPA_BUILD_DATE_HEADER_KEYS,
  CPA_SUPPORT_PLUGIN_HEADER_KEYS,
  CPA_VERSION_HEADER_KEYS,
  REQUEST_TIMEOUT_MS,
  VERSION_HEADER_KEYS,
} from '@/utils/constants';
import { computeApiUrl } from '@/utils/connection';
import { parseApiErrorResponse } from './apiError';

interface ScopedConfig extends AxiosRequestConfig {
  revision?: number;
  authenticated?: boolean;
}

class ApiClient {
  private instance: AxiosInstance;
  private apiBase: string = '';
  private managementKey: string = '';
  private portalToken: string = '';
  private connectionRevision = 0;

  constructor(private readonly emitEvents: () => boolean = () => true) {
    this.instance = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Set API configuration
   */
  setConfig(config: ApiClientConfig): void {
    const apiBase = computeApiUrl(config.apiBase);
    this.connectionRevision += 1;
    this.apiBase = apiBase;
    this.managementKey = config.managementKey;
    this.portalToken = config.portalToken || '';

    if (config.timeout) {
      this.instance.defaults.timeout = config.timeout;
    } else {
      this.instance.defaults.timeout = REQUEST_TIMEOUT_MS;
    }
  }

  /** Guards read/modify/write operations across connection changes, including ABA switches. */
  getConnectionRevision(): number {
    return this.connectionRevision;
  }

  /** Pin credentials and suppress response side effects after the owning connection changes. */
  captureConnection(): ApiClient {
    const revision = this.connectionRevision;
    const client = new ApiClient(() => this.connectionRevision === revision);
    client.apiBase = this.apiBase;
    client.managementKey = this.managementKey;
    client.portalToken = this.portalToken;
    return client;
  }

  private readHeader(headers: Record<string, unknown> | undefined, keys: string[]): string | null {
    if (!headers) return null;

    const normalizeValue = (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (Array.isArray(value)) {
        const first = value.find(
          (entry) => entry !== undefined && entry !== null && String(entry).trim()
        );
        return first !== undefined ? String(first) : null;
      }
      const text = String(value);
      return text ? text : null;
    };

    const headerGetter = (headers as { get?: (name: string) => unknown }).get;
    if (typeof headerGetter === 'function') {
      for (const key of keys) {
        const match = normalizeValue(headerGetter.call(headers, key));
        if (match) return match;
      }
    }

    const entries =
      typeof (headers as { entries?: () => Iterable<[string, unknown]> }).entries === 'function'
        ? Array.from((headers as { entries: () => Iterable<[string, unknown]> }).entries())
        : Object.entries(headers);

    const normalized = Object.fromEntries(
      entries.map(([key, value]) => [String(key).toLowerCase(), value])
    );
    for (const key of keys) {
      const match = normalizeValue(normalized[key.toLowerCase()]);
      if (match) return match;
    }
    return null;
  }

  private readBooleanHeader(
    headers: Record<string, unknown> | undefined,
    keys: string[]
  ): boolean | null {
    const value = this.readHeader(headers, keys);
    if (value === null) return null;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
  }

  /**
   * Set request/response interceptors
   */
  private setupInterceptors(): void {
    // Response interceptor
    this.instance.interceptors.response.use(
      (response) => {
        const headers = response.headers as Record<string, string | undefined>;
        const cpaVersion = this.readHeader(headers, CPA_VERSION_HEADER_KEYS);
        const cpaBuildDate = this.readHeader(headers, CPA_BUILD_DATE_HEADER_KEYS);
        const version = cpaVersion || this.readHeader(headers, VERSION_HEADER_KEYS);
        const buildDate = cpaBuildDate || this.readHeader(headers, BUILD_DATE_HEADER_KEYS);
        const supportsPlugin = this.readBooleanHeader(headers, CPA_SUPPORT_PLUGIN_HEADER_KEYS);

        // Dispatch version updates for store consumers
        if (this.isCurrent(response.config) && (version || buildDate)) {
          window.dispatchEvent(
            new CustomEvent('server-version-update', {
              detail: { version: version || null, buildDate: buildDate || null },
            })
          );
        }
        if (this.isCurrent(response.config) && supportsPlugin !== null) {
          window.dispatchEvent(
            new CustomEvent('server-plugin-support-update', {
              detail: { supportsPlugin },
            })
          );
        }

        return response;
      },
      (error) => Promise.reject(this.handleError(error))
    );
  }

  private isCurrent(config: AxiosRequestConfig): boolean {
    return this.emitEvents() && (config as ScopedConfig).revision === this.connectionRevision;
  }

  private scoped(config?: AxiosRequestConfig, url = '', method = 'GET'): ScopedConfig {
    if (
      this.portalToken &&
      !(
        (method === 'GET' && (url === '/portal/session' || url === '/portal/status')) ||
        (method === 'POST' && url === '/portal/logout')
      )
    ) {
      throw new Error('Viewer request denied');
    }
    const headers = { ...config?.headers } as Record<string, string>;
    // The credential and connection are frozen at invocation, not in an async interceptor.
    if (this.managementKey) headers.Authorization = `Bearer ${this.managementKey}`;
    if (this.portalToken) headers['X-Portal-Session'] = this.portalToken;
    return {
      ...config,
      headers,
      baseURL: this.apiBase,
      revision: this.connectionRevision,
      authenticated: url !== '/portal/login',
    };
  }

  /**
   * Error handling
   */
  private handleError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const responseData: unknown = error.response?.data;
      const parsedError = parseApiErrorResponse(responseData, error.message);
      const apiError = new Error(parsedError.message) as ApiError;
      apiError.name = 'ApiError';
      apiError.status = error.response?.status;
      apiError.code = error.code;
      apiError.apiCode = parsedError.apiCode;
      apiError.details = responseData;
      apiError.data = responseData;

      // Dispatch logout for unauthorized responses
      if (
        error.config &&
        this.isCurrent(error.config) &&
        (error.config as ScopedConfig).authenticated &&
        error.response?.status === 401
      ) {
        window.dispatchEvent(new Event('unauthorized'));
      }

      return apiError;
    }

    const fallbackMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error occurred';
    const fallback = new Error(fallbackMessage) as ApiError;
    fallback.name = 'ApiError';
    return fallback;
  }

  /**
   * GET request
   */
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.get<T>(url, this.scoped(config, url, 'GET'));
    return response.data;
  }

  /**
   * POST request
   */
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.post<T>(url, data, this.scoped(config, url, 'POST'));
    return response.data;
  }

  /**
   * PUT request
   */
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.put<T>(url, data, this.scoped(config, url, 'PUT'));
    return response.data;
  }

  /**
   * PATCH request
   */
  async patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.patch<T>(url, data, this.scoped(config, url, 'PATCH'));
    return response.data;
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.delete<T>(url, this.scoped(config, url, 'DELETE'));
    return response.data;
  }

  /**
   * Get the raw response (for downloads, etc.)
   */
  async getRaw(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.instance.get(url, this.scoped(config, url, 'GET'));
  }

  /**
   * Send FormData
   */
  async postForm<T = unknown>(
    url: string,
    formData: FormData,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.instance.post<T>(
      url,
      formData,
      this.scoped(
        {
          ...config,
          headers: {
            ...(config?.headers || {}),
            'Content-Type': 'multipart/form-data',
          },
        },
        url,
        'POST'
      )
    );
    return response.data;
  }
}

// Export singleton
export const apiClient = new ApiClient();
