/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import { createConnection, TextDocuments, TextDocumentSyncKind, CodeActionKind } from 'vscode-languageserver/node.js';
import { getCSSLanguageService, TextDocument } from '../lib/esm/cssLanguageService.js';

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
let capabilities = {};
let defaults = {};
let globalSettings = {};
let epoch = 0;
const settings = new Map();
const pending = new Map();

/** Resolve CSS settings per URI, retaining initialization defaults for minimal clients. */
async function configuration(uri) {
	if (!settings.has(uri)) {
		settings.set(uri, (async () => ({ ...defaults, ...globalSettings, ...(capabilities.workspace?.configuration
			? await connection.workspace.getConfiguration({ scopeUri: uri, section: 'css' }) : {}) }))());
	}
	return settings.get(uri);
}

/** Capture immutable text and configure an isolated service for this request. */
async function context(uri) {
	const current = documents.get(uri);
	if (!current) {
		return undefined;
	}
	const document = TextDocument.create(uri, current.languageId, current.version, current.getText());
	const generation = epoch;
	const config = await configuration(uri);
	if (documents.get(uri) !== current || current.version !== document.version || generation !== epoch) {
		return undefined;
	}
	const service = getCSSLanguageService({ clientCapabilities: capabilities });
	service.configure(config);
	return { document, config, service, stylesheet: service.parseStylesheet(document) };
}

/** Debounce push diagnostics and suppress superseded work, including close/reopen. */
function schedule(document) {
	clearTimeout(pending.get(document.uri));
	const timer = setTimeout(async () => {
		try {
			const ctx = await context(document.uri);
			if (ctx && pending.get(document.uri) === timer) {
				const params = { uri: document.uri, diagnostics: ctx.service.doValidation(ctx.document, ctx.stylesheet) };
				if (capabilities.textDocument?.publishDiagnostics?.versionSupport) {
					params.version = ctx.document.version;
				}
				await connection.sendDiagnostics(params);
			}
		} catch (error) {
			connection.console.error(String(error));
		} finally {
			if (pending.get(document.uri) === timer) {
				pending.delete(document.uri);
			}
		}
	}, 200);
	pending.set(document.uri, timer);
}

connection.onInitialize(params => {
	capabilities = params.capabilities;
	defaults = params.initializationOptions?.css ?? {};
	return { capabilities: {
		textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: { includeText: false } },
		codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
		documentFormattingProvider: true,
		documentRangeFormattingProvider: true,
		completionProvider: { triggerCharacters: ['-', ':'] },
		hoverProvider: true
	} };
});
connection.onDidChangeConfiguration(params => {
	epoch++;
	globalSettings = params.settings?.css ?? {};
	settings.clear();
	for (const document of documents.all()) {
		schedule(document);
	}
});
documents.onDidChangeContent(event => schedule(event.document));
documents.onDidSave(event => schedule(event.document));
documents.onDidClose(event => {
	clearTimeout(pending.get(event.document.uri));
	pending.delete(event.document.uri);
	settings.delete(event.document.uri);
	void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
connection.onShutdown(() => {
	epoch++;
	for (const timer of pending.values()) {
		clearTimeout(timer);
	}
	pending.clear();
});
connection.onCodeAction(async params => {
	const ctx = await context(params.textDocument.uri);
	return ctx ? ctx.service.doCodeActions2(ctx.document, params.range, params.context, ctx.stylesheet) : [];
});

/** Format with resource settings and the editor's tab/space options. */
async function formatting(params) {
	const ctx = await context(params.textDocument.uri);
	if (!ctx || ctx.config.format?.enable === false) {
		return [];
	}
	return ctx.service.format(ctx.document, params.range, { ...ctx.config.format, ...params.options });
}
connection.onDocumentFormatting(formatting);
connection.onDocumentRangeFormatting(formatting);
connection.onCompletion(async params => {
	const ctx = await context(params.textDocument.uri);
	return ctx ? ctx.service.doComplete(ctx.document, params.position, ctx.stylesheet, ctx.config.completion) : null;
});
connection.onHover(async params => {
	const ctx = await context(params.textDocument.uri);
	return ctx ? ctx.service.doHover(ctx.document, params.position, ctx.stylesheet, ctx.config.hover) : null;
});
documents.listen(connection);
connection.listen();
