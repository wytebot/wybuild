import { AuthUser, BillingCycle, BuildConfiguration, BuildKind, BuildRecord, Keystore, RepoInfo, SubscriptionInfo, TwaConfig } from '../types';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || res.statusText, res.status, data.code);
  return data as T;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const enc = encodeURIComponent;

export interface TwaInspection {
  detected: Partial<Pick<TwaConfig, 'webUrl' | 'webManifestUrl' | 'name' | 'launcherName' | 'themeColor' | 'backgroundColor' | 'startUrl' | 'display' | 'orientation' | 'iconUrl' | 'maskableIconUrl' | 'packageId'>>;
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
  latestCommitSha?: string;
}

export interface UsageInfo {
  monthlyBuildsUsed: number;
  monthlyLimit: number;
  concurrentLimit: number;
  resetsAt: string;
}

export const api = {
  me: () => request<{ user: AuthUser; subscription: SubscriptionInfo | null; usage: UsageInfo }>('me'),
  logout: () => post<{ ok: true }>('auth/logout', {}),
  repos: () => request<{ repos: RepoInfo[] }>('repos').then((r) => r.repos),
  inspectRepo: (repo: string, kind: BuildKind = 'flutter') => request<RepoInspection>(`inspect-repo?repo=${enc(repo)}&kind=${kind}`),
  workflow: (repo: string, branch: string, kind: BuildKind = 'flutter') =>
    request<{ installed: boolean; upToDate: boolean }>(`workflow?repo=${enc(repo)}&branch=${enc(branch)}&kind=${kind}`),
  installWorkflow: (repo: string, branch: string, kind: BuildKind = 'flutter') => post<{ ok: true }>('install-workflow', { repo, branch, kind }),
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
  billingConfig: () => request<{ encryptionKey: string; currency: string; pricing: Record<BillingCycle, number> }>('billing/config'),
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
