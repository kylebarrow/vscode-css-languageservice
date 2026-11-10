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
- Configuration: `Default`.

The adapter supports push diagnostics, property-name quick fixes, document/range formatting, completion and hover. It does not advertise navigation, rename, workspace indexing, filesystem path completion, custom data loading or SCSS/LESS support. The underlying library retains its existing CSS/SCSS/LESS APIs. Remove the CSS custom server setting to undo this installation.

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

## Compatibility and validation

When code-action requests contain no diagnostics, the library validates the current document using its configured settings and offers fixes only for diagnostics intersecting the requested selection/cursor. Explicit diagnostic contexts retain the existing behavior. Requests for unrelated action kinds return no fixes.

If client capabilities are supplied, edits use `changes` unless `workspace.workspaceEdit.documentChanges` is true. Library callers omitting capabilities retain the original versioned edit representation. The older command-returning API continues to return text edits in either case. Unversioned edits cannot protect against a document changing between response and application by the editor.

Verified in BBEdit 16.1: visible warning, property correction with an empty diagnostic context, warning clearance, document formatting, and warning restoration after resetting/saving the fixture. Automated tests cover both workspace-edit representations, legacy commands, range scoping, ignored warnings/disabled validation, action-kind filtering, stdio diagnostics, formatting, and formatting opt-out. The standalone adapter debounces diagnostics and discards superseded work.
