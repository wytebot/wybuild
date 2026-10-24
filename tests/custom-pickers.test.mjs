import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const srcFiles = walk(path.join(root, 'src')).filter((f) => /\.(tsx|ts)$/.test(f) && !f.includes(`${path.sep}ui${path.sep}`) && !f.includes(`${path.sep}data${path.sep}`));

test('no browser-drawn pickers (select, datalist, native colour dialog) outside src/components/ui', () => {
  const offenders = [];
  for (const f of srcFiles) {
    const s = fs.readFileSync(f, 'utf8');
    if (/<select[\s>]/.test(s)) offenders.push(`${path.relative(root, f)}: <select>`);
    if (/<datalist[\s>]/.test(s) || /\blist="/.test(s)) offenders.push(`${path.relative(root, f)}: datalist`);
    if (/type="color"/.test(s)) offenders.push(`${path.relative(root, f)}: input type=color`);
  }
  assert.deepEqual(offenders, [], `Use <Select>, <ComboInput> or <ColorSwatchButton> from src/components/ui instead:\n${offenders.join('\n')}`);
});

test('shared picker sheet handles Escape, backdrop, Back gesture and focus return', () => {
  const sheet = fs.readFileSync(path.join(root, 'src/components/ui/Sheet.tsx'), 'utf8');
  for (const needle of ["'Escape'", 'popstate', 'pushState', 'wy-sheet-backdrop', 'returnFocus', 'aria-modal']) {
    assert.ok(sheet.includes(needle), `Sheet.tsx is missing ${needle}`);
  }
});

test('Select is accessible and keeps native required validation', () => {
  const sel = fs.readFileSync(path.join(root, 'src/components/ui/Select.tsx'), 'utf8');
  for (const needle of ['role="listbox"', 'role="option"', 'aria-selected', 'aria-haspopup="listbox"', 'wy-select-proxy', 'required']) {
    assert.ok(sel.includes(needle), `Select.tsx is missing ${needle}`);
  }
});

test('picker styles are present and sit above every modal (z-index 200 > 130)', () => {
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(css, /\.wy-sheet-root\{[^}]*z-index:200/);
  for (const c of ['.wy-select-trigger', '.wy-select-option', '.wy-color-grid', '.wy-combo-list']) assert.ok(css.includes(c), c);
});

test('every original select value set is still offered by its picker', () => {
  const twa = fs.readFileSync(path.join(root, 'src/components/twa/TwaView.tsx'), 'utf8');
  for (const v of ["'default'", "'portrait'", "'landscape'", "'both'", "'apk'", "'aab'", "'none'", "'custom-tab'", "'bearer-handoff'", "'rest_api'", "'clipboard'", "'contacts'"]) {
    assert.ok(twa.includes(`value: ${v}`), `TwaView lost option ${v}`);
  }
  for (const [file, vals] of [
    ['src/components/projects/ProjectsView.tsx', ["'split-per-abi'", "'appbundle'", "'profile'", "'3.29.0'", "'master'"]],
    ['src/components/settings/GitHubWebhooksSection.tsx', ["'split-per-abi'", "'appbundle'", "'debug'"]],
  ]) {
    const s = fs.readFileSync(path.join(root, file), 'utf8');
    for (const v of vals) assert.ok(s.includes(`value: ${v}`), `${file} lost option ${v}`);
  }
});
