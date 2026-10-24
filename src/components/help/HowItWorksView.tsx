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
      'Native features are opt-in. For Capacitor source builds, selecting Pull to refresh installs and enables a built-in reload gesture even if your website has no refresh-specific code. Your site can replace the default reload with WyBuildNative.pullToRefresh.enable({ onRefresh }). Pure Trusted Web Activity builds do not have the Capacitor bridge, so Capacitor-only features are unavailable there.',
      'Auto-wired features (v49): when you tick Native Share Sheet, Native Downloads, Scheduled Local Notifications (or Local reminders), Haptic Feedback, Network Status Events, Device Information, Deep Link Handling or Edge swipe to go back, WyBuild also connects the standard web APIs your site already uses (navigator.share, download links, the Notification API, navigator.vibrate, navigator.onLine, navigator.getBattery, links to your own address, history back) to the Android feature. Your site code does not need to change, and nothing is connected for features you did not tick. Features that need your own server or logic (Firebase sign-in, remote push, biometric unlock, incoming Share Target, app-file access) still need a call from your site code.',
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
      'Each Web → Android build reserves 5 credits. Failed or undispatched builds are intended to be refunded automatically; check the credit history if a run fails. Native-feature setup actions and package/version edits may cost additional credits when changed.',
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
    summary: 'The Logs tab shows each stage of the run. Read it after successful builds too: warnings may reveal a backend or native-feature issue that only appears at runtime.',
    points: [
      'Typical stages: authorize, check out your repository, build the web app, create the Android project, sign, verify and upload the artifact.',
      'Open a failed run in Errors to see the cause. WyBuild matches log signatures to detailed repair guidance and commits only supported deterministic integrations; unknown code failures are not guessed.',
      'A successful status is not a runtime test. Review warnings, then install and test the APK on a real device before publishing.',
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


const ARCHITECTURE_GUIDES = [
  {
    title: 'Standalone APK: best web-app architecture',
    badge: 'Recommended when you need native features',
    body: 'WyBuild packages your built web assets inside the APK using Capacitor. The app should start from local bundled files; do not make the app shell depend on your live website loading first.',
    points: [
      'Use a production build that emits static browser assets (HTML, CSS and JavaScript). For Next.js, use a compatible static export when your app can be static; for Vite/React, build the dist folder. Follow your framework’s own static-export limits.',
      'Keep APIs on a public HTTPS backend. Call your API using an explicit production API base URL, CORS allow-list the app/site origins you actually use, and never put service-account keys, private API keys or database admin credentials in frontend code.',
      'Do not assume server-side routes, server actions, filesystem access, Node-only packages, or a same-origin /api endpoint will magically run inside an APK. Move server work to a deployed backend and configure its URL.',
      'Use OAuth flows that support Android redirects/deep links or a supported native sign-in plugin. Test refresh tokens, cookie/SameSite behaviour, CORS, file uploads/downloads, payments and push notifications on a real device.',
      'Use IndexedDB or Capacitor Preferences for small local/offline state; keep authoritative user data and secrets on the backend. Plan offline and network-error states instead of assuming a permanent connection.'
    ]
  },
  {
    title: 'TWA: best architecture and requirements',
    badge: 'Your website remains the app',
    body: 'A Trusted Web Activity opens your live HTTPS PWA in a browser-backed full-screen experience. Unlike a standalone Capacitor APK, the website and its server-side routes remain online dependencies.',
    points: [
      'Use a reliable HTTPS website with a valid Web App Manifest, correctly sized icons, a service worker where appropriate, and responsive mobile UI.',
      'Keep backend routes deployed and reachable over HTTPS. Test authentication cookies, CORS, redirects, third-party providers and payment returns in Chrome on Android.',
      'Publish /.well-known/assetlinks.json for the exact package ID and signing-certificate SHA-256 fingerprint. Without a matching Digital Asset Links relationship, Chrome may show browser UI.',
      'TWA does not automatically gain arbitrary Android APIs. If you need native plugins, automatic native refresh gestures, custom file pickers or native callbacks, choose the standalone shell and select the supported features in WyBuild.',
      'Assume a TWA needs internet access to load the site. A service worker can improve resilience but does not make dynamic backend operations available offline.'
    ]
  },
  {
    title: 'Native features are baked into the build',
    badge: 'Select features before building',
    body: 'WyBuild should generate and package the native bridge and Android declarations for supported features you select. You should not have to commit a custom native plugin implementation yourself just to make a selected built-in feature exist.',
    points: [
      'Feature selection adds the corresponding bridge/native implementation and required Android manifest declarations where supported. Permissions are not a substitute for writing your app’s business logic.',
      'In a Capacitor source build, selecting Pull to refresh adds and enables a built-in gesture that reloads the current page, even when your app did not implement it. If your app needs a data-only refresh, your site can override the default with WyBuildNative.pullToRefresh.enable({ onRefresh }). This does not make pull-to-refresh available in pure TWA mode.',
      'Some features still need app-side calls or provider setup: for example, push notifications need Firebase configuration and a server that sends messages; camera/location use must be requested by the page; OAuth needs a compatible provider setup.',
      'Native feature APIs are available in the standalone Capacitor shell, not a plain TWA. Unsupported combinations should fail validation with a clear explanation rather than silently producing a featureless APK.'
    ]
  },
  {
    title: 'Always read build logs — even after success',
    badge: 'Prevent problems before release',
    body: 'A green build means the workflow completed, not that every backend flow or Android feature works correctly. Warnings can point to failures that appear later on a user’s phone.',
    points: [
      'After every build, open Logs and inspect warnings as well as errors. Look for missing environment variables, skipped integrations, fallback engine selection, asset-link mismatches, missing Firebase configuration, deprecated APIs and compatibility warnings.',
      'For failed builds, open the first failing step and read the first meaningful error above the final summary. The last line often only says that a command failed.',
      'Install the APK on a real Android device and test login/logout, API calls, file picking, uploads/downloads, notifications, refresh gestures, deep links, back navigation and offline/network recovery.',
      'Before publishing an update, check package ID, version name/code, signing fingerprint and release artifacts. Keep a known-good build available for rollback.'
    ]
  },
  {
    title: 'Credits: what should be charged again?',
    badge: 'Avoid paying twice for unchanged setup',
    body: 'The server charges setup/integration credits only when a feature or permission is new compared with that account’s last accepted build configuration. Rebuilding unchanged settings does not charge those setup credits again. The server—not the UI—decides the difference and reserves the credits.',
    points: [
      'The first build normally includes the build charge plus any package/version edits and newly selected native-feature or permission setup charges. A version edit is charged when you change the saved version name, not merely because you rebuild.',
      'Later builds should charge the build charge and any actual version edit only. Setup credits apply only to features or permissions not already included in the project’s saved configuration.',
      'Previously selected features and permissions are compared on the server against the last accepted build configuration for that account and repository; they are not charged again just because the user rebuilds.',
      'New feature and permission costs are reserved when you start the build, not when you tap a checkbox. Removing a feature does not refund a previous setup charge. Failed dispatch/setup refunds the full reservation; a later failed Android build refunds the 5 build credits, while setup charges remain because that configuration was accepted for the build.'
    ]
  }
];

export const HowItWorksView: React.FC = () => {
  const { setCurrentTab } = useApp();
  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-10">
      <header>
        <h1 className="text-xl font-bold text-white">How WyBuild works</h1>
        <p className="text-sm text-slate-400 mt-1">Turn your web app into a signed Android app in nine steps. The build runs in your own GitHub Actions account and WyBuild coordinates it. Where something often goes wrong, a NOTE under the step explains the error and the fix.</p>
      </header>

      <section className="space-y-3" aria-label="Architecture and build guidance">
        {ARCHITECTURE_GUIDES.map((guide) => (
          <article key={guide.title} className="rounded-xl border border-emerald-400/20 bg-emerald-400/[.035] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-white font-semibold">{guide.title}</h2>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200">{guide.badge}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{guide.body}</p>
            <ul className="mt-3 space-y-2">
              {guide.points.map((point) => <li key={point} className="flex gap-2 text-sm leading-relaxed text-slate-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400/80"/><span>{point}</span></li>)}
            </ul>
          </article>
        ))}
      </section>

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
