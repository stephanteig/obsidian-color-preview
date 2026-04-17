# CLAUDE.md — Color Preview Plugin

This file provides guidance to Claude Code when working in this directory.

## Project Overview

**Color Preview** is an Obsidian community plugin that renders color swatches from hex codes.
Repo: `https://github.com/stephanteig/obsidian-color-preview`
Community plugin PR: `obsidianmd/obsidian-releases#12013` (under review)

## Tech Stack

- **Language:** TypeScript 4.7, compiled with esbuild
- **Runtime:** Obsidian Plugin API + CodeMirror 6
- **Key CM6 APIs:** `ViewPlugin`, `WidgetType`, `Decoration`, `DecorationSet`, `RangeSetBuilder`
- **Build:** `npm run build` → runs `tsc --noEmit` then `esbuild.config.mjs production`
- **Lint:** `npx eslint main.ts` using `eslint-plugin-obsidianmd` (recommended config in `eslint.config.mjs`)

## Source Files

| File | Purpose |
|---|---|
| `main.ts` | Entire plugin source — settings, renderers, commands, CM6 extensions |
| `styles.css` | All plugin CSS — cards, palette, inline dots, modal, notice |
| `manifest.json` | Plugin metadata — keep `version` in sync with git tags |
| `esbuild.config.mjs` | Build config — externalises Obsidian and CM6 packages |
| `eslint.config.mjs` | ESLint config using obsidianmd recommended rules |

## Deploy Workflow

After any change:
```bash
npm run build
cp main.js "/Users/stephanteig/Library/Mobile Documents/iCloud~md~obsidian/Documents/Stephan MacbookPro/.obsidian/plugins/color-preview/main.js"
```
Then commit, push, and tag to trigger the GitHub Actions release.

## Release Workflow

```bash
# Bump manifest.json version, then:
git add . && git commit -m "chore: bump version to X.Y.Z"
git push origin main
git tag X.Y.Z && git push origin X.Y.Z
# → GitHub Actions builds and attaches main.js, manifest.json, styles.css to the release
```

## Key Architecture Notes

### Two rendering modes
- **Live Preview (CM6):** `buildInlineDotExtension()` — a `ViewPlugin` with `WidgetType` decorations inserts colored dot widgets as the user types.
- **Reading view:** `registerMarkdownPostProcessor` → `addInlineHexPreviews()` walks the rendered DOM.
- **Code blocks:** `registerMarkdownCodeBlockProcessor("color")` and `("palette")` handle fenced blocks in both modes.

### Click-to-edit
- Desktop: hidden `<input type="color">` + `.addClass("cp-hidden-picker")` CSS class
- Mobile (`Platform.isMobile`): `QuickHexModal` pre-filled with current hex
- Reading view uses `ctx.getSectionInfo(el)` + `app.vault.modify()`; Live Preview uses `editor.replaceRange()`

### Paste detection
CM6 `EditorView.domEventHandlers({ paste: ... })` via `registerEditorExtension` — works on both desktop and iOS (document-level listeners are unreliable in WKWebView).

### @codemirror versioning
- `@codemirror/view` pinned to `6.38.6` (matches `obsidian@latest` peer dep)
- `@codemirror/state` pinned to `6.6.0` (matches the version `@codemirror/view@6.38.6` resolves internally — using a lower version causes `DecorationSet` type mismatch)
- CI uses `npm ci --legacy-peer-deps`

## Obsidian ESLint Rules to Follow

The bot enforces these — always run `npx eslint main.ts` before pushing:
- No `innerHTML`/`outerHTML` — use `createEl`, `createDiv`, `setIcon`, etc.
- No floating promises — use `void` operator or `.catch()`
- No `style.cssText`, `style.opacity` — use CSS classes
- No `this` aliasing (`const self = this`) — use arrow functions
- No deprecated `noticeEl` — use `messageEl`
- No `createEl("h2")` in settings tabs — use `new Setting().setHeading()`
- No plugin name in settings headings
- No `any` types

## Vault Location

Plugin is installed in:
```
/Users/stephanteig/Library/Mobile Documents/iCloud~md~obsidian/Documents/Stephan MacbookPro/.obsidian/plugins/color-preview/
```
Vault notes for this plugin: `Plugin Dev/Color Preview/` in the vault.
