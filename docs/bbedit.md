# CSS support in BBEdit

This fork adds capability-aware quick fixes to Microsoft's CSS language-service library. The optional `server/` package runs this checkout's compiled library over standard LSP/stdio. It is a small CSS-only adapter, not Microsoft's full VS Code CSS server.

## Build and test

Use Node.js 24 or newer. From the checkout root:

```sh
npm ci --ignore-scripts
npm test
npm install --ignore-scripts --package-lock=false --prefix server
npm test --prefix server
```

`npm test` compiles the library, runs its source lint checks and tests. Rebuild after changing TypeScript. The isolated server package adds `vscode-languageserver` 9.0.1; the library's runtime dependencies are unchanged.

## Configure BBEdit

In Settings → Languages → Custom Settings, select **CSS**, then edit its **Server** tab:

- Enable language server.
- Command: your absolute Node.js path (`command -v node`).
- Arguments: `/absolute/path/to/vscode-css-languageservice/server/cssServer.mjs --stdio`
- Language ID: `css`.
- Configuration: `Default`, or `CSS-Fork` after installing the optional preset below.

The adapter supports push diagnostics, property-name quick fixes, document/range formatting, completion and hover. It does not advertise navigation, rename, workspace indexing, filesystem path completion, custom data loading or SCSS/LESS support. The underlying library retains its existing CSS/SCSS/LESS APIs. Remove the CSS custom server setting to undo this installation.

## Optional formatting and lint preset

The included [CSS-Fork.json](CSS-Fork.json) preset enables CSS validation, additional lint warnings and Allman brace warnings and formatting (block braces on their own lines). From the checkout root, copy it into BBEdit's configuration folder:

```sh
mkdir -p "$HOME/Library/Application Support/BBEdit/Language Servers/Configuration"
cp -i docs/CSS-Fork.json "$HOME/Library/Application Support/BBEdit/Language Servers/Configuration/"
```

In **Settings → Languages → Custom Settings → CSS → Server**, choose **CSS-Fork** from the **Configuration** menu and click **OK**. If the new preset does not appear or take effect, restart BBEdit and select it again.

Use **Text → Reformat Document** to apply the preset, then review and save. For example:

```css
.example
{
	color: red;
}
```

The preset warns about unknown properties, duplicate properties, empty rules and `!important`, and sets invalid hex-color lengths to error severity. Invalid hex values may be reported as parser errors.

For formatting, the preset sets `initializationOptions.css.format.braceStyle` to `"expand"`. The separate `initializationOptions.css.lint.allmanBraces` setting enables warnings for block braces sharing a line with other content. It accepts `"ignore"`, `"warning"` or `"error"` and defaults to `"ignore"` outside this preset. To return to same-line braces, select **Default**, or set `format.braceStyle` to `"collapse"` and `lint.allmanBraces` to `"ignore"` in your own configuration.

Indentation comes from BBEdit's document settings. Turn **Auto-Expand Tabs** off to use tabs, or on to use spaces, and choose your preferred tab width. The preset does not change these preferences. VS Code's `editor.insertSpaces` and `editor.formatOnSave` settings do not belong in this configuration. Formatting remains manual.

## Use and settings

Open `server/fixtures/sample.css`. The intentionally misspelled `displai` property should show a warning. Right-click the property and choose **Code Actions → Rename to 'display'**; the warning should clear. **Text → Reformat Document** formats the document. Review changes and save manually; no save hook or automatic save fixes are installed.

The formatter uses Microsoft's CSS formatter and BBEdit's supplied tab/space options. It does not read ESLint or Stylelint rules and is not a Stylelint replacement. Formatting does not automatically select typo corrections.

For custom settings, place a JSON file in BBEdit's `Language Servers/Configuration` directory and select it in the Server tab. Example:

```json
{
  "initializationOptions": {
    "css": {
      "validate": true,
      "lint": { "unknownProperties": "warning" },
      "format": { "enable": true }
    }
  }
}
```

The server also requests the `css` workspace configuration section per document. Workspace settings override initialization defaults. Set `validate: false` to disable diagnostics and fallback quick fixes, or `format.enable: false` to disable formatting. A configuration notification refreshes open documents; otherwise restart the server after changing settings.

## Allman warnings and quick fixes

Open `server/fixtures/allman.css` with **CSS-Fork** selected. Expect two warnings, one for each brace. In BBEdit 16.1, select the affected line (including its brace), right-click a word in the selection and choose **Code Actions → Move brace to its own line**. Right-clicking a bare punctuation character may not expose the Code Actions menu. Applying both fixes clears the warnings.

The rule checks parsed block braces, including nested rules, media queries and keyframes. Braces in strings, comments and custom-property values are excluded. Empty blocks must also place their braces on separate lines. Fixes adjust only the brace and adjacent horizontal whitespace, preserve line-ending style, and revalidate against the current document. Declaration indentation is handled by **Reformat Document**, not this lint rule. A whole-document reformat with the preset also corrects brace layout.

## Compatibility and validation

When code-action requests contain no diagnostics, the library validates the current document using its configured settings and offers fixes only for diagnostics intersecting the requested selection/cursor. Explicit diagnostic contexts retain the existing behavior. Requests for unrelated action kinds return no fixes.

If client capabilities are supplied, edits use `changes` unless `workspace.workspaceEdit.documentChanges` is true. Library callers omitting capabilities retain the original versioned edit representation. The older command-returning API continues to return text edits in either case. Unversioned edits cannot protect against a document changing between response and application by the editor.

Verified in BBEdit 16.1: visible warning, property correction with an empty diagnostic context, warning clearance, document formatting, and warning restoration after resetting/saving the fixture. Automated tests cover both workspace-edit representations, legacy commands, range scoping, ignored warnings/disabled validation, action-kind filtering, stdio diagnostics, formatting, and formatting opt-out. The standalone adapter debounces diagnostics and discards superseded work.
