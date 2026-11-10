/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nodes from '../parser/cssNodes.js';
import { difference } from '../utils/strings.js';
import { Rules } from '../services/lintRules.js';
import {
	Range, CodeActionContext, Diagnostic, Command, TextEdit, CodeAction, WorkspaceEdit, CodeActionKind,
	TextDocumentEdit, VersionedTextDocumentIdentifier, TextDocument, ClientCapabilities
} from '../cssLanguageTypes.js';
import * as l10n from '@vscode/l10n';
import { allmanBraceProblems, AllmanBraceProblem } from './allmanBraces.js';
import { CSSValidation } from './cssValidation.js';
import { CSSDataManager } from '../languageFacts/dataManager.js';

export class CSSCodeActions {

	constructor(private readonly cssDataManager: CSSDataManager, private readonly validation: CSSValidation, private readonly clientCapabilities?: ClientCapabilities) {
	}

	public doCodeActions(document: TextDocument, range: Range, context: CodeActionContext, stylesheet: nodes.Stylesheet): Command[] {
		return this.doCodeActions2(document, range, context, stylesheet).map(ca => {
			const textDocumentEdit: TextDocumentEdit | undefined = ca.edit && ca.edit.documentChanges && ca.edit.documentChanges[0] as TextDocumentEdit;
			return Command.create(ca.title, '_css.applyCodeAction', document.uri, document.version, textDocumentEdit?.edits ?? ca.edit?.changes?.[document.uri]);
		});
	}

	/** Compute quick fixes, validating the selected range when the client omits diagnostics. */
	public doCodeActions2(document: TextDocument, range: Range, context: CodeActionContext, stylesheet: nodes.Stylesheet): CodeAction[] {
		const result: CodeAction[] = [];
		if (context.only && !context.only.some(kind => kind === '' || kind === CodeActionKind.QuickFix)) {
			return result;
		}
		const diagnostics = context.diagnostics.length > 0 ? context.diagnostics : this.validation.doValidation(document, stylesheet).filter(diagnostic => {
			const start = document.offsetAt(diagnostic.range.start);
			const end = document.offsetAt(diagnostic.range.end);
			const selectionStart = document.offsetAt(range.start);
			const selectionEnd = document.offsetAt(range.end);
			return selectionStart === selectionEnd ? start <= selectionStart && selectionStart <= end : start < selectionEnd && selectionStart < end;
		});
		const currentAllmanDiagnostics = diagnostics.some(item => item.code === Rules.AllmanBraces.id)
			? this.validation.doValidation(document, stylesheet).filter(item => item.code === Rules.AllmanBraces.id) : [];
		const allmanOffsets = new Set(currentAllmanDiagnostics.map(item => document.offsetAt(item.range.start)));
		const allmanProblems = allmanOffsets.size > 0 ? allmanBraceProblems(document, stylesheet).filter(item => allmanOffsets.has(item.offset)) : [];
		if (diagnostics.length > 0) {
			for (const diagnostic of diagnostics) {
				this.appendFixesForMarker(document, stylesheet, diagnostic, result, allmanProblems);
			}
		}
		return result;
	}

	private getFixesForUnknownProperty(document: TextDocument, property: nodes.Property, marker: Diagnostic, result: CodeAction[]): void {

		interface RankedProperty {
			property: string;
			score: number;
		}

		const propertyName = property.getName();
		const candidates: RankedProperty[] = [];

		this.cssDataManager.getProperties().forEach(p => {
			const score = difference(propertyName, p.name);
			if (score >= propertyName.length / 2 /*score_lim*/) {
				candidates.push({ property: p.name, score });
			}
		});

		// Sort in descending order.
		candidates.sort((a: RankedProperty, b: RankedProperty) => {
			return b.score - a.score || a.property.localeCompare(b.property);
		});

		let maxActions = 3;
		for (const candidate of candidates) {
			const propertyName = candidate.property;
			const title = l10n.t("Rename to '{0}'", propertyName);
			const edit = TextEdit.replace(marker.range, propertyName);
			const documentIdentifier = VersionedTextDocumentIdentifier.create(document.uri, document.version);
			// Preserve the historical representation when library callers omit capabilities.
			const workspaceEdit: WorkspaceEdit = this.clientCapabilities === undefined || this.clientCapabilities.workspace?.workspaceEdit?.documentChanges === true
				? { documentChanges: [TextDocumentEdit.create(documentIdentifier, [edit])] }
				: { changes: { [document.uri]: [edit] } };
			const codeAction = CodeAction.create(title, workspaceEdit, CodeActionKind.QuickFix);
			codeAction.diagnostics = [marker];
			result.push(codeAction);
			if (--maxActions <= 0) {
				return;
			}
		}
	}

	private appendFixesForMarker(document: TextDocument, stylesheet: nodes.Stylesheet, marker: Diagnostic, result: CodeAction[], allmanProblems: AllmanBraceProblem[]): void {

		if (marker.code === Rules.AllmanBraces.id) {
			// Recompute from the current parse rather than trusting client-supplied edits.
			const offset = document.offsetAt(marker.range.start);
			const problem = allmanProblems.find(item => item.offset === offset);
			if (problem) {
				const edit: WorkspaceEdit = this.clientCapabilities === undefined || this.clientCapabilities.workspace?.workspaceEdit?.documentChanges === true
					? { documentChanges: [TextDocumentEdit.create(VersionedTextDocumentIdentifier.create(document.uri, document.version), [problem.edit])] }
					: { changes: { [document.uri]: [problem.edit] } };
				const action = CodeAction.create(l10n.t('Move brace to its own line'), edit, CodeActionKind.QuickFix);
				action.diagnostics = [marker];
				result.push(action);
			}
			return;
		}
		if (marker.code !== Rules.UnknownProperty.id) {
			return;
		}
		const offset = document.offsetAt(marker.range.start);
		const end = document.offsetAt(marker.range.end);
		const nodepath = nodes.getNodePath(stylesheet, offset);

		for (let i = nodepath.length - 1; i >= 0; i--) {
			const node = nodepath[i];
			if (node instanceof nodes.Declaration) {
				const property = (<nodes.Declaration>node).getProperty();
				if (property && property.offset === offset && property.end === end) {
					this.getFixesForUnknownProperty(document, property, marker, result);
					return;
				}
			}
		}
	}

}
