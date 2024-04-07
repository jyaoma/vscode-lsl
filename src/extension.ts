import * as vscode from 'vscode';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import fs from 'fs';

const constants = fs.readFileSync(`${__dirname}/constants.txt`, { encoding: 'utf8' }).split('\r\n');

type LSLConstant = {
    declaration: string;
    meaning?: string | null;
    wiki: string;
}

const lslConstants: { [key: string]: LSLConstant } = require('./constants.json');

class LSLHoverProvider implements vscode.HoverProvider {
    public provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.Hover | undefined {
        const range = document.getWordRangeAtPosition(position);
        const word = document.getText(range);

        const lslConstant = lslConstants[word];
        if (!!lslConstant) {
            const hoverContent = [`\`\`\`lsl\n${lslConstant.declaration}\n\`\`\``];
            if (!!lslConstant.meaning) {
                hoverContent.push(...lslConstant.meaning.split('\n'));
            }
            hoverContent.push(`@see - ${lslConstant.wiki}`);
            return new vscode.Hover(hoverContent);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(['lsl'], new LSLHoverProvider())
    );
}

export function deactivate() {
    // nothing
}
