import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Project,
  BuildRecord,
  Keystore,
  TeamMember,
  AuditLog,
  SubscriptionInfo,
  BillingCycle,
  RateLimitState,
  GitHubWebhook,
  WebhookDelivery,
  BuildTarget,
  BuildMode,
  BuildKind,
  AuthUser,
  RepoInfo,
} from '../types';
import {
  INITIAL_MEMBERS,
  INITIAL_AUDIT_LOGS,
  INITIAL_WEBHOOKS,
  INITIAL_DELIVERIES,
} from '../data/mockData';
import { api, ApiError, repoFromUrl, RepoInspection, UsageInfo } from '../services/api';

interface AppContextType {
  projects: Project[];
  builds: BuildRecord[];
  activeBuildId: string | null;
  setActiveBuildId: (id: string | null) => void;
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  keystores: Keystore[];
  teamMembers: TeamMember[];
  auditLogs: AuditLog[];
  subscription: SubscriptionInfo;
  rateLimits: RateLimitState;
  openFlutterwaveCheckout: (cycle: BillingCycle) => void;
  cancelSubscription: () => Promise<void>;
  user: AuthUser | null;
  authState: 'loading' | 'anon' | 'authed';
  logout: () => Promise<void>;
  repos: RepoInfo[];
  reposLoading: boolean;
  refreshRepos: () => Promise<void>;
  /** the one repo the whole app is working on; shared by every screen */
  selectedRepo: string;
  selectRepo: (repo: string) => void;
  /** one discovery per repo, cached and shared by every screen */
  inspections: Record<string, RepoInspection>;
  discoverRepo: (repo: string, force?: boolean) => Promise<RepoInspection>;
  /** pick a repo: select it, discover it and land on the right screen */
  openRepo: (repo: string) => Promise<{ ok: boolean; error?: string }>;
  defaultKeystore: boolean;
  notifyBuildStarted: () => void;
  /** true between pressing Build/Re-run and the new GitHub run showing up: the UI shows a clean "waiting" state instead of the old logs */
  awaitingNewBuild: boolean;
  expectNewBuild: (repo: string) => void;
  cancelExpectNewBuild: () => void;
  addProject: (newProj: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'buildCount'>) => { success: boolean; error?: string; id?: string };
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  triggerBuild: (projectId: string, branch?: string) => Promise<{ success: boolean; error?: string }>;
  cancelBuild: (buildId: string) => void;
  addKeystore: (input: {
    repo: string;
    name: string;
    alias: string;
    storePassword: string;
    keyPassword: string;
    file: File;
  }) => Promise<boolean>;
  deleteKeystore: (id: string) => Promise<void>;
  inviteMember: (name: string, email: string, role: TeamMember['role']) => void;
  removeMember: (id: string) => void;
  applyAutoFix: (buildId: string, fixAction: string) => void;
  webhooks: GitHubWebhook[];
  webhookDeliveries: WebhookDelivery[];
  createWebhook: (options: {
    projectId: string;
    branches: string[];
    target: BuildTarget;
    mode: BuildMode;
    events: ('push' | 'pull_request' | 'release')[];
    autoCancelRedundantBuilds: boolean;
  }) => GitHubWebhook | null;
  updateWebhook: (id: string, updates: Partial<GitHubWebhook>) => void;
  deleteWebhook: (id: string) => void;
  regenerateWebhookSecret: (id: string) => string;
  triggerTestWebhookPush: (webhookId: string, branchOverride?: string) => Promise<{ success: boolean; buildId?: string }>;
  toastMessage: string | null;
  showToast: (msg: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEYS = {
  PROJECTS: 'wybuild_projects_v3',
  BUILDS: 'wybuild_builds_v2',
  KEYSTORES: 'wybuild_keystores_v2',
  MEMBERS: 'wybuild_members_v2',
  LOGS: 'wybuild_logs_v2',
  SUBSCRIPTION: 'wybuild_sub_v2',
  BUILDS_COUNT: 'wybuild_successful_builds_v3',
  WEBHOOKS: 'wybuild_webhooks_v2',
  DELIVERIES: 'wybuild_deliveries_v2',
};

const EMPTY_SUB: SubscriptionInfo = {
  plan: 'free',
  billingCycle: 'monthly',
  status: 'active',
  nextBillingDate: '',
  amount: 0,
  currency: 'USD',
  flwTransactionRef: '',
  customerEmail: '',
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<'loading' | 'anon' | 'authed'>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [defaultKeystore, setDefaultKeystore] = useState(false);
  const [selectedRepo, setSelectedRepoState] = useState<string>(() => localStorage.getItem('wybuild_selected_repo') || '');
  const [inspections, setInspections] = useState<Record<string, RepoInspection>>({});
  const [usage, setUsage] = useState<UsageInfo>({ monthlyBuildsUsed: 0, monthlyLimit: 5, concurrentLimit: 1, resetsAt: '' });
  const [subscription, setSubscription] = useState<SubscriptionInfo>(EMPTY_SUB);

  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    return saved ? JSON.parse(saved) : [];
  });

  const [builds, setBuilds] = useState<BuildRecord[]>([]);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [keystores, setKeystores] = useState<Keystore[]>([]);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MEMBERS);
    return saved ? JSON.parse(saved) : INITIAL_MEMBERS;
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.LOGS);
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });

  const [webhooks, setWebhooks] = useState<GitHubWebhook[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.WEBHOOKS);
    return saved ? JSON.parse(saved) : INITIAL_WEBHOOKS;
  });

  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DELIVERIES);
    return saved ? JSON.parse(saved) : INITIAL_DELIVERIES;
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Local-only data (projects, team, audit log, webhook UI) persists in the browser
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(teamMembers)); }, [teamMembers]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(auditLogs)); }, [auditLogs]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.WEBHOOKS, JSON.stringify(webhooks)); }, [webhooks]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.DELIVERIES, JSON.stringify(webhookDeliveries)); }, [webhookDeliveries]);

  const buildsRef = useRef(builds);
  buildsRef.current = builds;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const inspectionsRef = useRef(inspections);
  inspectionsRef.current = inspections;
  const [awaitingNewBuild, setAwaitingNewBuild] = useState(false);
  const awaitingRef = useRef(false);
  const awaitRepoRef = useRef('');
  const knownIdsRef = useRef<Set<string>>(new Set());
  const awaitTimerRef = useRef(0);

  const cancelExpectNewBuild = useCallback(() => {
    awaitingRef.current = false;
    window.clearTimeout(awaitTimerRef.current);
    setAwaitingNewBuild(false);
  }, []);

  // Called right before a build is dispatched: remember what exists now, clear the selection and old logs
  const expectNewBuild = useCallback((repo: string) => {
    knownIdsRef.current = new Set(buildsRef.current.filter((b) => b.repo === repo).map((b) => b.id));
    awaitRepoRef.current = repo;
    awaitingRef.current = true;
    setAwaitingNewBuild(true);
    setActiveBuildId(null);
    window.clearTimeout(awaitTimerRef.current);
    // GitHub normally lists the run within seconds; never wait forever
    awaitTimerRef.current = window.setTimeout(cancelExpectNewBuild, 90000);
  }, [cancelExpectNewBuild]);

  const repoList = useMemo(
    () => Array.from(new Set(projects.map((p) => repoFromUrl(p.repoUrl)).filter((r): r is string => !!r))),
    [projects]
  );
  // keystores are looked up for connected projects AND the repo currently selected
  const keystoreRepos = useMemo(() => Array.from(new Set([...(selectedRepo ? [selectedRepo] : []), ...repoList])).slice(0, 10), [repoList, selectedRepo]);

  const selectRepo = useCallback((repo: string) => {
    setSelectedRepoState(repo);
    if (repo) localStorage.setItem('wybuild_selected_repo', repo);
    else localStorage.removeItem('wybuild_selected_repo');
  }, []);

  const refreshRepos = useCallback(async () => {
    setReposLoading(true);
    try {
      setRepos(await api.repos());
    } catch {
      /* the picker shows an empty state with a retry */
    } finally {
      setReposLoading(false);
    }
  }, []);

  const discoverRepo = useCallback(async (repo: string, force = false): Promise<RepoInspection> => {
    if (!force && inspectionsRef.current[repo]) return inspectionsRef.current[repo];
    const ri = await api.inspectRepo(repo, 'twa'); // one call returns framework, both workflows and signing
    setInspections((prev) => ({ ...prev, [repo]: ri }));
    return ri;
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me.user);
      setUsage(me.usage);
      setSubscription(me.subscription ?? { ...EMPTY_SUB, customerEmail: me.user.email });
      setDefaultKeystore(!!me.defaultKeystore);
      setAuthState('authed');
    } catch (e) {
      // Only a 401 means "not signed in"; other errors must not bounce a
      // signed-in user back to the login screen.
      if (e instanceof ApiError && e.status === 401) setAuthState('anon');
      else setAuthState((prev) => (prev === 'loading' ? 'anon' : prev));
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    if (!repoList.length) {
      setBuilds([]);
      return;
    }
    try {
      const list = await api.runs(repoList);
      if (awaitingRef.current) {
        const fresh = list.find((b) => b.repo === awaitRepoRef.current && !knownIdsRef.current.has(b.id));
        if (fresh) {
          awaitingRef.current = false;
          window.clearTimeout(awaitTimerRef.current);
          setAwaitingNewBuild(false);
          setActiveBuildId(fresh.id);
        }
      }
      setBuilds((prev) => {
        const detailed = new Map<string, BuildRecord>(prev.filter((b) => b.steps.length > 0).map((b): [string, BuildRecord] => [b.id, b]));
        return list.map((b) => {
          const proj = projectsRef.current.find((p) => repoFromUrl(p.repoUrl) === b.repo);
          const d = detailed.get(b.id);
          const base = d && d.status === b.status ? { ...b, steps: d.steps, artifacts: d.artifacts, errorDiagnosis: d.errorDiagnosis, twa: d.twa ?? b.twa } : b;
          return { ...base, projectId: proj?.id || '', projectName: proj?.name || b.projectName };
        });
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthState('anon');
    }
  }, [repoList]);

  const fetchDetail = useCallback(async (id: string) => {
    const b = buildsRef.current.find((x) => x.id === id);
    if (!b?.repo) return;
    try {
      const d = await api.run(b.repo, id);
      setBuilds((prev) => prev.map((x) => (x.id === id ? { ...x, ...d, projectId: x.projectId, projectName: x.projectName } : x)));
    } catch {
      /* transient: next poll retries */
    }
  }, []);

  const refreshKeystores = useCallback(async () => {
    if (!keystoreRepos.length) {
      setKeystores([]);
      return;
    }
    try {
      setKeystores(await api.keystores(keystoreRepos));
    } catch {
      /* ignore */
    }
  }, [keystoreRepos]);

  // Session bootstrap + return from Flutterwave checkout
  useEffect(() => {
    refreshMe().then(() => {
      const b = new URLSearchParams(window.location.search).get('billing');
      if (!b) return;
      showToast(
        b === 'success'
          ? 'Payment verified. Pro is active.'
          : b === 'cancelled'
          ? 'Payment cancelled.'
          : 'Payment could not be verified. If you were charged, Pro will activate shortly.'
      );
      window.history.replaceState(null, '', window.location.pathname);
      if (b === 'success') setCurrentTab('billing');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After sign-in every repo is loaded automatically; nothing has to be typed or "connected" first
  useEffect(() => {
    if (authState === 'authed') void refreshRepos();
  }, [authState, refreshRepos]);

  // Forget a remembered repo that this account can no longer see
  useEffect(() => {
    if (repos.length && selectedRepo && !repos.some((r) => r.fullName.toLowerCase() === selectedRepo.toLowerCase())) selectRepo('');
  }, [repos, selectedRepo, selectRepo]);

  // Poll GitHub runs: fast while something is running, slow otherwise, paused when the tab is hidden
  useEffect(() => {
    if (authState !== 'authed') return;
    let stop = false;
    let timer = 0;
    const tick = async () => {
      if (!document.hidden) await refreshRuns();
      if (stop) return;
      const active = awaitingRef.current || buildsRef.current.some((b) => b.status === 'running' || b.status === 'queued');
      timer = window.setTimeout(tick, active ? 3500 : 30000);
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [authState, refreshRuns]);

  useEffect(() => {
    if (authState === 'authed') refreshKeystores();
  }, [authState, refreshKeystores]);

  useEffect(() => {
    if (!activeBuildId && builds.length && !awaitingNewBuild) setActiveBuildId(builds[0].id);
  }, [builds, activeBuildId, awaitingNewBuild]);

  // Steps, logs and artifacts for the selected build
  useEffect(() => {
    if (authState !== 'authed' || !activeBuildId) return;
    fetchDetail(activeBuildId);
    const t = window.setInterval(() => {
      const b = buildsRef.current.find((x) => x.id === activeBuildId);
      if (b && (b.status === 'running' || b.status === 'queued' || b.steps.length === 0)) fetchDetail(activeBuildId);
    }, 3000);
    return () => window.clearInterval(t);
  }, [authState, activeBuildId, fetchDetail]);

  // Derived rate limit state
  const isPro = subscription.plan === 'pro';
  const activeConcurrent = builds.filter((b) => b.status === 'running' || b.status === 'queued').length;
  const resetMs = usage.resetsAt ? Math.max(0, Date.parse(usage.resetsAt) - Date.now()) : 0;
  const rateLimits: RateLimitState = {
    monthlyBuildsUsed: usage.monthlyBuildsUsed,
    monthlyLimit: usage.monthlyLimit,
    resetsAt: `00:00 UTC (in ${Math.floor(resetMs / 3600000)}h ${Math.floor((resetMs % 3600000) / 60000)}m)`,
    activeConcurrentBuilds: activeConcurrent,
    concurrentLimit: usage.concurrentLimit,
  };

  const addProject = (newProj: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'buildCount'>) => {
    // Strictly enforce 10 project cap on Free tier
    if (!isPro && projects.length >= 10) {
      showToast('Free tier project limit reached (10/10). Upgrade to Pro for unlimited projects.');
      return {
        success: false,
        error: 'Free tier limit reached (10/10 projects). Upgrade to Pro for unlimited project integration.',
      };
    }

    const created: Project = {
      ...newProj,
      id: `proj-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      buildCount: 0,
    };

    setProjects((prev) => [created, ...prev]);

    // Record audit log
    const log: AuditLog = {
      id: `log-${Date.now()}`,
      actor: teamMembers[0]?.name || 'Current User',
      action: 'Created project',
      target: created.name,
      timestamp: new Date().toISOString(),
      ipAddress: '102.89.44.12',
    };
    setAuditLogs((prev) => [log, ...prev]);

    showToast(`Project "${created.name}" configured successfully!`);
    return { success: true, id: created.id };
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : p
      )
    );
    showToast('Project configuration saved.');
  };

  const deleteProject = (id: string) => {
    const proj = projects.find((p) => p.id === id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (proj) {
      showToast(`Project "${proj.name}" removed.`);
    }
  };

  const cancelSubscription = async () => {
    try {
      const r = await api.cancelSubscription();
      showToast(`Auto-renewal stopped. Pro stays active until ${new Date(r.activeUntil).toLocaleDateString()}.`);
      await refreshMe();
    } catch (e) {
      showToast(errMsg(e));
    }
  };

  const openFlutterwaveCheckout = (cycle: BillingCycle) => {
    window.dispatchEvent(new CustomEvent('wybuild:billing-open', { detail: { cycle } }));
  };

  const triggerBuild = async (projectId: string, branch?: string): Promise<{ success: boolean; error?: string }> => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return { success: false, error: 'Project not found' };
    const repo = repoFromUrl(proj.repoUrl);
    if (!repo) {
      const msg = 'This project does not point at a valid GitHub repository.';
      showToast(msg);
      return { success: false, error: msg };
    }
    let ref = branch || proj.branch;
    const kind: BuildKind = proj.kind === 'twa' && proj.twa ? 'twa' : 'flutter';
    let liveProject = proj;
    if (kind === 'flutter') {
      try {
        const live = await api.inspectRepo(repo);
        if (live.framework === 'flutter' && live.flutterVersion && live.flutterVersion !== proj.config.flutterVersion) {
          const next = { ...proj, branch: live.defaultBranch, config: { ...proj.config, flutterVersion: live.flutterVersion } };
          updateProject(proj.id, next);
          liveProject = next;
          if (!branch) ref = live.defaultBranch;
        }
      } catch { /* dispatch below returns the useful error if GitHub inspection is unavailable */ }
    }
    expectNewBuild(repo);
    const dispatch = () => (kind === 'twa' ? api.twaBuild(repo, ref, liveProject.twa!) : api.build(repo, ref, liveProject.config));

    try {
      try {
        await dispatch();
      } catch (e) {
        if (!(e instanceof ApiError && (e.code === 'NO_WORKFLOW' || e.code === 'MISSING_HELPER_FILES'))) throw e;
        await api.installWorkflow(repo, ref, kind);
        showToast('Build workflow prepared. Starting build...');
        // GitHub can take a few seconds to register a freshly committed workflow; retry only transient dispatch failures.
        let lastErr: unknown;
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 2500 : 4000));
          try {
            await dispatch();
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
            const transient = ['NO_WORKFLOW', 'MISSING_HELPER_FILES', 'WORKFLOW_NOT_DISPATCHABLE', 'GITHUB_VALIDATION', 'GITHUB_ERROR', 'GITHUB_NOT_FOUND'];
            if (!(err instanceof ApiError) || (err.code ? !transient.includes(err.code) : ![404, 422, 502].includes(err.status))) break;
          }
        }
        if (lastErr) throw lastErr;
      }

      showToast(`Build dispatched for ${proj.name} (${ref}).`);
      setCurrentTab('builds');
      setAuditLogs((prev) => [
        {
          id: `log-${Date.now()}`,
          actor: user?.login || 'Developer',
          action: 'Triggered cloud build',
          target: `${proj.name} (${ref})`,
          timestamp: new Date().toISOString(),
          ipAddress: '',
        },
        ...prev,
      ]);
      refreshMe();
      window.setTimeout(refreshRuns, 1200);
      window.setTimeout(refreshRuns, 4500);
      return { success: true };
    } catch (e) {
      cancelExpectNewBuild();
      const msg = errMsg(e);
      showToast(msg);
      if (e instanceof ApiError && e.code === 'LIMIT') openFlutterwaveCheckout('monthly');
      return { success: false, error: msg };
    }
  };

  const notifyBuildStarted = () => {
    refreshMe();
    window.setTimeout(refreshRuns, 1200);
    window.setTimeout(refreshRuns, 4500);
  };

  const openRepo = async (repo: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      selectRepo(repo);
      const ri = await discoverRepo(repo, true);
      if (ri.framework === 'web') {
        setCurrentTab('twa');
        return { ok: true };
      }
      if (ri.framework === 'flutter') {
        const exists = projectsRef.current.some((p) => repoFromUrl(p.repoUrl)?.toLowerCase() === repo.toLowerCase());
        if (!exists) {
          const res = addProject({
            name: ri.name,
            description: 'flutter repository',
            repoUrl: `https://github.com/${repo}`,
            branch: ri.defaultBranch,
            config: { target: 'apk', mode: 'release', flutterVersion: ri.flutterVersion || 'stable', dartDefines: [], obfuscate: false, splitDebugInfo: false, runTests: false, customArgs: '' },
          });
          if (!res.success) return { ok: false, error: res.error };
        }
        setCurrentTab('dashboard');
        return { ok: true };
      }
      return { ok: false, error: `This repo looks like ${ri.framework}. WyBuild builds Flutter apps and websites/PWAs (as Android apps); it found neither a Flutter pubspec.yaml nor a web app here.` };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  };

  const cancelBuild = async (buildId: string) => {
    const b = builds.find((x) => x.id === buildId);
    if (!b?.repo || !b.runId) return;
    try {
      await api.cancel(b.repo, b.runId);
      showToast(`Cancel requested for build #${buildId}.`);
      window.setTimeout(refreshRuns, 2500);
    } catch (e) {
      showToast(errMsg(e));
    }
  };

  const addKeystore = async (input: {
    repo: string;
    name: string;
    alias: string;
    storePassword: string;
    keyPassword: string;
    file: File;
  }): Promise<boolean> => {
    try {
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      let bin = '';
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      await api.saveKeystore({
        repo: input.repo,
        name: input.name,
        alias: input.alias,
        storePassword: input.storePassword,
        keyPassword: input.keyPassword,
        fileBase64: btoa(bin),
      });
      await refreshKeystores();
      showToast('Keystore stored in the repository as encrypted GitHub Actions secrets.');
      return true;
    } catch (e) {
      showToast(errMsg(e));
      return false;
    }
  };

  const deleteKeystore = async (id: string) => {
    try {
      await api.deleteKeystore(id);
      setProjects((prev) => prev.map((p) => (p.config.keystoreId === id ? { ...p, config: { ...p.config, keystoreId: undefined } } : p)));
      await refreshKeystores();
      showToast('Keystore secrets removed from the repository.');
    } catch (e) {
      showToast(errMsg(e));
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setBuilds([]);
      setKeystores([]);
      setSubscription(EMPTY_SUB);
      setAuthState('anon');
    }
  };

  const inviteMember = (name: string, email: string, role: TeamMember['role']) => {
    if (!isPro && teamMembers.length >= 3) {
      showToast('Free tier allows up to 3 team members. Upgrade to Pro for unlimited team members.');
      return;
    }
    const member: TeamMember = {
      id: `m-${Date.now()}`,
      name,
      email,
      role,
      status: 'invited',
      joinedAt: new Date().toISOString(),
    };
    setTeamMembers((prev) => [...prev, member]);
    showToast(`Invitation sent to ${email} (${role}).`);
  };

  const removeMember = (id: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== id));
    showToast('Member removed from workspace.');
  };

  const applyAutoFix = (buildId: string, fixAction: string) => {
    const targetBuild = builds.find((b) => b.id === buildId);
    if (!targetBuild) return;

    if (fixAction.includes('compileSdkVersion to 35')) {
      // Update the project build config
      setProjects((prev) =>
        prev.map((p) =>
          p.id === targetBuild.projectId
            ? {
                ...p,
                config: {
                  ...p.config,
                  customArgs: (p.config.customArgs || '') + ' -Ptarget-platform=android-arm64 --compile-sdk-version=35',
                },
              }
            : p
        )
      );
      showToast('Auto-fix applied: compileSdkVersion updated to 35 in project build configuration.');
    } else {
      showToast(`Auto-fix applied: ${fixAction}`);
    }
  };

  const createWebhook = (options: {
    projectId: string;
    branches: string[];
    target: BuildTarget;
    mode: BuildMode;
    events: ('push' | 'pull_request' | 'release')[];
    autoCancelRedundantBuilds: boolean;
  }): GitHubWebhook | null => {
    const proj = projects.find((p) => p.id === options.projectId);
    if (!proj) {
      showToast('Project not found');
      return null;
    }

    const id = `wh-${Date.now()}`;
    const token = Math.random().toString(36).substring(2, 10);
    const secret = `whsec_${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}`;
    const webhookUrl = `https://api.wybuild.app/v1/webhooks/github/${options.projectId}?sig=wh_${token}`;

    const newWebhook: GitHubWebhook = {
      id,
      projectId: options.projectId,
      projectName: proj.name,
      repoUrl: proj.repoUrl,
      webhookUrl,
      secret,
      branches: options.branches.length > 0 ? options.branches : ['main'],
      events: options.events.length > 0 ? options.events : ['push'],
      target: options.target,
      mode: options.mode,
      isActive: true,
      autoCancelRedundantBuilds: options.autoCancelRedundantBuilds,
      createdAt: new Date().toISOString(),
      deliveryCount: 0,
    };

    setWebhooks((prev) => [newWebhook, ...prev]);

    // Record audit log
    const log: AuditLog = {
      id: `log-${Date.now()}`,
      actor: teamMembers[0]?.name || 'Developer',
      action: 'Generated GitHub Webhook URL',
      target: `${proj.name} (${newWebhook.branches.join(', ')})`,
      timestamp: new Date().toISOString(),
      ipAddress: '102.89.44.12',
    };
    setAuditLogs((prev) => [log, ...prev]);

    showToast(`GitHub Webhook URL generated for ${proj.name}.`);
    return newWebhook;
  };

  const updateWebhook = (id: string, updates: Partial<GitHubWebhook>) => {
    setWebhooks((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...updates } : w))
    );
    showToast('Webhook configuration updated.');
  };

  const deleteWebhook = (id: string) => {
    const target = webhooks.find((w) => w.id === id);
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    if (target) {
      showToast(`Webhook for ${target.projectName} deleted.`);
    }
  };

  const regenerateWebhookSecret = (id: string): string => {
    const newSecret = `whsec_${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}${Math.random().toString(16).substring(2, 10)}`;
    setWebhooks((prev) =>
      prev.map((w) => (w.id === id ? { ...w, secret: newSecret } : w))
    );
    showToast('Webhook secret rotated. Update your GitHub repository webhook settings.');
    return newSecret;
  };

  const triggerTestWebhookPush = async (
    webhookId: string,
    branchOverride?: string
  ): Promise<{ success: boolean; buildId?: string }> => {
    const wh = webhooks.find((w) => w.id === webhookId);
    if (!wh) {
      showToast('Webhook not found.');
      return { success: false };
    }

    const targetBranch = branchOverride || wh.branches[0] || 'main';
    const commitHashes = ['f829a1b', '3c19e0d', '94a08f7', 'bb21980', '1e9a4f2'];
    const mockHash = commitHashes[Math.floor(Math.random() * commitHashes.length)];
    const author = teamMembers[0]?.email?.split('@')[0] || 'github-actions';

    // Dispatch build
    const buildRes = await triggerBuild(wh.projectId, targetBranch);

    const delivery: WebhookDelivery = {
      id: `del-${Date.now()}`,
      webhookId: wh.id,
      event: 'push',
      branch: targetBranch,
      commitHash: mockHash,
      commitMessage: `chore(github-push): automated build triggered for branch '${targetBranch}'`,
      author,
      timestamp: new Date().toISOString(),
      httpStatus: 200,
      latencyMs: Math.floor(110 + Math.random() * 80),
    };

    setWebhookDeliveries((prev) => [delivery, ...prev]);

    // Update webhook stats
    setWebhooks((prev) =>
      prev.map((w) =>
        w.id === webhookId
          ? {
              ...w,
              lastDeliveredAt: delivery.timestamp,
              lastDeliveryStatus: 'success',
              deliveryCount: w.deliveryCount + 1,
            }
          : w
      )
    );

    showToast(`GitHub Push received on '${targetBranch}'! Cloud CI/CD build started.`);
    return { success: true };
  };

  return (
    <AppContext.Provider
      value={{
        projects,
        builds,
        activeBuildId,
        setActiveBuildId,
        currentTab,
        setCurrentTab,
        keystores,
        teamMembers,
        auditLogs,
        subscription,
        rateLimits,
        openFlutterwaveCheckout,
        cancelSubscription,
        user,
        authState,
        logout,
        repos,
        reposLoading,
        refreshRepos,
        selectedRepo,
        selectRepo,
        inspections,
        discoverRepo,
        openRepo,
        defaultKeystore,
        notifyBuildStarted,
        awaitingNewBuild,
        expectNewBuild,
        cancelExpectNewBuild,
        addProject,
        updateProject,
        deleteProject,
        triggerBuild,
        cancelBuild,
        addKeystore,
        deleteKeystore,
        inviteMember,
        removeMember,
        applyAutoFix,
        webhooks,
        webhookDeliveries,
        createWebhook,
        updateWebhook,
        deleteWebhook,
        regenerateWebhookSecret,
        triggerTestWebhookPush,
        toastMessage,
        showToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
