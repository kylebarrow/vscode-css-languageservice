/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nodes from '../parser/cssNodes.js';
import { Scanner, TokenType } from '../parser/cssScanner.js';
import { TextDocument, TextEdit, Range } from '../cssLanguageTypes.js';

export interface AllmanBraceProblem {
	offset: number;
	edit: TextEdit;
}

/**
 * Find block braces sharing a line with other content and compute whitespace-only fixes.
 * Custom-property values are excluded, even when the parser represents them as blocks.
 * @param document Current document snapshot.
 * @param stylesheet Parsed stylesheet for the same snapshot.
 * @returns One replacement per offending brace; apply individually and revalidate.
 */
export function allmanBraceProblems(document: TextDocument, stylesheet: nodes.Stylesheet): AllmanBraceProblem[] {
	const text = document.getText();
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const problems: AllmanBraceProblem[] = [];
	// A recovered AST can end inside an unfinished string/comment. Confirm brace tokens.
	const scanner = new Scanner();
	scanner.setSource(text);
	const braces = new Map<number, TokenType>();
	for (let token = scanner.scan(); token.type !== TokenType.EOF; token = scanner.scan()) {
		if (token.type === TokenType.CurlyL || token.type === TokenType.CurlyR) {
			braces.set(token.offset, token.type);
		}
	}
	stylesheet.accept(node => {
		if (node instanceof nodes.CustomPropertyDeclaration) {
			return false;
		}
		if (!(node instanceof nodes.Declarations)) {
			return true;
		}
		const parent = node.getParent();
		const parentStart = parent?.offset ?? node.offset;
		const parentLineStart = document.offsetAt({ line: document.positionAt(parentStart).line, character: 0 });
		const indent = /^[\t ]*/.exec(text.slice(parentLineStart, parentStart))![0];
		for (const [offset, expected] of [[node.offset, TokenType.CurlyL], [node.end - 1, TokenType.CurlyR]]) {
			const brace = text[offset];
			if (braces.get(offset) !== expected) {
				continue;
			}
			const lineStart = document.offsetAt({ line: document.positionAt(offset).line, character: 0 });
			let start = offset;
			while (start > lineStart && /[\t ]/.test(text[start - 1])) {
				start--;
			}
			let end = offset + 1;
			while (end < text.length && /[\t ]/.test(text[end])) {
				end++;
			}
			const needsBefore = start > lineStart;
			const needsAfter = end < text.length && text[end] !== '\r' && text[end] !== '\n';
			if (!needsBefore && !needsAfter) {
				continue;
			}
			// Move only the brace and surrounding horizontal whitespace. Indentation of
			// declarations is left to the formatter; this rule enforces brace placement only.
			const replacement = (needsBefore ? eol + indent : '') + brace + (needsAfter ? eol + indent : '');
			const range = Range.create(document.positionAt(needsBefore ? start : offset), document.positionAt(needsAfter ? end : offset + 1));
			problems.push({ offset, edit: TextEdit.replace(range, replacement) });
		}
		return true;
	});
	return problems;
}
