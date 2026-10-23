import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const CANONICAL_API = 'https://wybuild-black.vercel.app';
export const isNative = () => Capacitor.isNativePlatform();
function runtimeConfig(): any {
  try { return (window as any).__WYBUILD_RUNTIME_CONFIG__ || (window as any).wybuildRuntimeConfig || {}; } catch { return {}; }
}
const configured = String(import.meta.env.VITE_API_BASE_URL || runtimeConfig().apiBaseUrl || '').trim();
export const API_BASE = (isNative() ? (configured || CANONICAL_API) : '').replace(/\/$/, '');
export const apiUrl = (path: string) => `${API_BASE}/api/${String(path).replace(/^\/+/, '')}`;
export async function authHeaders(extra?: HeadersInit): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (extra) new Headers(extra).forEach((v, k) => { headers[k] = v; });
  if (isNative()) {
    const { value } = await Preferences.get({ key: 'wybuild:nativeAccessToken' });
    if (value) headers.Authorization = `Bearer ${value}`;
  }
  return headers;
}
export async function saveNativeToken(token: string) { await Preferences.set({ key: 'wybuild:nativeAccessToken', value: token }); }
export async function clearNativeToken() { await Preferences.remove({ key: 'wybuild:nativeAccessToken' }); await Preferences.remove({ key: 'wybuild:pkceVerifier' }); }
