import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node.js';
import { TextDocument } from '../../lib/esm/cssLanguageService.js';

/** Wait for a protocol response condition without relying on lint timing. */
async function until(condition) {
	for (let i = 0; i < 100; i++) {
		if (condition()) {
			return;
		}
		await delay(30);
	}
	assert.fail('Timed out waiting for diagnostics');
}

for (const documentChanges of [false, true]) {
	test(`CSS stdio diagnostics, fixes and formatting (${documentChanges})`, async t => {
		const child = spawn(process.execPath, [new URL('../cssServer.mjs', import.meta.url).pathname, '--stdio']);
		const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
		t.after(() => { connection.dispose(); child.kill(); });
		let config = {};
		const publications = [];
		connection.onRequest('workspace/configuration', () => [config]);
		connection.onNotification('textDocument/publishDiagnostics', value => publications.push(value));
		connection.onNotification(() => {});
		connection.listen();
		const result = await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {
			workspace: { configuration: true, workspaceEdit: { documentChanges } }, textDocument: {}
		} });
		assert.equal(result.capabilities.documentFormattingProvider, true);
		await connection.sendNotification('initialized', {});
		const uri = 'file:///css-protocol-test.css';
		const text = '.example { displai: block; color: red; }';
		const document = TextDocument.create(uri, 'css', 1, text);
		await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'css', version: 1, text } });
		await until(() => publications.length === 1);
		assert.equal(publications[0].diagnostics[0].code, 'unknownProperties');
		assert.equal(publications[0].version, undefined);
		const actions = await connection.sendRequest('textDocument/codeAction', { textDocument: { uri }, range: { start: { line: 0, character: 13 }, end: { line: 0, character: 13 } }, context: { diagnostics: [] } });
		const action = actions.find(item => item.title === "Rename to 'display'");
		assert.ok(action);
		const edits = documentChanges ? action.edit.documentChanges[0].edits : action.edit.changes[uri];
		const fixed = TextDocument.applyEdits(document, edits);
		assert.equal(fixed, text.replace('displai', 'display'));
		await connection.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] });
		await until(() => publications.length === 2);
		assert.deepEqual(publications[1].diagnostics, []);
		const formatParams = { textDocument: { uri }, options: { tabSize: 4, insertSpaces: false } };
		const formatted = await connection.sendRequest('textDocument/formatting', formatParams);
		assert.match(TextDocument.applyEdits(TextDocument.create(uri, 'css', 2, fixed), formatted), /\n\tdisplay: block;/);
		config = { lint: { allmanBraces: 'warning' }, format: { braceStyle: 'expand' } };
		await connection.sendNotification('workspace/didChangeConfiguration', { settings: {} });
		await until(() => publications.at(-1).diagnostics.filter(d => d.code === 'allmanBraces').length === 2);
		const braceActions = await connection.sendRequest('textDocument/codeAction', { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: fixed.length } }, context: { diagnostics: [] } });
		assert.equal(braceActions.length, 2);
		assert.ok(braceActions.every(a => a.title === 'Move brace to its own line'));
		const allman = await connection.sendRequest('textDocument/formatting', formatParams);
		assert.match(TextDocument.applyEdits(TextDocument.create(uri, 'css', 2, fixed), allman), /\.example\n\{/);
		config = { validate: false, format: { enable: false } };
		await connection.sendNotification('workspace/didChangeConfiguration', { settings: {} });
		assert.deepEqual(await connection.sendRequest('textDocument/formatting', formatParams), []);
		await connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
		await until(() => publications.at(-1).diagnostics.length === 0);
	});
}
