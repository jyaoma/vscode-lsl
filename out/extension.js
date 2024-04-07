"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const fs_1 = __importDefault(require("fs"));
const constants = fs_1.default.readFileSync(`${__dirname}/constants.txt`, { encoding: 'utf8' }).split('\r\n');
const lslConstants = require('./constants.json');
class LSLHoverProvider {
    provideHover(document, position, token) {
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
function activate(context) {
    context.subscriptions.push(vscode.languages.registerHoverProvider(['lsl'], new LSLHoverProvider()));
}
exports.activate = activate;
function deactivate() {
    // nothing
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map