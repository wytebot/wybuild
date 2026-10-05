export type PlanType = 'free' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';
export type BuildTarget = 'apk' | 'appbundle' | 'split-per-abi';
export type BuildMode = 'debug' | 'profile' | 'release';
export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
export type UserRole = 'Owner' | 'Admin' | 'Developer' | 'Viewer';

export interface DartDefine {
  key: string;
  value: string;
}

export interface BuildConfiguration {
  target: BuildTarget;
  mode: BuildMode;
  flutterVersion: string;
  dartDefines: DartDefine[];
  obfuscate: boolean;
  splitDebugInfo: boolean;
  runTests: boolean;
  customArgs: string;
  keystoreId?: string;
}

export type BuildKind = 'flutter' | 'twa';
export type TwaOutput = 'apk' | 'aab' | 'both';

/** Everything the TWA workflow needs. Blank fields are auto-detected from the site's Web App Manifest. */
/** How a link is treated inside the Android app. internal = stays in the app, external = opens in the phone's browser, other = handed to Android (dialer, mail, WhatsApp, Maps...) */
export type LinkMode = 'internal' | 'external' | 'other';
export interface LinkRule { pattern: string; mode: LinkMode }

export interface TwaConfig {
  webUrl: string;
  packageId: string;
  name: string;
  launcherName: string;
  versionName: string;
  versionCode?: number; // blank = CI run number (always increases)
  themeColor: string;
  backgroundColor: string;
  navigationColor?: string;
  startUrl: string;
  iconUrl: string;
  maskableIconUrl: string;
  monochromeIconUrl: string;
  webManifestUrl?: string;
  display: 'standalone' | 'fullscreen' | 'fullscreen-sticky' | 'minimal-ui';
  orientation: 'default' | 'portrait' | 'landscape';
  fallbackType: 'customtabs';
  /** standalone = native app shell, never shows an address bar (default). twa = plain Trusted Web Activity (needs assetlinks.json) */
  shell?: 'standalone' | 'twa';
  enableNotifications: boolean;
  enableSiteSettingsShortcut: boolean;
  locationDelegation: boolean;
  playBilling: boolean;
  additionalTrustedOrigins: string[];
  /** link handling: first matching rule wins; links on the app's own site always stay internal */
  linkRules?: LinkRule[];
  androidPermissions: string[];
  shortcuts: { name: string; shortName: string; url: string }[];
  minSdkVersion: number;
  expectedFingerprint: string;
  /** Android 13+ back-swipe preview animation (native, baked into the APK/AAB) */
  predictiveBack?: boolean;
  /** SHA-256 of Google Play's app-signing key; added to assetlinks.json so Play installs stay fullscreen with no address bar */
  playSigningFingerprint?: string;
  // build options
  output: TwaOutput;
  storeReady: boolean;
  useKeystore: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  branch: string;
  config: BuildConfiguration;
  createdAt: string;
  updatedAt: string;
  lastBuildStatus?: BuildStatus;
  lastBuildAt?: string;
  buildCount: number;
  kind?: BuildKind;
  twa?: TwaConfig;
}

export interface BuildStep {
  id: string;
  name: string;
  status: StepStatus;
  durationMs: number;
  logs: string[];
  error?: string;
}

export interface BuildArtifact {
  name: string;
  type: 'apk' | 'aab' | 'mapping' | 'bundle';
  sizeBytes: number;
  sizeFormatted: string;
  downloadUrl: string;
  sha256: string;
}

export interface TestResult {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coveragePercent: number;
  results: TestResult[];
}

export interface ErrorDiagnosis {
  id: string;
  title: string;
  category: 'gradle' | 'flutter_sdk' | 'keystore' | 'dependency' | 'permissions' | 'twa_config';
  severity: 'critical' | 'warning';
  matchedPattern: string;
  description: string;
  suggestedFix: string;
  autoFixAvailable: boolean;
  autoFixAction?: string;
}

export interface BuildRecord {
  id: string;
  projectId: string;
  projectName: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  author: string;
  status: BuildStatus;
  startedAt: string;
  finishedAt?: string;
  durationSeconds: number;
  target: BuildTarget;
  mode: BuildMode;
  flutterVersion: string;
  runnerType: 'shared-standard' | 'priority-dedicated';
  steps: BuildStep[];
  artifacts: BuildArtifact[];
  testReport?: TestReport;
  errorDiagnosis?: ErrorDiagnosis;
  repo?: string;
  runId?: number;
  htmlUrl?: string;
  kind?: BuildKind;
  twa?: { packageId: string; output?: string; versionName?: string; fingerprint?: string };
}

export interface Keystore {
  id: string;
  repo: string;
  name: string;
  alias: string;
  storePasswordMasked: string;
  keyPasswordMasked: string;
  validityYears: number;
  fingerprintSha256: string;
  createdAt: string;
  isDefault: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  status: 'active' | 'invited';
  joinedAt: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  ipAddress: string;
}

export interface SubscriptionInfo {
  plan: PlanType;
  billingCycle: BillingCycle;
  status: 'active' | 'trialing' | 'past_due' | 'cancelled';
  nextBillingDate: string;
  amount: number;
  currency: string;
  flwTransactionRef: string;
  customerEmail: string;
  cardLast4?: string;
  cardBrand?: string;
  autoRenew?: boolean;
}

export interface RateLimitState {
  monthlyBuildsUsed: number;
  monthlyLimit: number;
  resetsAt: string;
  activeConcurrentBuilds: number;
  concurrentLimit: number;
}

export interface FlutterwaveConfig {
  publicKey: string;
  isLive: boolean;
  merchantName: string;
  webhookSecret: string;
}

export interface GitHubWebhook {
  id: string;
  projectId: string;
  projectName: string;
  repoUrl: string;
  webhookUrl: string;
  secret: string;
  branches: string[];
  events: ('push' | 'pull_request' | 'release')[];
  target: BuildTarget;
  mode: BuildMode;
  isActive: boolean;
  autoCancelRedundantBuilds: boolean;
  createdAt: string;
  lastDeliveredAt?: string;
  lastDeliveryStatus?: 'success' | 'failed';
  deliveryCount: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  branch: string;
  commitHash: string;
  commitMessage: string;
  author: string;
  timestamp: string;
  httpStatus: number;
  triggeredBuildId?: string;
  latencyMs: number;
}


export interface AuthUser {
  login: string;
  name: string;
  avatar: string;
  email: string;
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  canPush: boolean;
}
