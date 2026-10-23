"""Regression test for manifest matching used by capacitor-finalize.py."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class FinalizerManifestTests(unittest.TestCase):
    def test_share_target_regex_matches_main_activity(self):
        source = (ROOT / 'workflow/wybuild/capacitor-finalize.py').read_text(encoding='utf-8')
        # Ensure the production share-target matcher uses a real regex word boundary,
        # not the old raw-string `\\b` that matched a literal backslash.
        self.assertIn("re.search(r'<activity\\b(?=[^>]*android:name=\"[^\"]*MainActivity\")[^>]*>', manifest_text)", source)
        manifest = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name="com.example.MainActivity" android:exported="true"></activity></application></manifest>'''
        match = re.search(r'<activity\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>', manifest)
        self.assertIsNotNone(match)
        self.assertIn('com.example.MainActivity', match.group(0))

    def test_workflow_copies_are_synced_except_app_url_placeholder(self):
        template = (ROOT / 'workflow/wybuild-twa.yml').read_text(encoding='utf-8')
        installed = (ROOT / '.github/workflows/wybuild-twa.yml').read_text(encoding='utf-8')
        self.assertEqual(template.replace('__WYBUILD_APP_URL__', 'https://wybuild-black.vercel.app'), installed)

    def test_custom_scheme_return_filter_is_generated_and_blocked_schemes_are_checked(self):
        source = (ROOT / 'workflow/wybuild/capacitor-finalize.py').read_text(encoding='utf-8')
        self.assertIn('Custom-scheme return path enabled', source)
        self.assertIn('blocked = {', source)
        self.assertIn('android:scheme=\"{scheme}\"', source)

    def test_bridge_and_finalizer_template_copies_match(self):
        self.assertEqual((ROOT / 'workflow/wybuild/capacitor-bridge.entry.js').read_bytes(), (ROOT / '.github/wybuild/capacitor-bridge.entry.js').read_bytes())
        self.assertEqual((ROOT / 'workflow/wybuild/capacitor-finalize.py').read_bytes(), (ROOT / '.github/wybuild/capacitor-finalize.py').read_bytes())
        self.assertEqual((ROOT / 'workflow/wybuild/compat-analyzer.mjs').read_bytes(), (ROOT / '.github/wybuild/compat-analyzer.mjs').read_bytes())
        self.assertEqual((ROOT / 'workflow/wybuild/wybuild-smoke.mjs').read_bytes(), (ROOT / '.github/wybuild/wybuild-smoke.mjs').read_bytes())
        self.assertEqual((ROOT / 'workflow/wybuild/android-startup-diagnostics.js').read_bytes(), (ROOT / '.github/wybuild/android-startup-diagnostics.js').read_bytes())

if __name__ == '__main__':
    unittest.main()
