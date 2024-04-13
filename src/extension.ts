import * as vscode from 'vscode';

type LSLItem = {
    declaration: string;
    meaning?: string | null;
    wiki: string;
};

type LSLFunction = LSLItem & {
    deprecationReplacement?: string,
    requiresExperience?: boolean,
    requiresGodMode?: boolean,
    requiresLindenExperience?: boolean,
    isBroken?: boolean,
    isExperimental?: boolean,
}

const lslConstants: { [key: string]: LSLItem } = require('./constants.json');
const lslFunctions: { [key: string]: LSLFunction } = require('./functions.json');

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

        const lslFunction = lslFunctions[word];
        if (!!lslFunction) {
            const hoverContent = [];
            if (lslFunction.requiresGodMode) {
                hoverContent.push(`This function requires god-mode.`);
            }
            if (lslFunction.deprecationReplacement) {
                hoverContent.push(`@deprecated - Use ${lslFunction.deprecationReplacement} instead.`);
            }
            if (lslFunction.isBroken) {
                hoverContent.push(`@deprecated - This function is either broken or does not do anything.`);
            }
            if (lslFunction.isExperimental) {
                hoverContent.push(`This is an experimental function currently being tested on the beta-grid.`);
            }
            if (lslFunction.requiresExperience) {
                hoverContent.push(`This function requires an experience.`);
            } else if (lslFunction.requiresLindenExperience) {
                hoverContent.push(`This function requires a Linden Owned experience.`);
            }
            hoverContent.push(`\`\`\`lsl\n${lslFunction.declaration}\n\`\`\``);
            if (!!lslFunction.meaning) {
                hoverContent.push(...lslFunction.meaning.split('\n'));
            }
            hoverContent.push(`@see - ${lslFunction.wiki}`);
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
