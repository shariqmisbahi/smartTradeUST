// src/app/config/api.config.ts
import { environment } from '../../environments/environment';

function resolveApiBase(): string {
  // In dev UI (localhost:4100), ALWAYS talk to backend on 5294
  if (location.hostname === 'localhost' && location.port === '4100') {
    return 'http://localhost:5294/api';
  }
  // Otherwise use whatever the env says (prod: '/api')
  return (environment as any).API_BASE || '/api';
}

const API_BASE = resolveApiBase();

/** Build an absolute API URL, deduping slashes. */
export function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  return `${base}/${p}`;
}

// Optional: quick runtime sanity
// console.log('[api.config] API_BASE =', API_BASE);
