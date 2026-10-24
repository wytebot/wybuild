# Custom pickers (v56)

Every browser-drawn picker was replaced with WyBuild's own components in `src/components/ui/`:

| Was | Now | Used in |
|---|---|---|
| `<select>` (25) | `Select` | Web → Android panel (repo, sign-in mode, integration, orientation, min Android, output), Quick build, Projects, Webhooks, Keystore form, Releases, Dev tools |
| `<input type="color">` (2) | `ColorSwatchButton` | Theme color, Background (splash) color |
| `<input list>` + `<datalist>` | `ComboInput` | Release tag suggestions |

Behaviour: bottom sheet on phones, centered card on wide screens; current value highlighted; search box appears when there are more than 8 options; closes on Escape, backdrop tap, the ✕ button and the Android Back gesture (Back closes the sheet instead of leaving the screen); focus returns to the field; `required` pickers still block form submit when empty.

Rule for future code: do not add `<select>`, `<datalist>` or `type="color"` outside `src/components/ui/` — `tests/custom-pickers.test.mjs` fails if you do.

Not changed: `window.confirm()` / `window.alert()` (two confirmations for replacing a signing key / rotating the Drive folder, one TWA warning) and `<input type="file">` (the OS file chooser is required). Say if you want those themed too.
