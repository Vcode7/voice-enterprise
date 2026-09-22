/**
 * Centralized API Client Configuration for Voice ERP.
 * Routes all frontend requests directly to the Python FastAPI backend.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : 'http://127.0.0.1:8000');

/**
 * Constructs the absolute URL targeting the Python backend API.
 * Ensures consistent routing regardless of frontend host/port.
 */
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

/**
 * Standard fetch wrapper that directs requests to the Python backend
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  return fetch(url, init);
}
