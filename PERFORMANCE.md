# WyBuild performance changes (v37)

Server (`api/index.js`, `lib/kv.js`)
- `runs` polling no longer writes a database record on every poll; the push-user registration is repeated at most every 15 minutes per user/repo. This also reduces Firestore/Supabase quota use.
- `repos` loads its three GitHub pages in parallel and caches the result for 20 s per user (`?fresh=1` bypasses it).
- Build detail loads the run, jobs and artifacts together instead of one after another, and finished builds with no warnings (and a final signing state) are cached for 90 s, so reopening a build no longer re-downloads every job log.
- Concurrent reads of the same KV key share one round trip. Nothing is cached after the read finishes, and writes cancel sharing for that key, so credits and locks stay exact.

Frontend
- Every screen except the Dashboard is code-split with `React.lazy` and preloaded when the browser is idle; modals mount only when opened. The first download is smaller and tab switches are instant once preloaded.
- Identical GET requests that are in flight share one network call.
- Hidden tabs no longer poll build logs, and returning to the tab refreshes runs immediately. Overlapping poll ticks are prevented.
- Build target set to `es2020`.

Not measured: I could not run a production build or real GitHub traffic in this environment, so no timings are claimed.
