import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import { activate } from './helper';

suite('Should get correct inlay hints', () => {
	const docUri = vscode.Uri.file(path.resolve(__dirname, '../../testFixture', 'issue18.lsl'));

	test('Inlay hints for function arguments ignore commas inside string literals', async () => {
		await activate(docUri);

		const hints = (await vscode.commands.executeCommand(
			'vscode.executeInlayHintProvider',
			docUri,
			new vscode.Range(new vscode.Position(0, 0), new vscode.Position(6, 0))
		)) as vscode.InlayHint[];

		assert.ok(hints && hints.length > 0, 'Inlay hints should be returned');

		// Line 4 in editor (0-based line 3):
		// llLinksetDataWrite("Alice, Bob," + " and Charlie", "At Home");
		const line4Hints = hints.filter(h => h.position.line === 3);
		assert.strictEqual(line4Hints.length, 2, `Expected 2 inlay hints on line 4, got ${line4Hints.length}`);

		assert.strictEqual(line4Hints[0].label, 'name:');
		assert.strictEqual(line4Hints[0].position.character, 27);

		assert.strictEqual(line4Hints[1].label, 'value:');
		assert.strictEqual(line4Hints[1].position.character, 59);

		// Line 5 in editor (0-based line 4):
		// llLinksetDataWrite("Alice, Bob, and Charlie", "At Home");
		const line5Hints = hints.filter(h => h.position.line === 4);
		assert.strictEqual(line5Hints.length, 2, `Expected 2 inlay hints on line 5, got ${line5Hints.length}`);

		assert.strictEqual(line5Hints[0].label, 'name:');
		assert.strictEqual(line5Hints[0].position.character, 27);

		assert.strictEqual(line5Hints[1].label, 'value:');
		assert.strictEqual(line5Hints[1].position.character, 54);
	});
});
