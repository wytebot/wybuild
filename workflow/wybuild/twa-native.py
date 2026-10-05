#!/usr/bin/env python3
"""WyBuild native features for the generated Bubblewrap TWA project.

Runs after `twa-generate.mjs` and before `bubblewrap build`. Everything here is idempotent and
fails loudly: a feature the developer switched on must really be inside the APK, not silently skipped.

  python3 twa-native.py <generated-project-dir>
"""
import json, os, re, shutil, subprocess, sys

proj = sys.argv[1]
out = os.environ["WB_OUT"]
cfg = json.load(open(out + "/twa-resolved.json"))
extras = json.load(open(out + "/wybuild-extras.json")) if os.path.exists(out + "/wybuild-extras.json") else {}
manifest_path = proj + "/app/src/main/AndroidManifest.xml"
xml = open(manifest_path, encoding="utf8").read()
applied, notes = [], []


def perm(name):
    return name if "." in name else "android.permission." + name


def has_perm(name):
    return re.search(r'<uses-permission[^>]+android:name="%s"' % re.escape(name), xml) is not None


def add_before_application(block):
    global xml
    xml, n = re.subn(r"(<application\b)", lambda m: block + "    " + m.group(1), xml, count=1)
    if not n:
        raise SystemExit("AndroidManifest.xml has no <application> element")


# ---------------------------------------------------------------- 1. permissions
wanted = [perm(p) for p in cfg.get("androidPermissions", [])]
features = cfg.get("features", {}) or {}
if cfg.get("enableNotifications"):
    # Android 13+ will not show ANY notification, and cannot even ask, unless the app declares this
    wanted.append("android.permission.POST_NOTIFICATIONS")
if (features.get("locationDelegation") or {}).get("enabled"):
    # Android 12+ lets users pick "approximate"; the app must declare both for the prompt to offer it
    wanted += ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"]
block = ""
for p in dict.fromkeys(wanted):
    if not re.fullmatch(r"[A-Za-z0-9_.]+", p):
        raise SystemExit("bad permission: " + p)
    if not has_perm(p):
        block += '    <uses-permission android:name="%s" />\n' % p
        applied.append("permission " + p.rsplit(".", 1)[-1])

# Camera / microphone: without these <uses-feature required="false"> lines Google Play hides the app
# from every phone that lacks the hardware, because the permission implies the feature is required.
for permission, feature_names in (
    ("android.permission.CAMERA", ["android.hardware.camera", "android.hardware.camera.autofocus"]),
    ("android.permission.RECORD_AUDIO", ["android.hardware.microphone"]),
    ("android.permission.ACCESS_FINE_LOCATION", ["android.hardware.location.gps"]),
):
    if permission in wanted:
        for feat in feature_names:
            if feat not in xml:
                block += '    <uses-feature android:name="%s" android:required="false" />\n' % feat
if block:
    add_before_application(block)

# ---------------------------------------------------------------- 2. notifications (delegation)
if cfg.get("enableNotifications"):
    # Web Push -> Chrome -> this app. The service must exist and be enabled, or notifications fall back to Chrome's own.
    if "DelegationService" not in xml:
        raise SystemExit("Notifications are on, but Bubblewrap did not generate DelegationService. Update bubblewrap_version.")
    if "NotificationPermissionRequestActivity" not in xml:
        add = '        <activity android:name="com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity" />\n'
        xml = xml.replace("</application>", add + "    </application>", 1)
    applied.append("notification delegation (web push shows as native Android notifications)")

# ---------------------------------------------------------------- 3. fullscreen / immersive
want = {"fullscreen": "immersive", "fullscreen-sticky": "sticky-immersive"}.get(cfg.get("display"))
if want:
    meta = '\n            <meta-data android:name="android.support.customtabs.trusted.DISPLAY_MODE" android:value="%s" />' % want
    if "trusted.DISPLAY_MODE" in xml:
        # normalise whatever is there to the mode that was asked for
        xml = re.sub(r'(android:name="android\.support\.customtabs\.trusted\.DISPLAY_MODE"\s+android:value=")[^"]*(")', r"\g<1>%s\g<2>" % want, xml)
    else:
        xml, n = re.subn(r'(<activity\b(?:(?!/>)[^>])*LauncherActivity(?:(?!/>)[^>])*>)', lambda m: m.group(1) + meta, xml, count=1)
        if not n:
            raise SystemExit("Could not add the fullscreen display mode: LauncherActivity not found in AndroidManifest.xml")
    applied.append("display=" + want)
    notes.append("Fullscreen hides the address bar only while Android can verify your site (Digital Asset Links). WyBuild checks this after the build.")

# ---------------------------------------------------------------- 4. predictive back (Android 13+)
if extras.get("predictiveBack"):
    gradle = ""
    for g in ("app/build.gradle", "app/build.gradle.kts"):
        if os.path.exists(proj + "/" + g):
            gradle += open(proj + "/" + g, encoding="utf8").read()
    m = re.search(r"compileSdk(?:Version)?\s*(?:=\s*)?(\d+)", gradle)
    if m and int(m.group(1)) < 33:
        print("::warning::Predictive back skipped: this project compiles against API %s (needs 33+)." % m.group(1))
    elif "enableOnBackInvokedCallback" not in xml:
        xml = re.sub(r"<application\b", '<application android:enableOnBackInvokedCallback="true"', xml, count=1)
        applied.append("predictive-back")

# ---------------------------------------------------------------- 4b. link handling
# Rules come from the "Link handling" panel: internal (stay in the app), external (system browser), other (hand to Android).
link_rules = [r for r in (extras.get("linkRules") or []) if isinstance(r, dict)]
own_host = (cfg.get("host") or "").split(":")[0].lower()
deep_hosts = []
for r in link_rules:
    if r.get("kind") != "host" or r.get("mode") != "internal":
        continue
    host = ("*." if r.get("wildcard") else "") + r["host"]
    if not re.fullmatch(r"(\*\.)?[a-z0-9.-]+", host) or not re.fullmatch(r"(/[A-Za-z0-9._~%/-]*)?", r.get("path", "")):
        raise SystemExit("bad link rule: " + host + r.get("path", ""))
    if host.replace("www.", "", 1) == own_host.replace("www.", "", 1) and not r.get("path"):
        continue  # the app's own site already opens in the app
    deep_hosts.append((host, r.get("path", "")))
    if r.get("wildcard"):
        deep_hosts.append((r["host"], r.get("path", "")))  # Android's *.example.com does not match example.com itself
deep_hosts = list(dict.fromkeys(deep_hosts))
if deep_hosts:
    filters = ""
    for host, path in deep_hosts:
        key = 'android:host="%s"' % host
        if key in xml and ('android:pathPrefix="%s"' % path in xml if path else True):
            continue
        filters += (
            '            <intent-filter android:autoVerify="true">\n'
            '                <action android:name="android.intent.action.VIEW" />\n'
            '                <category android:name="android.intent.category.DEFAULT" />\n'
            '                <category android:name="android.intent.category.BROWSABLE" />\n'
            '                <data android:scheme="https" android:host="%s"%s />\n'
            '            </intent-filter>\n' % (host, (' android:pathPrefix="%s"' % path) if path else "")
        )
    if filters:
        start = re.search(r'<activity\b(?:(?!/>)[^>])*LauncherActivity(?:(?!/>)[^>])*>', xml)
        if not start:
            raise SystemExit("Could not add link handling: LauncherActivity not found in AndroidManifest.xml")
        end = xml.find("</activity>", start.end())
        if end == -1:
            raise SystemExit("Could not add link handling: LauncherActivity is not closed in AndroidManifest.xml")
        line_start = xml.rfind("\n", 0, end) + 1  # insert on its own lines, keeping the closing tag indented
        xml = xml[:line_start] + filters + xml[line_start:]
        applied.append("links to %s open in the app (%d domain%s)" % (", ".join(h + p for h, p in deep_hosts), len(deep_hosts), "" if len(deep_hosts) == 1 else "s"))
    if any(h.startswith("*.") for h, _ in deep_hosts):
        notes.append("Wildcard domains open the app only after Android verifies the root domain: publish assetlinks.json on it too. Wildcards cannot be trusted origins, so list each subdomain you want without the address bar.")
n_ext = sum(1 for r in link_rules if r.get("mode") == "external")
n_other = sum(1 for r in link_rules if r.get("mode") == "other")
if n_ext or n_other:
    applied.append("link rules for the website: %d external, %d handed to Android (wybuild-links.js)" % (n_ext, n_other))
    notes.append("External / Other link rules are applied by wybuild-links.js on your website: add it to your site (see NATIVE-FEATURES.md in the build artifact). A Trusted Web Activity cannot intercept those links natively.")

open(manifest_path, "w", encoding="utf8").write(xml)
assert "<application" in xml


# ---------------------------------------------------------------- 5. status-bar notification icon
def magick():
    return shutil.which("magick") or shutil.which("convert")


def silhouette(path):
    """Android paints the small notification icon in a single colour. A full-colour icon turns into a white square."""
    tool = magick()
    if not tool or not os.path.exists(path):
        return False
    base = [tool]
    probe = subprocess.run(base + [path, "-format", "%[opaque]", "info:"], capture_output=True, text=True)
    tmp = path + ".tmp.png"
    if probe.stdout.strip().lower() == "true":
        # opaque square: treat the colour of the top-left pixel as background and keep only the logo
        bg = subprocess.run(base + [path, "-format", "%[pixel:p{0,0}]", "info:"], capture_output=True, text=True).stdout.strip()
        r = subprocess.run(base + [path, "-alpha", "set", "-fuzz", "18%", "-transparent", bg, "-channel", "RGB", "-evaluate", "set", "100%", "+channel", tmp])
    else:
        r = subprocess.run(base + [path, "-alpha", "set", "-channel", "RGB", "-evaluate", "set", "100%", "+channel", tmp])
    if r.returncode != 0 or not os.path.exists(tmp):
        return False
    os.replace(tmp, path)
    return True


if cfg.get("enableNotifications") and not cfg.get("monochromeIconUrl"):
    done = 0
    for d in os.listdir(proj + "/app/src/main/res"):
        f = "%s/app/src/main/res/%s/ic_notification_icon.png" % (proj, d)
        if d.startswith("drawable") and os.path.exists(f) and silhouette(f):
            done += 1
    if done:
        applied.append("white notification icon (%d sizes)" % done)
    else:
        notes.append("Add a monochrome icon to your web manifest: otherwise Android may show a plain square in the status bar for notifications.")

# ---------------------------------------------------------------- 6. developer kit for web push (ships in the build artifact)
kit = out + "/dist/native"
os.makedirs(kit, exist_ok=True)
host = cfg.get("host", "")
pkg = cfg.get("packageId", "")

open(kit + "/wybuild-push.js", "w", encoding="utf8").write(r"""/*! WyBuild push helper. Add to your website: <script src="/wybuild-push.js" defer></script>
 * Works in the Android app (Trusted Web Activity) AND in the normal browser.
 * In the app, the browser's push notification is delegated to Android, so users see a real native notification
 * with your app icon, name and notification channel; tapping it opens your app on the url you send.
 *
 *   WyBuildPush.enable({ vapidPublicKey: 'B...', endpoint: '/api/push/subscribe' })   // call from a button tap
 */
(function () {
  var KEY = 'wybuild_in_app';
  function inApp() {
    try {
      if (document.referrer && document.referrer.indexOf('android-app://') === 0) localStorage.setItem(KEY, '1');
      return localStorage.getItem(KEY) === '1' || (window.matchMedia && matchMedia('(display-mode: fullscreen)').matches);
    } catch (e) { return false; }
  }
  function b64ToBytes(s) {
    var p = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, function (c) { return c.charCodeAt(0); });
  }
  var api = {
    isApp: inApp,
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    permission: function () { return 'Notification' in window ? Notification.permission : 'unsupported'; },
    /** Ask permission (Android shows its own prompt in the app), subscribe, and send the subscription to your server. */
    enable: function (opts) {
      opts = opts || {};
      if (!api.supported()) return Promise.reject(new Error('Push is not supported here'));
      if (!opts.vapidPublicKey) return Promise.reject(new Error('vapidPublicKey is required'));
      return navigator.serviceWorker.register(opts.serviceWorker || '/sw.js').then(function () {
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        return Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error('Notifications were not allowed');
          return reg.pushManager.getSubscription().then(function (existing) {
            return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(opts.vapidPublicKey) });
          });
        });
      }).then(function (sub) {
        var body = JSON.stringify({ subscription: sub.toJSON(), app: inApp(), platform: inApp() ? 'android-app' : 'web' });
        if (!opts.endpoint) return sub;
        return fetch(opts.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body })
          .then(function (r) { if (!r.ok) throw new Error('Your server rejected the subscription (' + r.status + ')'); return sub; });
      });
    },
    disable: function (opts) {
      return navigator.serviceWorker.getRegistration().then(function (reg) {
        return reg && reg.pushManager.getSubscription();
      }).then(function (sub) {
        if (!sub) return false;
        var ep = sub.endpoint;
        return sub.unsubscribe().then(function () {
          if (opts && opts.endpoint) return fetch(opts.endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ endpoint: ep }) }).then(function () { return true; });
          return true;
        });
      });
    }
  };
  window.WyBuildPush = api;
})();
""")

open(kit + "/sw.js", "w", encoding="utf8").write(r"""/* Minimal push service worker. Serve at /sw.js (or change the path in WyBuildPush.enable).
 * Merge into your own service worker if you already have one. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: event.data && event.data.text() }; }
  var title = data.title || 'New message';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',        // large icon
    badge: data.badge || '/badge-72.png',      // small monochrome icon (the app's own is used inside the Android app)
    image: data.image,
    tag: data.tag,                              // same tag = replace instead of stacking
    renotify: !!data.tag,
    data: { url: data.url || '/' },
    actions: data.actions || []
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) { list[i].navigate(url); return list[i].focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
""")

open(kit + "/NATIVE-FEATURES.md", "w", encoding="utf8").write("""# Native features in this build

Package: `%(pkg)s`   Site: `https://%(host)s`

## Push notifications (native on Android)
The app is a Trusted Web Activity with **notification delegation**: when your site shows a web push notification,
Chrome hands it to this app, and Android shows it as a native notification (your app icon and name, its own channel,
tap opens the app). `POST_NOTIFICATIONS` is declared, so Android 13+ asks the user once, with the system prompt.

1. Generate VAPID keys once: `npx web-push generate-vapid-keys`
2. Put `wybuild-push.js` and `sw.js` from this folder at your site root.
3. Add `<script src="/wybuild-push.js" defer></script>` and call, from a button the user taps:
   `WyBuildPush.enable({ vapidPublicKey: '<PUBLIC KEY>', endpoint: '/api/push/subscribe' })`
4. On your server store the posted `subscription`, then send with the `web-push` library:
   `webpush.sendNotification(subscription, JSON.stringify({ title, body, url: '/orders/42', tag: 'order-42' }), { TTL: 86400 })`

Needs: the site verified for this app (see below), HTTPS, and a service worker.
Use `tag` to replace instead of stack, and `url` to deep-link inside the app.

## Fullscreen
Display mode in this build: `%(display)s`. The status bar and navigation bar are hidden by Android itself.
The browser address bar stays away only while Android can verify that your site trusts this app: publish
`assetlinks.json` (in this artifact) at `https://%(host)s/.well-known/assetlinks.json` with no redirect.
If the app was installed from Google Play, also add the Play app-signing SHA-256 in WyBuild.

## Others
Camera, microphone and location are declared with optional hardware so Google Play does not hide your app
from phones without them. The website still asks the user at the moment it uses them.
""" % {"pkg": pkg, "host": host, "display": cfg.get("display", "standalone")})

# ---------------------------------------------------------------- 7. link handling kit (ships in the build artifact)
def js_rule(r):
    if r.get("kind") == "scheme":
        return {"k": "s", "s": r["scheme"], "m": r["mode"]}
    return {"k": "h", "h": r["host"], "w": bool(r.get("wildcard")), "p": r.get("path", ""), "m": r["mode"]}

own = [own_host] if own_host else []
for o in cfg.get("additionalTrustedOrigins", []):
    h = re.sub(r"^https?://", "", str(o)).strip("/").split(":")[0].lower()
    if h and h not in own:
        own.append(h)
open(kit + "/wybuild-links.json", "w", encoding="utf8").write(json.dumps({"ownHosts": own, "rules": link_rules}, indent=2))
links_js = r"""/*! WyBuild link handling. Add to your website: <script src="/wybuild-links.js" defer></script>
 * Decides what happens when a link is tapped inside the Android app (and the installed PWA):
 *   internal  stays in the app            external  opens in the phone's browser
 *   other     handed to Android (dialer, mail, WhatsApp, Maps ...)
 * Links on your own site always stay internal. The first matching rule wins. "*.domain" covers the domain and its
 * subdomains. Plain browsers are left alone.
 * Generated from the rules in WyBuild: rebuild to change them (wybuild-links.json lists them).
 */
(function () {
  var OWN = __OWN__;
  var RULES = __RULES__;
  var KEY = 'wybuild_in_app';
  var nativeOpen = window.open;
  function norm(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function inApp() {
    try {
      if (document.referrer && document.referrer.indexOf('android-app://') === 0) localStorage.setItem(KEY, '1');
      if (localStorage.getItem(KEY) === '1') return true;
    } catch (e) {}
    return !!(window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: minimal-ui)').matches));
  }
  function parse(url) { try { return new URL(String(url), location.href); } catch (e) { return null; } }
  function resolve(url) {
    var u = parse(url); if (!u) return null;
    var scheme = u.protocol.replace(':', '').toLowerCase();
    var web = scheme === 'http' || scheme === 'https';
    var h = norm(u.hostname);
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.k === 's') { if (!web && r.s === scheme) return r.m; continue; }
      if (!web) continue;
      var rh = norm(r.h);
      var hostOk = h === rh || (r.w && h.slice(-(rh.length + 1)) === '.' + rh);
      if (hostOk && (!r.p || u.pathname.indexOf(r.p) === 0)) return r.m;
    }
    if (web && OWN.indexOf(h) !== -1) return 'internal';
    return null;
  }
  function viaAndroid(u) {
    return 'intent://' + u.host + u.pathname + u.search + u.hash + '#Intent;scheme=' + u.protocol.replace(':', '') +
      ';action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end';
  }
  function go(url, mode) {
    var u = parse(url); if (!u) return;
    var web = u.protocol === 'http:' || u.protocol === 'https:';
    if (mode === 'internal') { location.assign(u.href); return; }
    if (!inApp()) { if (web) nativeOpen.call(window, u.href, '_blank', 'noopener'); else location.href = u.href; return; }
    location.href = web ? viaAndroid(u) : u.href;
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var mode = resolve(a.href); if (!mode) return;
    var t = a.getAttribute('target');
    if (mode === 'internal') {
      if (t && t !== '_self' && inApp()) { e.preventDefault(); location.assign(a.href); }  // no stray blank tab for your own pages
      return;
    }
    if (mode === 'other' && !inApp() && !(t && t !== '_self')) return;  // in a browser tab tel:, mailto: etc. already behave normally
    e.preventDefault();
    go(a.href, mode);
  }, true);
  window.open = function (url) {
    if (url) {
      var mode = resolve(url);
      if (mode === 'external' || mode === 'other') { go(url, mode); return null; }
      if (mode === 'internal' && inApp()) { location.assign(String(url)); return null; }
    }
    return nativeOpen.apply(window, arguments);
  };
  window.WyBuildLinks = { rules: RULES, ownHosts: OWN, isApp: inApp, resolve: resolve, open: function (url) { go(url, resolve(url) || 'internal'); } };
})();
"""
open(kit + "/wybuild-links.js", "w", encoding="utf8").write(
    links_js.replace("__OWN__", json.dumps(own)).replace("__RULES__", json.dumps([js_rule(r) for r in link_rules]))
)
doc = "\n## Link handling\n"
if link_rules:
    doc += "Rules in this build (first match wins; your own site always stays internal; `*.domain` covers the domain and its subdomains):\n\n"
    for r in link_rules:
        who = r["scheme"] + ":" if r.get("kind") == "scheme" else ("*." if r.get("wildcard") else "") + r["host"] + r.get("path", "")
        doc += "- `%s` -> **%s**\n" % (who, {"internal": "internal (stays in the app)", "external": "external (phone browser)", "other": "other (handed to Android)"}[r["mode"]])
    doc += "\n"
else:
    doc += "No link rules were set, so links behave like a normal Trusted Web Activity: your site stays in the app, other sites open in an in-app browser tab.\n\n"
doc += (
    "- **Internal** domains are added as trusted origins and as verified app links, so tapping a link to them anywhere on the phone opens this app.\n"
    "  Publish `assetlinks.json` (in this artifact) at `/.well-known/assetlinks.json` on **every** internal domain, with no redirect.\n"
    "- **External** and **Other** rules are applied by `wybuild-links.js`: put it at your site root and add\n"
    "  `<script src=\"/wybuild-links.js\" defer></script>` to every page. A Trusted Web Activity cannot intercept those taps natively.\n"
    "  Without the script, those links open in Chrome's in-app tab (external sites) or are handled by Chrome (tel:, mailto:).\n"
    "- `WyBuildLinks.open(url)` applies the same rules from your own JavaScript.\n"
)
open(kit + "/NATIVE-FEATURES.md", "a", encoding="utf8").write(doc)

# ---------------------------------------------------------------- summary
print("Android features applied:", ", ".join(applied) or "none")
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a") as f:
        f.write("### Android features baked into this build\n- " + ("\n- ".join(applied) or "none") + "\n")
        for n in notes:
            f.write("\n> " + n + "\n")
