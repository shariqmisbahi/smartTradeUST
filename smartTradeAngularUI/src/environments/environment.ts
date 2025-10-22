// src/environments/environment.ts
// Prod/default environment config for Angular app

export const environment = {
  /** Toggle Angular production mode optimizations */
  production: true,

  /** Base URL for your backend API */
  API_BASE: '/api/',

  /** Optional app metadata (safe to keep) */
  appName: 'SmartTrade',
  build: {
    // You can have your CI replace these at build-time if you like
    version: '1.0.0',
    gitSha: 'LOCAL',
    builtAt: 'LOCAL',
  },

  /** Network defaults for HttpClient calls (use in your services if desired) */
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
