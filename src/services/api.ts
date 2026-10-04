import { AuthUser, BillingCycle, BuildConfiguration, BuildKind, BuildRecord, Keystore, RepoInfo, SubscriptionInfo, TwaConfig } from '../types';

export class ApiError extends Error {
  status: number;
  code?: string;
  hint?: string;
  details?: Record<string, unknown>;
  /** the bare cause, without the hint appended */
  reason: string;
  constructor(message: string, status: number, code?: string, hint?: string, details?: Record<string, unknown>) {
    super(hint ? `${message} Fix: ${hint}` : message);
    this.reason = message;
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method || 'GET';
  const where = `${method} /api/${path.split('?')[0]}`;
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError(`Could not reach the WyBuild server (${where}).`, 0, 'NETWORK', navigator.onLine ? 'The server may be redeploying or blocked by an extension/VPN. Retry in a few seconds.' : 'You appear to be offline.');
  }
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
  if (!res.ok) {
    if (data === null) {
      // the response was not our JSON error: a platform page (Vercel 404/500/timeout) rather than the app
      const platform = res.status === 404 ? 'The API route does not exist on this deployment (the serverless function was not deployed or vercel.json rewrites are missing).'
        : res.status === 504 || res.status === 408 ? 'The server function timed out.'
        : res.status >= 500 ? 'The server function crashed before it could respond; check the Vercel function logs.' : '';
      throw new ApiError(`${where} returned HTTP ${res.status} ${res.statusText} with a non-JSON body.`, res.status, 'NON_JSON_RESPONSE', platform || undefined);
    }
    throw new ApiError(data.error || `${where} failed with HTTP ${res.status} ${res.statusText}.`, res.status, data.code, data.hint, data.details);
  }
  return (data ?? {}) as T;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const enc = encodeURIComponent;

export interface TwaInspection {
  detected: Partial<Pick<TwaConfig, 'webUrl' | 'webManifestUrl' | 'name' | 'launcherName' | 'themeColor' | 'backgroundColor' | 'startUrl' | 'display' | 'orientation' | 'iconUrl' | 'maskableIconUrl' | 'monochromeIconUrl' | 'packageId' | 'additionalTrustedOrigins' | 'shortcuts'>>;
  /** native features the live site's code appears to use (suggestions) */
  featureHints?: ('notifications' | 'location' | 'camera' | 'microphone' | 'vibration')[];
  checks: { id: string; ok: boolean; level: 'ok' | 'warn' | 'error'; msg: string }[];
  assetlinks: { present: boolean; packages: string[] };
}


export interface RepoInspection {
  repo: string;
  name: string;
  defaultBranch: string;
  framework: 'flutter' | 'expo' | 'react-native' | 'web' | 'unknown';
  flutterVersion: string;
  packageId?: string;
  workflowInstalled: boolean;
  workflowUpToDate: boolean;
  workflows?: { flutter: { installed: boolean; upToDate: boolean }; twa: { installed: boolean; upToDate: boolean } };
  /** repo = repo has its own key, default = server default key will be copied in automatically, none = needs an upload */
  signing?: 'repo' | 'default' | 'none';
  /** why the Vercel default key cannot be used (only set when signing is 'none') */
  signingProblem?: string;
  homepage?: string;
  /** values read from a web manifest / package.json inside the repo; used only to fill blanks the live site does not publish */
  web?: { source: string; name: string; launcherName: string; themeColor: string; backgroundColor: string; display: string; orientation: string; startUrl: string };
  canPush?: boolean;
  private?: boolean;
  latestCommitSha?: string;
}

export interface UsageInfo {
  monthlyBuildsUsed: number;
  monthlyLimit: number;
  concurrentLimit: number;
  resetsAt: string;
}

export const api = {
  me: () => request<{ user: AuthUser; subscription: SubscriptionInfo | null; usage: UsageInfo; lifetimeFree?: boolean; pricing?: Record<BillingCycle, number>; pricingNgn?: Record<BillingCycle, number>; defaultKeystore?: boolean; defaultKeystoreProblem?: string }>('me'),
  logout: () => post<{ ok: true }>('auth/logout', {}),
  loginWithToken: (token: string) => post<{ ok: true; login: string; tokenType: 'classic' | 'fine-grained' }>('auth/token', { token }),
  repos: () => request<{ repos: RepoInfo[] }>('repos').then((r) => r.repos),
  inspectRepo: (repo: string, kind: BuildKind = 'twa') => request<RepoInspection>(`inspect-repo?repo=${enc(repo)}&kind=${kind}`),
  workflow: (repo: string, branch: string, kind: BuildKind = 'twa') =>
    request<{ installed: boolean; upToDate: boolean }>(`workflow?repo=${enc(repo)}&branch=${enc(branch)}&kind=${kind}`),
  resetSigning: (repo: string) => post<{ ok: true; signing: 'default' }>('signing/reset', { repo }),
  installWorkflow: (repo: string, branch: string, kind: BuildKind = 'twa') => post<{ ok: true }>('install-workflow', { repo, branch, kind }),
  twaBuild: (repo: string, branch: string, twa: TwaConfig) => {
    const { output, storeReady, useKeystore, ...rest } = twa;
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length)));
    return post<{ ok: true }>('twa-build', { repo, branch, output, storeReady, useKeystore, twa: clean });
  },
  twaInspect: (url: string) => post<TwaInspection>('twa/inspect', { url }),
  twaAssetlinks: (url: string, packageId: string, fingerprint?: string) =>
    post<{ published: boolean; fingerprintMatches: boolean | null; fingerprints: string[] }>('twa/assetlinks', { url, packageId, fingerprint }),
  build: (repo: string, branch: string, config: BuildConfiguration) =>
    post<{ ok: true }>('build', { repo, branch, config: { ...config, useKeystore: !!config.keystoreId } }),
  runs: (repos: string[]) => request<{ builds: BuildRecord[] }>(`runs?repos=${enc(repos.join(','))}`).then((r) => r.builds),
  run: (repo: string, id: string) => request<{ build: BuildRecord }>(`run?repo=${enc(repo)}&id=${enc(id)}`).then((r) => r.build),
  cancel: (repo: string, runId: number) => post<{ ok: true }>('cancel', { repo, runId }),
  keystores: (repos: string[]) => request<{ keystores: Keystore[] }>(`keystore?repos=${enc(repos.join(','))}`).then((r) => r.keystores),
  saveKeystore: (body: { repo: string; name: string; alias: string; storePassword: string; keyPassword: string; fileBase64: string }) =>
    post<{ ok: true }>('keystore', body),
  deleteKeystore: (repo: string) => request<{ ok: true }>(`keystore?repo=${enc(repo)}`, { method: 'DELETE' }),
  billingConfig: () => request<{ encryptionKey: string; currency: string; pricing: Record<BillingCycle, number>; pricingNgn?: Record<BillingCycle, number> }>('billing/config'),
  checkout: (body: {
    cycle: BillingCycle;
    card: {
      nonce: string;
      encrypted_card_number: string;
      encrypted_expiry_month: string;
      encrypted_expiry_year: string;
      encrypted_cvv: string;
    };
  }) => post<{
    chargeId: string;
    reference: string;
    status: string;
    nextAction: any;
    redirectUrl?: string | null;
  }>('billing/checkout', body),
  authorizeBilling: (body: {
    chargeId: string;
    type: 'pin' | 'otp';
    pin?: { nonce: string; encrypted_pin: string };
    otp?: string;
  }) => post<{ chargeId: string; status: string; nextAction: any; redirectUrl?: string | null }>('billing/authorize', body),
  cancelSubscription: () => post<{ ok: true; activeUntil: string }>('billing/cancel', {}),
  billingStatus: (chargeId: string) =>
    request<{ id: string; reference: string; status: string; nextAction: any; redirectUrl?: string | null }>(
      `billing/status?chargeId=${enc(chargeId)}`
    ),
};

/** "https://github.com/owner/repo(.git)" or "owner/repo" -> "owner/repo" */
export function repoFromUrl(input: string): string | null {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(input.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}
