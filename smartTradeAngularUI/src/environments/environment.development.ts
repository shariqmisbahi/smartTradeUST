// Development environment config for Angular app

export const environment = {
  /** Disable production optimizations for easier debugging */
  production: false,

  /**
   * Base URL for your backend API in DEV.
   * If you run the API locally, keep localhost.
   * If you want to point DEV at your deployed API, switch to the prod URL.
   */
  // Local backend during development:
  API_BASE: 'http://localhost:5294/api',
  // Or, to test against the deployed backend in dev, use:
  // API_BASE: 'https://smart-trade.ustsea.com/api/',

  /** Optional app metadata */

  appName: 'SmartTrade (Dev)',
  build: {
    version: 'DEV',
    gitSha: 'LOCAL',
    builtAt: new Date().toISOString(),
  },

  /** Network defaults (optional) */
  http: {
    timeoutMs: 30000,
    retryCount: 0,
  },
} as const;

/**
 * Helper to safely join the API base with a path.
 * Usage: this.http.get(apiUrl('items'))
 */
export function apiUrl(path: string): string {
  const base = environment.API_BASE.endsWith('/')
    ? environment.API_BASE.slice(0, -1)
    : environment.API_BASE;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}
