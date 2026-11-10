/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { suite, test } from 'node:test';
import * as assert from 'node:assert';

import { getCSSLanguageService, TextDocument, TextEdit, Range, Command, CodeAction, TextDocumentEdit } from '../../cssLanguageService.js';

suite('CSS - Code Actions', () => {

	let testCodeActions = function (value: string, tokenBefore: string, expected: { title: string; content: string; }[]) {
		let ls = getCSSLanguageService();

		let document = TextDocument.create('test://test/test.css', 'css', 0, value);
		let styleSheet = ls.parseStylesheet(document);
		let offset = value.indexOf(tokenBefore);
		let startPosition = document.positionAt(offset);
		let endPosition = document.positionAt(offset + tokenBefore.length);
		let range = Range.create(startPosition, endPosition);

		ls.configure({ validate: true });

		let diagnostics = ls.doValidation(document, styleSheet);
		let commands = ls.doCodeActions(document, range, { diagnostics }, styleSheet);
		assertCodeAction(commands, document, expected);

		let codeActions = ls.doCodeActions2(document, range, { diagnostics }, styleSheet);
		assertCodeAction2(codeActions, document, expected);
	};

	let assertCodeAction = function (commands: Command[], document: TextDocument, expected: { title: string; content: string; }[]) {
		let labels = commands.map(command => command.title);

		for (let exp of expected) {
			let index = labels.indexOf(exp.title);
			assert.ok(index !== -1, 'Quick fix not found: ' + exp.title + ' , found:' + labels.join(','));
			let command = commands[index];
			assert.equal(TextDocument.applyEdits(document, <TextEdit[]>command.arguments![2]), exp.content);
			assert.equal(command.arguments![0], document.uri);
			assert.equal(command.arguments![1], document.version);
		}
	};

	let assertCodeAction2 = function (codeActions: CodeAction[], document: TextDocument, expected: { title: string; content: string; }[]) {
		let labels = codeActions.map(command => command.title);

		for (let exp of expected) {
			let index = labels.indexOf(exp.title);
			assert.ok(index !== -1, 'Quick fix not found: ' + exp.title + ' , found:' + labels.join(','));
			let codeAction = codeActions[index];
			for (let change of codeAction.edit!.documentChanges!) {
				if (TextDocumentEdit.is(change)) {
					assert.equal(document.uri, change.textDocument.uri);
					assert.ok(change.edits.every(TextEdit.is), 'Expected code action to contain only text edits');
					assert.equal(TextDocument.applyEdits(document, change.edits), exp.content);
				} else {
					assert.ok(false, 'not a TextDocumentEdit');
				}

			}
		}
	};

	test('Unknown Properties', async function () {
		testCodeActions('body { /*here*/displai: inline }', '/*here*/', [
			{ title: 'Rename to \'display\'', content: 'body { /*here*/display: inline }' }
		]);
		testCodeActions('body { /*here*/background-colar: red }', '/*here*/', [
			{ title: 'Rename to \'background-color\'', content: 'body { /*here*/background-color: red }' },
			{ title: 'Rename to \'background-clip\'', content: 'body { /*here*/background-clip: red }' },
			{ title: 'Rename to \'background-image\'', content: 'body { /*here*/background-image: red }' }
		]);
	});
});

suite('CSS - Standalone client actions', () => {
	for (const documentChanges of [false, true]) {
		test(`empty contexts and workspace edits (${documentChanges})`, () => {
			const ls = getCSSLanguageService({ clientCapabilities: { workspace: { workspaceEdit: { documentChanges } } } });
			const document = TextDocument.create('file:///test.css', 'css', 7, 'a { displai: block; colr: red; }');
			const stylesheet = ls.parseStylesheet(document);
			const range = Range.create(0, 6, 0, 6);
			const actions = ls.doCodeActions2(document, range, { diagnostics: [] }, stylesheet);
			const action = actions.find(item => item.title === "Rename to 'display'")!;
			assert.ok(action);
			assert.equal(Boolean(action.edit?.documentChanges), documentChanges);
			const edits = documentChanges ? (action.edit!.documentChanges![0] as TextDocumentEdit).edits as TextEdit[] : action.edit!.changes![document.uri];
			assert.equal(TextDocument.applyEdits(document, edits), 'a { display: block; colr: red; }');
			assert.ok(actions.every(item => item.diagnostics![0].range.start.character === 4));
			assert.deepEqual(ls.doCodeActions2(document, Range.create(0, 0, 0, 1), { diagnostics: [] }, stylesheet), []);
			assert.deepEqual(ls.doCodeActions2(document, range, { diagnostics: [], only: ['refactor'] }, stylesheet), []);
			const command = ls.doCodeActions(document, range, { diagnostics: [] }, stylesheet).find(item => item.title === action.title)!;
			assert.deepEqual(command.arguments![2], edits);
			ls.configure({ lint: { unknownProperties: 'ignore' } });
			assert.deepEqual(ls.doCodeActions2(document, range, { diagnostics: [] }, stylesheet), []);
			ls.configure({ validate: false });
			assert.deepEqual(ls.doCodeActions2(document, range, { diagnostics: [] }, stylesheet), []);
		});
	}
});
