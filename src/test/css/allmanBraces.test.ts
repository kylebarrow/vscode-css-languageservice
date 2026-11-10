/* Copyright (c) Microsoft Corporation. Licensed under the MIT License. */
import { suite, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getCSSLanguageService, TextDocument, TextDocumentEdit, TextEdit } from '../../cssLanguageService.js';

suite('CSS - Allman braces', () => {
	test('opt-in severity, disabling validation and correct Allman blocks', () => {
		const ls = getCSSLanguageService();
		const document = TextDocument.create('file:///test.css', 'css', 1, '.a { color:red; }');
		const stylesheet = ls.parseStylesheet(document);
		assert.equal(ls.doValidation(document, stylesheet).filter(d => d.code === 'allmanBraces').length, 0);
		for (const [level, severity] of [['warning', 2], ['error', 1], ['ignore', 0]] as const) {
			ls.configure({ lint: { allmanBraces: level } });
			const diagnostics = ls.doValidation(document, stylesheet).filter(d => d.code === 'allmanBraces');
			assert.equal(diagnostics.length, severity ? 2 : 0);
			assert.ok(diagnostics.every(d => d.severity === severity));
		}
		ls.configure({ validate: false, lint: { allmanBraces: 'warning' } });
		assert.deepEqual(ls.doValidation(document, stylesheet), []);
	});

	test('checks nested rules and at-rule blocks, excludes strings/comments/custom values', () => {
		const ls = getCSSLanguageService();
		ls.configure({ lint: { allmanBraces: 'warning' } });
		for (const [text, count] of [
			['@media screen { .a { color:red; } }', 4],
			['@keyframes x { from { opacity:0; } to { opacity:1; } }', 6],
			['@font-face { font-family: x; src: url(x); }', 2],
			['.a\n{\n\tcontent: "{}";\n\t--x: { color: red };\n\t/* {} */\n}', 0],
			['.a { color:red;', 1],
			['.a { content: \"foo}', 1],
			['.a { /* }', 1],
			['.a\n{}', 2]
		] as const) {
			const document = TextDocument.create('file:///test.css', 'css', 1, text);
			assert.equal(ls.doValidation(document, ls.parseStylesheet(document)).filter(d => d.code === 'allmanBraces').length, count, text);
		}
	});

	for (const documentChanges of [false, true]) {
		test(`fixes preserve content and line endings (${documentChanges})`, () => {
			const ls = getCSSLanguageService({ clientCapabilities: { workspace: { workspaceEdit: { documentChanges } } } });
			ls.configure({ lint: { allmanBraces: 'warning' } });
			for (const original of ['.a { color:red; }', '.a /* comment */ { content:"{}"; }', '.a {}', '@media screen { .a { color:red; } }', '.a {\r\n\tcolor:red; }\r\n']) {
				let text = original;
				for (let attempt = 0; attempt < 12; attempt++) {
					const document = TextDocument.create('file:///test.css', 'css', attempt, text);
					const stylesheet = ls.parseStylesheet(document);
					const diagnostics = ls.doValidation(document, stylesheet).filter(d => d.code === 'allmanBraces');
					if (diagnostics.length === 0) {
						break;
					}
					const actions = ls.doCodeActions2(document, diagnostics[0].range, { diagnostics: [] }, stylesheet);
					const action = actions.find(a => a.title === 'Move brace to its own line')!;
					assert.ok(action);
					assert.equal(Boolean(action.edit!.documentChanges), documentChanges);
					const edits = documentChanges ? (action.edit!.documentChanges![0] as TextDocumentEdit).edits as TextEdit[] : action.edit!.changes![document.uri];
					text = TextDocument.applyEdits(document, edits);
				}
				const final = TextDocument.create('file:///test.css', 'css', 99, text);
				assert.deepEqual(ls.doValidation(final, ls.parseStylesheet(final)).filter(d => d.code === 'allmanBraces'), []);
				assert.equal(text.replace(/\s/g, ''), original.replace(/\s/g, ''));
				if (original.includes('\r\n')) {
					assert.ok(!/(?<!\r)\n/.test(text));
				}
				const stale = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, code: 'allmanBraces', message: 'stale' };
				assert.deepEqual(ls.doCodeActions2(final, stale.range, { diagnostics: [stale] }, ls.parseStylesheet(final)), []);
			}
		});
	}
});
