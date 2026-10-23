import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, LifeBuoy } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface Note { problem: string; fix: string }
interface Step { title: string; summary: string; points: string[]; notes?: Note[]; tab?: { id: string; label: string } }

const STEPS: Step[] = [
  {
    title: 'Sign in with GitHub',
    summary: 'WyBuild builds inside your own GitHub account, so it needs permission to read your repositories and to add a workflow file.',
    points: [
      'Choose Continue with GitHub on the login screen and approve the repo and workflow permissions.',
      'Prefer a token? Open "Use a personal access token" and paste a classic token with the repo and workflow scopes, or a fine-grained token with Contents, Actions, Secrets and Workflows write access.',
      'If you have several accounts, pick one under Previously used accounts so GitHub asks you to sign in as that account.',
    ],
    notes: [
      { problem: 'Your WyBuild login session has expired (SESSION_EXPIRED) or GitHub returned 401 (GITHUB_AUTH_EXPIRED).', fix: 'Sign out, then sign in with GitHub again and approve the permissions. Your projects and keystores are not deleted.' },
      { problem: 'GitHub refused to write the workflow because the "workflow" permission is missing (MISSING_WORKFLOW_SCOPE).', fix: 'Sign out and sign in again, approving both repo and workflow. If you signed in before, remove WyBuild at github.com/settings/connections/applications first so GitHub asks for the permissions again.' },
      { problem: 'The token is rejected or is missing a scope (TOKEN_SCOPES, TOKEN_REJECTED).', fix: 'Create a new token that has the repo and workflow scopes and paste it again. Copy the whole token, with no spaces.' },
    ],
  },
  {
    title: 'Pick the repository and the live site',
    summary: 'Open Web → Android and choose the repository that holds your web app. WyBuild reads your live website to prefill the app details.',
    points: [
      'WyBuild finds the website address from the repository Website field, the package.json homepage, a CNAME file or GitHub Pages. You can also type it yourself.',
      'It then inspects the site: web manifest, icons, service worker and Digital Asset Links, and shows the results as checks.',
      'The repository status tiles show whether the workflow is installed, up to date, and which signing key will be used.',
    ],
    tab: { id: 'twa', label: 'Open Web → Android' },
    notes: [
      { problem: 'Repository found, but no live address was found.', fix: 'Set the Website field in the repository About box (or homepage in package.json), or type the https address into the site field.' },
      { problem: 'Repository found, but the live site could not be read.', fix: 'Open the address in a browser first. It must be public, use https and respond within a few seconds. A site behind a login or a firewall cannot be inspected.' },
      { problem: 'Your account only has read access to the repository (NO_PUSH_ACCESS).', fix: 'WyBuild has to commit a workflow file. Sign in with an account that has write access, or fork the repository into your own account and build the fork.' },
      { problem: 'GitHub returns 404 for a repository you can open in the browser (GITHUB_NOT_FOUND).', fix: 'Private repositories and organizations that restrict OAuth apps look like 404. Approve WyBuild for the organization at github.com/settings/connections/applications.' },
    ],
  },
  {
    title: 'Check the app identity',
    summary: 'Name, package ID, version, icons, colors and screen mode are filled in automatically. Review them before the first build.',
    points: [
      'Package ID is the permanent identity of the app on a phone and on Google Play. Pick it once and do not change it later.',
      'Version name is what people see. The version code defaults to the GitHub run number, so each build is higher than the last.',
      'Icons: a 512 px icon is required. A maskable icon gives the best result on Android launchers.',
      'Screen mode controls the status and navigation bars (standard, fullscreen or sticky fullscreen).',
    ],
    notes: [
      { problem: 'The package ID is rejected.', fix: 'Use lowercase letters, digits and underscores, separated by dots, with every part starting with a letter (for example com.mybrand.app). A free-hosting address becomes app.name.vercel by default.' },
      { problem: 'The app shows a generic icon after install.', fix: 'The icon address could not be downloaded during the build. Make sure the icon and maskable icon links are public https URLs, then rebuild.' },
      { problem: 'The new APK will not update the installed one ("App not installed").', fix: 'The package ID or the signing key differs from the installed app, or the new version code is not higher. Uninstall the old app or keep the same ID, key and a higher version code.' },
    ],
  },
  {
    title: 'Choose how the app is built',
    summary: 'WyBuild picks the engine for you, and you can add optional native features.',
    points: [
      'Capacitor source build: used when the repository has a package.json build script that produces an index.html (in dist, build, www, out or public). Your site is bundled into the app and the native bridge window.WyBuildNative is available.',
      'URL-based native shell: used when there is no buildable web project. The app loads your live address.',
      'Native features are opt-in: biometric unlock, local reminders, push, native Firebase sign-in, pull to refresh and edge swipe back. Pull to refresh and swipe back only work when your site calls WyBuildNative.pullToRefresh.enable() and WyBuildNative.swipeBack.enable().',
      'Choose the output: APK for direct installs, AAB for Google Play, or both.',
    ],
    notes: [
      { problem: 'The build stops with "This repository has a build script, but it failed."', fix: 'WyBuild never swaps your source for the live URL. Run npm ci && npm run build on your own machine, fix the error, commit, and build again. Static-export frameworks can add a build:capacitor-web script.' },
      { problem: 'The app cannot reach its server after install.', fix: 'A standalone Capacitor app loads its interface from bundled files at https://localhost; there is no server behind that address. Use MORE → Backend & sign-in survival settings to set your public HTTPS API base URL, configure a supported native sign-in handoff, and review the compatibility report before building. WyBuild blocks unresolved critical issues before reserving credits unless you explicitly acknowledge the risk. If the shell itself is blank, the startup diagnostic reports a JavaScript crash separately from a backend outage.' },
      { problem: 'A selected feature is not supported by the detected engine.', fix: 'The build stops with an explanation instead of ignoring the feature. For example, push and native Firebase sign-in need a Capacitor source build, and Share target needs the URL shell. Clear the feature or change the project.' },
      { problem: 'Native features are greyed out or refused with the TWA shell.', fix: 'The Trusted Web Activity shell lets Chrome render the site, so no bridge exists. Switch to the Standard (standalone) shell.' },
    ],
  },
  {
    title: 'Set up the signing key',
    summary: 'Every Android app must be signed. All updates have to be signed with the same key.',
    points: [
      'WyBuild uses the repository key when it exists. Otherwise it can copy the server default key, or you can upload your own under Keystore.',
      'To upload, paste the keystore as Base64 together with the store password, key alias and key password.',
      'The build log prints the SHA-1 fingerprint of the signing certificate. Use it for Firebase Google sign-in and for Digital Asset Links.',
    ],
    tab: { id: 'settings', label: 'Open Keystore' },
    notes: [
      { problem: 'Release keystore validation failed (KEYSTORE_BAD_PASSWORD).', fix: 'The store password or alias is wrong (both are case-sensitive), or the file is damaged. Check them with keytool -list -keystore your.jks, then upload again.' },
      { problem: 'The keystore is incomplete (KEYSTORE_TRUNCATED) or the Base64 is invalid.', fix: 'The Base64 text was cut off while copying. Re-create it with base64 -w 0 your.jks and paste the entire value.' },
      { problem: 'The repository has a keystore secret but no password or alias (KEYSTORE_INCOMPLETE), or no keystore is available (NO_KEYSTORE).', fix: 'Upload the keystore again with all three values, or remove the partial secrets and let WyBuild set them up.' },
      { problem: 'Could not store the signing secrets (SECRET_WRITE_FAILED).', fix: 'Writing secrets needs admin access to the repository. Ask the owner for admin access or build from your own fork.' },
      { problem: 'You lost the keystore.', fix: 'It cannot be recovered. Installed copies and Google Play listings cannot be updated with a different key, so keep an offline backup of the file and passwords.' },
    ],
  },
  {
    title: 'Install the workflow',
    summary: 'WyBuild commits one workflow file and its helper files to the branch you choose. The build runs from that file in GitHub Actions.',
    points: [
      'Press Install workflow (or Update workflow when it is out of date). WyBuild commits the files to the selected branch and writes the signing secrets to the repository.',
      'WyBuild keeps the workflow current. If a newer version is available it is reinstalled when you start a build.',
    ],
    notes: [
      { problem: 'The WyBuild workflow is not on the branch (NO_WORKFLOW).', fix: 'Reconnect the project so the workflow is installed on that branch, or switch to the branch where it already exists.' },
      { problem: 'The workflow in the repository is outdated (WORKFLOW_OUTDATED).', fix: 'Press Build again. WyBuild reinstalls the current workflow automatically. If it keeps happening, use Update workflow.' },
      { problem: 'The workflow is committed, but GitHub says it cannot be found or run.', fix: 'Wait a few seconds for GitHub to index it and retry. Also check that Actions is enabled in the repository settings and that the branch is not protected against direct commits.' },
    ],
  },
  {
    title: 'Start the build',
    summary: 'Press Build. WyBuild reserves credits, dispatches the workflow and follows the run.',
    points: [
      'Each build reserves 3 credits, refunded automatically if the build fails or cannot be started. New accounts start with a small credit balance. WyBuild diagnosis and repair planning use separate automation credits.',
      'The build uses your GitHub Actions minutes. Public repositories are free; private repositories use your plan quota.',
      'WyBuild limits how many builds run at once per account.',
    ],
    tab: { id: 'billing', label: 'Open Automation Credits' },
    notes: [
      { problem: 'Not enough credits (INSUFFICIENT_CREDITS).', fix: 'Buy a one-time credit pack under Automation Credits. Credits do not expire.' },
      { problem: 'Concurrent build limit reached (CONCURRENCY).', fix: 'Wait for a running build to finish, then start again.' },
      { problem: 'GitHub API rate limit reached (GITHUB_RATE_LIMIT).', fix: 'Wait until the time shown in the message and retry.' },
      { problem: 'Another credit activity is updating your balance (CREDITS_BUSY).', fix: 'Retry in a few seconds.' },
    ],
  },
  {
    title: 'Follow the logs and fix failures',
    summary: 'The Logs tab shows each stage of the run live. A failed run is explained in the Errors tab.',
    points: [
      'Typical stages: authorize, check out your repository, build the web app, create the Android project, sign, verify and upload the artifact.',
      'Open a failed run in Errors to see the cause. WyBuild matches log signatures to detailed repair guidance and commits only supported deterministic integrations; unknown code failures are not guessed.',
    ],
    tab: { id: 'builds', label: 'Open Logs' },
    notes: [
      { problem: 'WyBuild did not authorize this build.', fix: 'Start builds from the WyBuild app, not from the GitHub Actions tab. If it persists, use Update workflow.' },
      { problem: 'Build diagnosis cannot identify the error.', fix: 'WyBuild uses a deterministic repair catalog. Open the failed step, share the first fatal error, and follow the suggested checks. Unknown failures are clearly marked rather than guessed.' },
      { problem: 'The build is stuck in progress for a long time.', fix: 'Open the run on GitHub and check its status. Runs older than a few hours are treated as stale; start a new build.' },
    ],
  },
  {
    title: 'Download, install and publish',
    summary: 'Finished builds produce a signed APK and/or AAB. You can download them or publish them as a GitHub Release.',
    points: [
      'Open the finished build and download the APK for testing on a phone. Allow installs from your browser or file manager when Android asks.',
      'Use the AAB for Google Play. For an app that loads a live site in a Trusted Web Activity, publish the Digital Asset Links file on your domain with the same signing fingerprint.',
      'Under Releases, choose the build, set a tag and notes, and WyBuild creates a GitHub Release with the files attached.',
    ],
    tab: { id: 'releases', label: 'Open Releases' },
    notes: [
      { problem: 'The artifact is gone or expired (ARTIFACT_GONE).', fix: 'GitHub deletes build artifacts after its retention period. Build again, and publish a release to keep the files permanently.' },
      { problem: 'A release for the tag already exists (TAG_HAS_RELEASE).', fix: 'Choose a new tag, for example by bumping the version, or edit the existing release on GitHub.' },
      { problem: 'The app opens inside a browser bar instead of full screen.', fix: 'The Digital Asset Links file on your domain does not match the package ID and signing fingerprint. Publish the correct assetlinks.json, or use the standalone shell.' },
    ],
  },
];

export const HowItWorksView: React.FC = () => {
  const { setCurrentTab } = useApp();
  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-10">
      <header>
        <h1 className="text-xl font-bold text-white">How WyBuild works</h1>
        <p className="text-sm text-slate-400 mt-1">Turn your web app into a signed Android app in nine steps. The build runs in your own GitHub Actions account and WyBuild coordinates it. Where something often goes wrong, a NOTE under the step explains the error and the fix.</p>
      </header>

      <ol className="space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-white/[.06] bg-white/[.015] p-4">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 shrink-0 rounded-full bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-white font-semibold">{s.title}</h2>
                <p className="text-sm text-slate-400 mt-1">{s.summary}</p>
                <ul className="mt-3 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-slate-300"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/70" /><span>{p}</span></li>
                  ))}
                </ul>
                {s.tab && (
                  <button type="button" onClick={() => setCurrentTab(s.tab!.id)} className="mt-3 min-h-10 px-3 rounded-lg border border-emerald-400/30 text-emerald-200 text-xs font-medium inline-flex items-center gap-2 hover:bg-emerald-400/10">
                    {s.tab.label}<ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {s.notes?.map((n) => (
                  <div key={n.problem} role="note" className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[.05] p-3 text-xs leading-relaxed">
                    <div className="flex items-center gap-1.5 font-bold tracking-wide text-amber-300"><AlertTriangle className="w-3.5 h-3.5" />NOTE</div>
                    <p className="mt-1 text-slate-200 font-medium">{n.problem}</p>
                    <p className="mt-1 text-slate-400"><span className="text-emerald-300 font-semibold">Fix: </span>{n.fix}</p>
                  </div>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-white/[.06] bg-white/[.015] p-4 flex gap-3">
        <LifeBuoy className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-400">
          <p className="text-slate-200 font-medium">Still stuck?</p>
          <p className="mt-1">Open the failed run in the Errors tab and run WyBuild diagnosis, or copy the error code in capital letters (for example NO_KEYSTORE) and match it to the notes above. Builds stay free of charge when they fail, since the reserved credits are refunded.</p>
          <button type="button" onClick={() => setCurrentTab('errors')} className="mt-3 min-h-10 px-3 rounded-lg border border-emerald-400/30 text-emerald-200 text-xs font-medium inline-flex items-center gap-2 hover:bg-emerald-400/10">Open Errors<ArrowRight className="w-3.5 h-3.5" /></button>
        </div>
      </section>
    </div>
  );
};
