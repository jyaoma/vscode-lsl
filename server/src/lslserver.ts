import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItemTag,
  SignatureHelp,
  SignatureHelpRequest,
  Hover,
  LocationLink,
  Location,
  DocumentHighlight,
  DocumentHighlightKind,
  WorkspaceEdit,
  RenameParams,
  TextEdit,
  DocumentSymbol,
  SymbolKind,
  InlayHint,
  Position,
  InlayHintKind,
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
} from 'vscode-languageserver/node';
import fs from 'fs';
import { parse } from 'yaml';
import type {
  LSLDefinitionYaml,
  LSLFunction,
  LSLFunctionCall,
} from './lslTypes';
import { LSLType } from './lslTypes';

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  scanDocumentForVariables,
  scanDocumentForFunctionCalls,
  scanDocumentForUserFunctions,
  scanDocumentForJumpLabels,
  Variables,
  JumpLabelMap,
} from './scanner';
import getQuoteRanges from './quoteRanges';
import getCommentedOutSections from './comments';
import getScopes from './scopes';
import primParamsStateMachine, { getPrimParamSignature } from './primParamsStateMachine';
import { initParser, parseLSL } from './parser-wrapper';

const lslDefinitionYaml: LSLDefinitionYaml = parse(fs.readFileSync(`${__dirname}/../../lsl_definitions.yaml`, { encoding: 'utf8' }));

const allFunctions = lslDefinitionYaml.functions;
const allConstants = lslDefinitionYaml.constants;
const allEvents = lslDefinitionYaml.events;

// Build a set of all built-in LSL identifiers (functions, constants, events,
// types, and control keywords) from the definitions YAML. Tailslide may be
// outdated and report these as undeclared (E10006), so we suppress that error
// for any identifier that is a known built-in.
const builtinIdentifiers = new Set<string>([
  ...Object.keys(allFunctions),
  ...Object.keys(allConstants),
  ...Object.keys(allEvents),
  ...Object.keys(lslDefinitionYaml.types),
  ...Object.keys(lslDefinitionYaml.controls),
  // Additional LSL language keywords/literals not documented in the definitions YAML
  'switch', 'case', 'break', 'continue', 'TRUE', 'FALSE',
]);

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

const findFunctionName = (
  _textDocumentPosition: TextDocumentPositionParams
):
  | { funcName: string; parenFound: boolean; numberOfCommas: number }
  | undefined => {
  const document = documents.get(_textDocumentPosition.textDocument.uri);
  const text = document?.getText();
  if (!text) return undefined;
  const lines = text.split('\n');
  let lineNumber = _textDocumentPosition.position.line;
  if (lineNumber >= lines.length) return undefined;
  let line = lines[lineNumber];

  const commentedOutSections = getCommentedOutSections(text);
  let quoteRanges = getQuoteRanges(line);
  let colNumber = _textDocumentPosition.position.character - 1;
  // find the function name
  let numberOfCommas = 0;
  let funcName = '';
  let parenFound = false;
  const bracketMatch: string[] = [];

  const userFuncs = allUserFunctions[_textDocumentPosition.textDocument.uri] || {};
  const validFuncNames = [...allFunctionNames, ...Object.keys(userFuncs)];

  while (
    !(validFuncNames.includes(funcName) && parenFound) &&
    lineNumber >= 0
  ) {
    if (colNumber < 0) {
      if (lineNumber === 0) return undefined;
      line = lines[--lineNumber];
      quoteRanges = getQuoteRanges(line);
      colNumber = line.length - 1;
      continue;
    }

    if (
      !quoteRanges.isInRange(colNumber) &&
      !commentedOutSections.isInSection(lineNumber, colNumber)
    ) {
      const char = line[colNumber];
      if (bracketMatch.length === 0 && (char === ';' || char === '{' || char === '}')) {
        break;
      }
      switch (char) {
        case ',':
          if (bracketMatch.length === 0) {
            numberOfCommas++;
          }
          funcName = '';
          break;
        case '<':
          if (bracketMatch[bracketMatch.length - 1] === '>') {
            bracketMatch.pop();
          } else {
            numberOfCommas = 0;
          }
          funcName = '';
          break;
        case '[':
          if (bracketMatch[bracketMatch.length - 1] === ']') {
            bracketMatch.pop();
          } else {
            numberOfCommas = 0;
          }
          funcName = '';
          break;
        case '(':
          if (bracketMatch.length === 0) {
            parenFound = true;
          }
          if (bracketMatch[bracketMatch.length - 1] === ')') {
            bracketMatch.pop();
          }
          funcName = '';
          break;
        case '>':
        case ')':
        case ']':
          bracketMatch.push(char);
          break;
        default:
          if (char && char.match(/[a-zA-Z0-9_]/)) {
            funcName = char + funcName;
          }
          break;
      }
    }
    colNumber--;
  }

  return { funcName, parenFound, numberOfCommas };
};

const findFunctionCommaLocations = (
  funcOpenParenPos: TextDocumentPositionParams,
  documentObj?: TextDocument,
  precomputedCommentedOutSections?: ReturnType<typeof getCommentedOutSections>
): TextDocumentPositionParams[] => {
  const document = documentObj || documents.get(funcOpenParenPos.textDocument.uri);
  const text = document?.getText();
  if (!text) return [];
  const lines = text.split('\n');
  let lineNumber = funcOpenParenPos.position.line;
  if (lineNumber >= lines.length) return [];
  let line = lines[lineNumber];
  let colNumber = funcOpenParenPos.position.character;
  while (colNumber < line.length && line[colNumber] !== '(') {
    colNumber++;
  }
  if (colNumber >= line.length || line[colNumber] !== '(') {
    return [];
  }
  const commaPositions: TextDocumentPositionParams[] = [
    {
      textDocument: funcOpenParenPos.textDocument,
      position: { line: lineNumber, character: colNumber },
    },
  ];
  const commentedOutSections =
    precomputedCommentedOutSections || getCommentedOutSections(text);
  let quoteRanges = getQuoteRanges(line);
  colNumber++;

  const bracketMatch: string[] = [];
  while (lineNumber < lines.length) {
    if (colNumber >= line.length) {
      if (lineNumber + 1 >= lines.length) return commaPositions;
      line = lines[++lineNumber];
      quoteRanges = getQuoteRanges(line);
      colNumber = 0;
      continue;
    }

    if (
      !quoteRanges.isInRange(colNumber) &&
      !commentedOutSections.isInSection(lineNumber, colNumber)
    ) {
      const char = line[colNumber];
      if (bracketMatch.length === 0 && (char === ';' || char === '}')) {
        break;
      }
      if (char === ')') {
        if (bracketMatch.length === 0) {
          return commaPositions;
        }
        if (bracketMatch[bracketMatch.length - 1] === '(') {
          bracketMatch.pop();
        }
      } else if (char === '>') {
        if (bracketMatch[bracketMatch.length - 1] === '<') {
          bracketMatch.pop();
        }
      } else if (char === ']') {
        if (bracketMatch[bracketMatch.length - 1] === '[') {
          bracketMatch.pop();
        }
      } else if (char === '<' || char === '(' || char === '[') {
        bracketMatch.push(char);
      } else if (char === ',') {
        if (bracketMatch.length === 0) {
          commaPositions.push({
            textDocument: funcOpenParenPos.textDocument,
            position: { line: lineNumber, character: colNumber },
          });
        }
      }
    }
    colNumber++;
  }
  return commaPositions;
};

/**
 * If the cursor is inside a `[...]` rules list that is the rules argument of a
 * llSetPrimitiveParams / llSetLinkPrimitiveParams* call, returns:
 *   - listText: the full text of the list
 *   - tokenIndex: the 0-based index of the comma-delimited element the cursor is in
 * Returns null if the cursor is not in such a context.
 */
const findPrimParamPosition = (
  _pos: TextDocumentPositionParams
): { listText: string; tokenIndex: number } | null => {
  const document = documents.get(_pos.textDocument.uri);
  const text = document?.getText();
  if (!text) return null;
  const lines = text.split('\n');

  // Walk backward from cursor to find the opening '[' for a list argument,
  // and keep track of what prim-function and argument index we are in.
  let lineNumber = _pos.position.line;
  let colNumber = _pos.position.character - 1;
  let bracketDepth = 0;
  let vectorDepth = 0;
  let parenDepth = 0;
  let commasInList = 0;
  let inString = false;

  const commentedOutSections = getCommentedOutSections(text);

  while (lineNumber >= 0) {
    const line = lines[lineNumber];
    while (colNumber >= 0) {
      const ch = line[colNumber];
      if (commentedOutSections.isInSection(lineNumber, colNumber)) {
        colNumber--;
        continue;
      }
      if (inString) {
        if (ch === '"' && (colNumber === 0 || line[colNumber - 1] !== '\\')) inString = false;
        colNumber--;
        continue;
      }
      if (ch === '"') { inString = true; colNumber--; continue; }

      if (ch === '>') { vectorDepth++; }
      else if (ch === '<') { if (vectorDepth > 0) vectorDepth--; }
      else if (ch === ')') { parenDepth++; }
      else if (ch === '(') {
        if (parenDepth > 0) { parenDepth--; }
        else {
          // We've exited the function call paren — bail
          return null;
        }
      }
      else if (ch === ']') { bracketDepth++; }
      else if (ch === '[') {
        if (bracketDepth > 0) { bracketDepth--; }
        else {
          // Found the opening '[' of the list containing the cursor
          // Now check if this list is the rules arg of a prim-param function
          const openBracketPos: TextDocumentPositionParams = {
            textDocument: _pos.textDocument,
            position: { line: lineNumber, character: colNumber },
          };
          const funcInfo = findFunctionName(openBracketPos);
          if (!funcInfo) return null;
          const { funcName, numberOfCommas: argIndex } = funcInfo;
          const isRulesArg =
            (funcName === 'llSetPrimitiveParams' && argIndex === 0) ||
            (funcName === 'llSetLinkPrimitiveParams' && argIndex === 1) ||
            (funcName === 'llSetLinkPrimitiveParamsFast' && argIndex === 1);
          if (!isRulesArg) return null;

          // Extract the list text from '[' forward to the matching ']'
          let absIndex = 0;
          for (let i = 0; i < lineNumber; i++) absIndex += lines[i].length + 1;
          absIndex += colNumber;

          let depth = 0;
          let vd = 0;
          let pd = 0;
          let inStr = false;
          let endIndex = absIndex;
          while (endIndex < text.length) {
            const c = text[endIndex];
            if (inStr) {
              if (c === '"' && text[endIndex - 1] !== '\\') inStr = false;
            } else if (c === '"') { inStr = true; }
            else if (c === '<') { vd++; }
            else if (c === '>') { if (vd > 0) vd--; }
            else if (c === '(') { pd++; }
            else if (c === ')') { if (pd > 0) pd--; }
            else if (c === '[') { depth++; }
            else if (c === ']') {
              depth--;
              if (depth === 0) { endIndex++; break; }
            }
            endIndex++;
          }
          const listText = text.substring(absIndex, endIndex);
          return { listText, tokenIndex: commasInList };
        }
      }
      else if (ch === ',' && bracketDepth === 0 && vectorDepth === 0 && parenDepth === 0) {
        commasInList++;
      }
      colNumber--;
    }
    lineNumber--;
    if (lineNumber >= 0) colNumber = lines[lineNumber].length - 1;
  }
  return null;
};

const getWord = (document: string, position: Position): string | null => {
  const lines = document.split('\n');
  const line = lines[position.line];
  let word = line[position.character];
  if (!word || !word.match(/[a-zA-Z0-9_]/)) word = line[position.character - 1];
  if (!word || !word.match(/[a-zA-Z0-9_]/)) return null;
  let leftDone = false;
  let rightDone = false;
  let pointer1 = position.character - 1;
  let pointer2 = position.character + 1;
  let wordCol = -1;
  while (!leftDone || !rightDone) {
    const leftChar = line[pointer1--];
    if (!leftChar) leftDone = true;
    if (!leftDone) {
      if (leftChar.match(/[a-zA-Z0-9_]/)) {
        word = leftChar + word;
      } else {
        leftDone = true;
        wordCol = pointer1 + 1;
      }
    }
    const rightChar = line[pointer2++];
    if (!rightChar) rightDone = true;
    if (!rightDone) {
      if (rightChar.match(/[a-zA-Z0-9_]/)) {
        word = word + rightChar;
      } else {
        rightDone = true;
        if (!wordCol) wordCol = pointer2 - word.length;
      }
    }
  }

  return word;
};

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        triggerCharacters: ['(', ',', ' '],
      },
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
      documentSymbolProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
      hoverProvider: true,
      inlayHintProvider: {
        resolveProvider: false,
      },
      // Tell the client that this server supports diagnostics.
      diagnosticProvider: {
        documentSelector: [{ scheme: 'file', language: 'lsl' }],
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
  };
  result.capabilities.diagnosticProvider = {
    interFileDependencies: false,
    workspaceDiagnostics: false,
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log('Workspace folder change event received.');
    });
  }
  connection.client.register(SignatureHelpRequest.type, {
    triggerCharacters: ['(', ','],
    documentSelector: [{ scheme: 'file', language: 'lsl' }],
  });
});

// The example settings
interface ExampleSettings {
  maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    globalSettings = <ExampleSettings>(
      (change.settings.lslLanguageServer || defaultSettings)
    );
  }
  // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
  // We could optimize things here and re-fetch the setting first can compare it
  // to the existing setting, but this is out of scope for this example.
  connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'lslLanguageServer',
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

const allVariables: { [uri: string]: Variables } = {};
const allUserFunctions: { [uri: string]: { [name: string]: LSLFunction } } = {};
const allJumpLabels: { [uri: string]: JumpLabelMap } = {};

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  try {
    getCommentedOutSections(change.document.getText());
    allVariables[change.document.uri] = scanDocumentForVariables(
      change.document.getText(),
      change.document.uri
    );
    allUserFunctions[change.document.uri] = scanDocumentForUserFunctions(
      change.document.getText(),
      change.document.uri
    );
    allJumpLabels[change.document.uri] = scanDocumentForJumpLabels(
      change.document.getText(),
      change.document.uri
    );
  } catch (e) {
    console.error('Error processing document change:', e);
  }
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log('We received a file change event');
});

// Initialize the parser on server startup
initParser().catch((err) => {
  connection.console.error(`Failed to initialize parser: ${err}`);
});

const getConstantCompletionItems = (array: string[]): CompletionItem[] =>
  array.map<CompletionItem>((name) => ({
    label: name,
    kind: CompletionItemKind.Constant,
    data: name,
    detail: `${allConstants[name].type} ${name} = ${allConstants[name].value}`,
    documentation: allConstants[name].tooltip ?? undefined,
    sortText: `**${name}`,
  }));

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) return [];
    const lines = document.getText().split('\n');
    const line = lines[params.position.line];
    if (!line) return [];
    const lastChar = line[params.position.character - 1];
    try {
      const allScopes = getScopes(document.getText());

      if (' (,'.includes(lastChar)) {
        // Check if the user is typing a jump label name after "jump "
        const textBeforeCursor = line.substring(0, params.position.character);
        const jumpContextMatch = textBeforeCursor.match(/\bjump\s+([a-zA-Z_]*)$/i);

        if (!allJumpLabels[params.textDocument.uri]) {
          allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
            document.getText(),
            params.textDocument.uri
          );
        }
        if (jumpContextMatch) {
          return Object.values(allJumpLabels[params.textDocument.uri].definitions)
            .filter((label) =>
              label.name.startsWith(jumpContextMatch[1] || '')
            )
            .map<CompletionItem>((label) => ({
              label: label.name,
              kind: CompletionItemKind.Keyword,
              data: label.name,
              detail: `@label ${label.name}`,
              documentation: 'Jump target',
            }));
        }

        const functionNameInfo = findFunctionName(params);
        if (!functionNameInfo) return [];
        const { funcName, parenFound, numberOfCommas } = functionNameInfo;
        const isUserFunc = allUserFunctions[params.textDocument.uri]?.[funcName];
        if (
          (!allFunctionNames.includes(funcName) && !isUserFunc) ||
          !parenFound ||
          !funcName ||
          ['if', 'for', 'while'].includes(funcName)
        )
          return [];

        const currentFunction = allFunctions[funcName] || allUserFunctions[params.textDocument.uri][funcName];
        const { arguments: args } = currentFunction;
        const currentParam = Object.values(args[numberOfCommas] || {})[0];
        if (!currentParam) return [];
        const { type, tooltip } = currentParam;
        const name = Object.keys(args[numberOfCommas])[0];
        let subtype = '';
        if (tooltip.includes('ATTACH_')) subtype = 'attach_point';
        else if (tooltip.startsWith('Boolean.')) subtype = 'boolean';
        else if (tooltip.includes('chat channel')) subtype = 'chat';
        else if (tooltip.includes('CLICK_ACTION_')) subtype = 'click_action';
        else if (tooltip.includes('LINK_')) subtype = 'link';
        else if (tooltip.includes('MASK_')) subtype = 'mask';
        else if (tooltip.includes('ALL_SIDES')) subtype = 'face';
        else if (tooltip.includes('PASS_')) subtype = 'pass';
        else if (tooltip.includes('PERM_')) subtype = 'perm';
        else if (tooltip.includes('PERMISSION_')) subtype = 'permission';
        else if (tooltip.includes('STATUS_')) subtype = 'status';
        else if (tooltip.includes('VEHICLE_FLAG_')) subtype = 'vehicle_flag';
        else if (tooltip.includes('VEHICLE_TYPE_')) subtype = 'vehicle_type';
        else if (tooltip.includes('VEHICLE_') && type === 'float') subtype = 'vehicle_float';
        else if (tooltip.includes('VEHICLE_') && type === 'vector') subtype = 'vehicle_vector';
        else if (tooltip.includes('VEHICLE_') && type === 'rotation') subtype = 'vehicle_rotation';
        else if (funcName === 'llSetTextureAnim' && numberOfCommas === 0) subtype = 'texture_anim';
        const smartCompletionItems: CompletionItem[] = [];
        switch (subtype) {
          case 'attach_point':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'ATTACH_HEAD',
                'ATTACH_NOSE',
                'ATTACH_L_EAR',
                'ATTACH_R_EAR',
                'ATTACH_BEARD',
                'ATTACH_LEFT_EYE',
                'ATTACH_RIGHT_EYE',
                'ATTACH_L_HAND',
                'ATTACH_R_HAND',
                'ATTACH_FACE_JAW',
                'ATTACH_FACE_LEFT_EAR',
                'ATTACH_FACE_LEFT_EYE',
                'ATTACH_FACE_RIGHT_EAR',
                'ATTACH_FACE_RIGHT_EYE',
                'ATTACH_FACE_TONGUE',
                'ATTACH_FACE_GROOM',
                'ATTACH_FACE_ALT_A',
                'ATTACH_FACE_ALT_B',
                'ATTACH_FACE_TEETH',
              ])
            );
            break;
          case 'boolean':
            smartCompletionItems.push(
              ...getConstantCompletionItems(['TRUE', 'FALSE'])
            );
            break;
          case 'chat':
            smartCompletionItems.push(
              ...getConstantCompletionItems(['DEBUG_CHANNEL', 'PUBLIC_CHANNEL'])
            );
            break;
          case 'click_action':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'CLICK_ACTION_BUY',
                'CLICK_ACTION_NONE',
                'CLICK_ACTION_OPEN',
                'CLICK_ACTION_OPEN_MEDIA',
                'CLICK_ACTION_PAY',
                'CLICK_ACTION_PLAY',
                'CLICK_ACTION_SIT',
                'CLICK_ACTION_TOUCH',
                'CLICK_ACTION_ZOOM',
              ])
            );
            break;
          case 'face':
            smartCompletionItems.push(
              ...getConstantCompletionItems(['ALL_SIDES'])
            );
            break;
          case 'link':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'LINK_ALL_CHILDREN',
                'LINK_ALL_OTHERS',
                'LINK_ROOT',
                'LINK_SET',
                'LINK_THIS',
              ])
            );
            break;
          case 'mask':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'MASK_BASE',
                'MASK_EVERYONE',
                'MASK_GROUP',
                'MASK_NEXT',
                'MASK_OWNER',
              ])
            );
            break;
          case 'pass':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'PASS_ALWAYS',
                'PASS_IF_NOT_HANDLED',
                'PASS_NEVER',
              ])
            );
            break;
          case 'perm':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'PERM_ALL',
                'PERM_COPY',
                'PERM_MODIFY',
                'PERM_MOVE',
                'PERM_TRANSFER',
              ])
            );
            break;
          case 'permission':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'PERMISSION_ATTACH',
                'PERMISSION_CHANGE_LINKS',
                'PERMISSION_CONTROL_CAMERA',
                'PERMISSION_DEBIT',
                'PERMISSION_OVERRIDE_ANIMATIONS',
                'PERMISSION_RETURN_OBJECTS',
                'PERMISSION_SILENT_ESTATE_MANAGEMENT',
                'PERMISSION_TAKE_CONTROLS',
                'PERMISSION_TELEPORT',
                'PERMISSION_TRACK_CAMERA',
                'PERMISSION_TRIGGER_ANIMATION',
              ])
            );
            break;
          case 'status':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'STATUS_BLOCK_GRAB',
                'STATUS_BLOCK_GRAB_OBJECT',
                'STATUS_BOUNDS_ERROR',
                'STATUS_CAST_SHADOWS',
                'STATUS_DIE_AT_EDGE',
                'STATUS_INTERNAL_ERROR',
                'STATUS_MALFORMED_PARAMS',
                'STATUS_NOT_FOUND',
                'STATUS_NOT_SUPPORTED',
                'STATUS_OK',
                'STATUS_PHANTOM',
                'STATUS_PHYSICS',
                'STATUS_RETURN_AT_EDGE',
                'STATUS_ROTATE_X',
                'STATUS_ROTATE_Y',
                'STATUS_ROTATE_Z',
                'STATUS_SANDBOX',
                'STATUS_TYPE_MISMATCH',
                'STATUS_WHITELIST_FAILED',
              ])
            );
            break;
          case 'texture_anim':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'ANIM_ON',
                'LOOP',
                'REVERSE',
                'PING_PONG',
                'SMOOTH',
                'ROTATE',
                'SCALE',
              ])
            );
            break;
          case 'vehicle_flag':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'VEHICLE_FLAG_CAMERA_DECOUPLED',
                'VEHICLE_FLAG_HOVER_GLOBAL_HEIGHT',
                'VEHICLE_FLAG_HOVER_TERRAIN_ONLY',
                'VEHICLE_FLAG_HOVER_UP_ONLY',
                'VEHICLE_FLAG_HOVER_WATER_ONLY',
                'VEHICLE_FLAG_LIMIT_MOTOR_UP',
                'VEHICLE_FLAG_LIMIT_ROLL_ONLY',
                'VEHICLE_FLAG_MOUSELOOK_BANK',
                'VEHICLE_FLAG_MOUSELOOK_STEER',
                'VEHICLE_FLAG_NO_DEFLECTION_UP',
              ])
            );
            break;
          case 'vehicle_float':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'VEHICLE_ANGULAR_DEFLECTION_EFFICIENCY',
                'VEHICLE_ANGULAR_DEFLECTION_TIMESCALE',
                'VEHICLE_ANGULAR_FRICTION_TIMESCALE',
                'VEHICLE_ANGULAR_MOTOR_DECAY_TIMESCALE',
                'VEHICLE_ANGULAR_MOTOR_TIMESCALE',
                'VEHICLE_BANKING_EFFICIENCY',
                'VEHICLE_BANKING_MIX',
                'VEHICLE_BANKING_TIMESCALE',
                'VEHICLE_HOVER_EFFICIENCY',
                'VEHICLE_HOVER_HEIGHT',
                'VEHICLE_HOVER_TIMESCALE',
                'VEHICLE_LINEAR_DEFLECTION_EFFICIENCY',
                'VEHICLE_LINEAR_DEFLECTION_TIMESCALE',
                'VEHICLE_LINEAR_FRICTION_TIMESCALE',
                'VEHICLE_LINEAR_MOTOR_DECAY_TIMESCALE',
                'VEHICLE_LINEAR_MOTOR_TIMESCALE',
                'VEHICLE_VERTICAL_ATTRACTION_EFFICIENCY',
                'VEHICLE_VERTICAL_ATTRACTION_TIMESCALE',
              ])
            );
            break;
          case 'vehicle_rotation':
            smartCompletionItems.push(
              ...getConstantCompletionItems(['VEHICLE_REFERENCE_FRAME'])
            );
            break;
          case 'vehicle_type':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'VEHICLE_TYPE_AIRPLANE',
                'VEHICLE_TYPE_BALLOON',
                'VEHICLE_TYPE_BOAT',
                'VEHICLE_TYPE_CAR',
                'VEHICLE_TYPE_NONE',
                'VEHICLE_TYPE_SLED',
              ])
            );
            break;
          case 'vehicle_vector':
            smartCompletionItems.push(
              ...getConstantCompletionItems([
                'VEHICLE_ANGULAR_FRICTION_TIMESCALE',
                'VEHICLE_ANGULAR_MOTOR_DIRECTION',
                'VEHICLE_LINEAR_FRICTION_TIMESCALE',
                'VEHICLE_LINEAR_MOTOR_DIRECTION',
                'VEHICLE_LINEAR_MOTOR_OFFSET',
              ])
            );
            break;
          default:
        }

        if (!allVariables[params.textDocument.uri]) {
          allVariables[params.textDocument.uri] = scanDocumentForVariables(
            document.getText(),
            params.textDocument.uri
          );
        }

        smartCompletionItems.push(
          ...Object.values(allVariables[params.textDocument.uri] || {})
            .filter(
              (variable) =>
                (variable.isIncluded ||
                  allScopes.isInScope(params.position, {
                    line: variable.line,
                    character: variable.column,
                  })) &&
                (variable.type === type ||
                  (['rotation', 'quaternion'].includes(variable.type) &&
                    ['rotation', 'quaternion'].includes(type)))
            )
            .map((variable) => ({
              label: variable.name,
              kind: variable.isPreprocessor ? CompletionItemKind.Constant : CompletionItemKind.Variable,
              data: variable.name,
              sortText: `${
                (subtype &&
                  variable.name
                    .toLowerCase()
                    .includes(subtype.toLowerCase())) ||
                variable.name.toLowerCase().includes(name.toLowerCase())
                  ? '**'
                  : ''
              }*${variable.name}`,
            }))
        );

        smartCompletionItems.push(
          ...Object.keys(allConstants)
            .filter(
              (name) =>
                (allConstants[name].type === type ||
                  (['rotation', 'quaternion'].includes(
                    allConstants[name].type
                  ) &&
                    ['rotation', 'quaternion'].includes(type))) &&
                !smartCompletionItems.find(
                  (existing) => existing.label === name
                )
            )
            .map<CompletionItem>((name) => ({
              label: name,
              kind: CompletionItemKind.Constant,
              data: name,
              detail: `${allConstants[name].type} ${name} = ${allConstants[name].value}`,
              documentation: allConstants[name].tooltip ?? undefined,
            }))
        );
        return smartCompletionItems;
      } else {
        if (!allUserFunctions[params.textDocument.uri]) {
          allUserFunctions[params.textDocument.uri] = scanDocumentForUserFunctions(
            document.getText(),
            params.textDocument.uri
          );
        }
        if (!allVariables[params.textDocument.uri]) {
          allVariables[params.textDocument.uri] = scanDocumentForVariables(
            document.getText(),
            params.textDocument.uri
          );
        }

        const functions = Object.keys(allFunctions).map<CompletionItem>(
          (name) => {
            const func = allFunctions[name];
            const tags: CompletionItemTag[] = [];
            if (func.deprecated) {
              tags.push(CompletionItemTag.Deprecated);
            }

            let documentation = func.tooltip || '';
            if (func.return) {
              if (documentation !== '') {
                documentation += '\n\n';
              }
            }

            return {
              label: name,
              kind: CompletionItemKind.Function,
              data: name,
              detail: `${
                func.return && func.return !== 'void' ? `(${func.return}) ` : ''
              }${name}(${func.arguments
                .map((a) => {
                  const argumentName = Object.keys(a)[0];
                  const argumentType = Object.values(a)[0].type;
                  return `${argumentType} ${argumentName}`;
                })
                .join(', ')})`,
              documentation,
              tags,
            };
          }
        );
        const userFuncs = Object.keys(allUserFunctions[params.textDocument.uri] || {}).map<CompletionItem>(
          (name) => {
            const func = allUserFunctions[params.textDocument.uri][name];
            return {
              label: name,
              kind: CompletionItemKind.Function,
              data: name,
              detail: `${
                func.return && func.return !== 'void' ? `(${func.return}) ` : ''
              }${name}(${func.arguments
                .map((a) => {
                  const argumentName = Object.keys(a)[0];
                  const argumentType = Object.values(a)[0].type;
                  return `${argumentType} ${argumentName}`;
                })
                .join(', ')})`,
              documentation: func.tooltip,
            };
          }
        );
        const constants = Object.keys(allConstants).map<CompletionItem>(
          (name) => ({
            label: name,
            kind: CompletionItemKind.Constant,
            data: name,
            detail: `${allConstants[name].type} ${name} = ${allConstants[name].value}`,
            documentation: allConstants[name].tooltip ?? undefined,
          })
        );

        const userVariables = Object.values(
          allVariables[params.textDocument.uri] || {}
        )
          .filter((variable) =>
            variable.isIncluded ||
            allScopes.isInScope(params.position, {
              line: variable.line,
              character: variable.column,
            })
          )
          .map((variable) => ({
            label: variable.name,
            kind: variable.isPreprocessor ? CompletionItemKind.Constant : CompletionItemKind.Variable,
            data: variable.name,
            detail: variable.isPreprocessor
              ? `#define ${variable.name}${variable.macroParams || ''}${variable.value ? ` ${variable.value}` : ''}`
              : (variable.type ? `${variable.type} ${variable.name}` : variable.name),
            documentation: variable.comment,
          }));

        return [...functions, ...userFuncs, ...constants, ...userVariables];
      }
    } catch (e) {
      console.error('Error in onCompletion:', e);
      return [];
    }
  }
);

connection.onHover((params: TextDocumentPositionParams): Hover => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return { contents: '' };
  const word = getWord(document.getText(), params.position);
  if (!word) return { contents: '' };

  // Check for jump labels — @label definitions and jump label usages
  if (!allJumpLabels[params.textDocument.uri])
    allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
      document.getText(),
      params.textDocument.uri
    );
  const jumpLabels = allJumpLabels[params.textDocument.uri];

  const isJumpLabel =
    Object.values(jumpLabels.definitions).some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    ) ||
    Object.values(jumpLabels.usages).flat().some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    );

  if (isJumpLabel) {
    const usageCount = (jumpLabels.usages[word] || []).length;
    return {
      contents: [
        '```lsl\n@label ' + word + '\n```',
        `**Jump target** \`${word}\``,
        usageCount > 0
          ? `${usageCount} jump usage${usageCount !== 1 ? 's' : ''}`
          : 'No jump usages',
      ],
    };
  }

  const lslConstant = allConstants[word];
  if (lslConstant) {
    let constValue = lslConstant.value;
    if (
      (lslConstant.type === 'string' || lslConstant.type === 'key') &&
      constValue !== undefined
    ) {
      const strVal = String(constValue);
      constValue = strVal.startsWith('"') && strVal.endsWith('"') ? strVal : JSON.stringify(strVal);
    }
    const hoverContent = [
      `\`\`\`lsl\n${lslConstant.type ? `(${lslConstant.type}) ` : ''}${word}${
        constValue !== undefined ? ` = ${constValue}` : ''
      }\n\`\`\``,
    ];
    if (lslConstant.tooltip) {
      hoverContent.push(...lslConstant.tooltip.split('\n'));
    }
    hoverContent.push(`@see - https://wiki.secondlife.com/wiki/${word}`);
    return { contents: hoverContent };
  }

  if (!allUserFunctions[params.textDocument.uri])
    allUserFunctions[params.textDocument.uri] = scanDocumentForUserFunctions(
      document.getText(),
      params.textDocument.uri
    );

  const lslFunction = allFunctions[word] || (allUserFunctions[params.textDocument.uri] && allUserFunctions[params.textDocument.uri][word]);
  if (lslFunction) {
    const hoverContent = [];
    if (lslFunction['god-mode']) {
      hoverContent.push(`This function requires god-mode.`);
    }
    if (lslFunction.deprecated) {
      hoverContent.push(
        `@deprecated`
      );
    }
    // if (lslFunction.broken) {
    //   hoverContent.push(
    //     `@deprecated - This function is either broken or does not do anything.`
    //   );
    // }
    // if (lslFunction.experimental) {
    //   hoverContent.push(
    //     `This is an experimental function currently being tested on the beta-grid.`
    //   );
    // }
    hoverContent.push(
      `\`\`\`lsl\n${
        lslFunction.return && lslFunction.return !== 'void' ? `(${lslFunction.return}) ` : ''
      }${word}(${lslFunction.arguments
        .map((a) => {
          const argumentName = Object.keys(a)[0];
          const argumentDetails = Object.values(a)[0];
          const argumentType = argumentDetails?.type;
          return `${argumentType} ${argumentName}`;
        })
        .join(', ')})\n\`\`\``
    );
    
    const permissionsRequired = lslFunction['requires-permission'] ?? [];
    if (permissionsRequired.length) {
      hoverContent.push(`Requires permission(s): ${permissionsRequired.join(', ')}`);
    }

    if (lslFunction.experience) {
      hoverContent.push(`This function requires an experience.`);
    }

    if (lslFunction.tooltip) {
      hoverContent.push(...lslFunction.tooltip.split('\n'));
    }
    lslFunction.arguments.forEach((a) => {
      const argumentName = Object.keys(a)[0];
      const argumentDetails = Object.values(a)[0];
      if (argumentDetails) {
        hoverContent.push(
          `_@param_ \`${argumentDetails.type} ${argumentName}\`${
            argumentDetails.tooltip ? ` - ${argumentDetails.tooltip}` : ''
          }`
        );
      }
    });
    if (allFunctions[word]) {
      hoverContent.push('---');
      hoverContent.push(`Energy: ${lslFunction.energy.toFixed(1)} - Forced delay: ${lslFunction.sleep.toFixed(1)}s`);
      hoverContent.push(`_@see_ - https://wiki.secondlife.com/wiki/${word}`);
    }
    return { contents: hoverContent };
  }

  const lslEvent = allEvents[word];
  if (lslEvent) {
    const hoverContent = [
      `\`\`\`lsl\n${word}(${lslEvent.arguments
        .map((a) => {
          const argumentName = Object.keys(a)[0];
          const argumentType = Object.values(a)[0].type;
          return `${argumentType} ${argumentName}`;
        })
        .join(', ')})\n\`\`\``,
    ];
    if (lslEvent.tooltip) {
      hoverContent.push(...lslEvent.tooltip.split('\n'));
    }
    hoverContent.push(`@see - https://wiki.secondlife.com/wiki/${word}`);
    return { contents: hoverContent };
  }

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocumentForVariables(
      document.getText(),
      params.textDocument.uri
    );

  const variablesInDoc = Object.values(allVariables[params.textDocument.uri] || {});
  const variable =
    variablesInDoc.find((v) => {
      let referenceFound = false;
      v.references.forEach((position) => {
        referenceFound ||=
          position.line === params.position.line &&
          params.position.character >= position.character &&
          params.position.character <= position.character + word.length;
      });
      referenceFound ||=
        params.position.line === v.line &&
        params.position.character >= v.column &&
        params.position.character <= v.column + word.length;

      return v.name === word && referenceFound;
    }) || variablesInDoc.find((v) => v.name === word);

  if (variable) {
    if (variable.isPreprocessor) {
      const hoverContent = [
        `\`\`\`lsl\n#define ${variable.name}${variable.macroParams || ''}${
          variable.value !== undefined && variable.value !== '' ? ` ${variable.value}` : ''
        }\n\`\`\``,
      ];
      if (variable.comment) {
        hoverContent.push(variable.comment);
      }
      return { contents: hoverContent };
    } else if (variable.type) {
      const hoverContent = [`\`\`\`lsl\n(${variable.type}) ${variable.name}\n\`\`\``];
      return { contents: hoverContent };
    }
  }

  return { contents: '' };
});

// This handler resolves additional information for the item selected in
// the completion list.
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
//   // if (item.data === 'llSay') {
//   //   item.detail = 'llSay(integer channel, string msg)';
//   //   item.documentation =
//   //     'Says the text supplied in <= string msg on channel supplied in integer channel. The message can be heard 20m away, usually.';
//   // }
//   // if (Object.keys(allConstants).includes(item.data)) {
//   //   item.kind = CompletionItemKind.Constant;
//   // }
//   // if (item.data === 1) {
//   //   item.detail = 'TypeScript details'lS
//   //   item.documentation = 'TypeScript documentation';
//   // } else if (item.data === 2) {
//   //   item.detail = 'JavaScript details';
//   //   item.documentation = 'JavaScript documentation';
//   // }
//   return item;
// });

const allFunctionNames = Object.keys(allFunctions);
connection.onSignatureHelp(
  (_textDocumentPosition: TextDocumentPositionParams): SignatureHelp => {
    // Check if cursor is inside a PRIM_* rules list first
    try {
      const primPos = findPrimParamPosition(_textDocumentPosition);
      if (primPos) {
        const sig = getPrimParamSignature(primPos.listText, primPos.tokenIndex);
        if (sig) {
          const sigLabel = `${sig.paramName}, ${sig.args.map((argName, i) =>
            `${sig.types[i]} ${argName}`).join(', ')}`;
          return {
            signatures: [
              {
                label: sigLabel,
                parameters: [{ label: sig.paramName }, ...sig.args.map((argName, i) => ({
                  label: `${sig.types[i]} ${argName}`,
                }))],
              },
            ],
            activeSignature: 0,
            activeParameter: sig.activeArg >= -1 ? sig.activeArg + 1 : 0
          };
        }
      }
    } catch (e) {
      console.error('Error computing prim param signature help:', e);
    }

    const functionNameInfo = findFunctionName(_textDocumentPosition);
    if (!functionNameInfo) return { signatures: [], activeSignature: 0 };
    const { funcName, parenFound, numberOfCommas } = functionNameInfo;
    if (!funcName || ['if', 'for', 'while'].includes(funcName))
      return { signatures: [], activeSignature: 0 };

    const isUserFunc = allUserFunctions[_textDocumentPosition.textDocument.uri]?.[funcName];
    if ((!allFunctionNames.includes(funcName) && !isUserFunc) || !parenFound)
      return { signatures: [], activeSignature: 0 };

    const functionDef = allFunctions[funcName] || allUserFunctions[_textDocumentPosition.textDocument.uri][funcName];
    const { arguments: args, tooltip } = functionDef;

    let documentation: string | undefined = '';

    if (tooltip) {
      documentation += tooltip;
    }
    if (documentation === '') {
      documentation = undefined;
    }

    return {
      signatures: [
        {
          label: `${funcName}(${args
            .map((a) => {
              const argumentName = Object.keys(a)[0];
              const argumentType = Object.values(a)[0].type;
              return `${argumentType} ${argumentName}`;
            })
            .join(', ')})`,
          documentation,
          parameters: args.map((a) => {
            const argumentName = Object.keys(a)[0];
            const argumentDetails = Object.values(a)[0];
            return {
              label: `${argumentDetails.type} ${argumentName}`,
              documentation: argumentDetails.tooltip ?? undefined,
            };
          }),
        },
      ],
      activeSignature: 0,
      activeParameter: numberOfCommas,
    };
  }
);

connection.onDefinition((params): LocationLink[] | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const word = getWord(document.getText(), params.position);
  if (!word) return null;

  // Check for jump labels — clicking on `jump label` navigates to `@label`
  if (!allJumpLabels[params.textDocument.uri])
    allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
      document.getText(),
      params.textDocument.uri
    );
  const jumpLabels = allJumpLabels[params.textDocument.uri];

  const jumpLabelUsage = Object.values(jumpLabels.usages).flat().find(
    (label) =>
      label.name === word &&
      label.line === params.position.line &&
      params.position.character >= label.character &&
      params.position.character < label.character + word.length
  );
  if (jumpLabelUsage) {
    const definition = jumpLabels.definitions[jumpLabelUsage.name];
    if (definition) {
      const targetUri = definition.uri || params.textDocument.uri;
      return [
        LocationLink.create(
          targetUri,
          {
            start: { line: definition.line, character: definition.character - 1 },
            end: { line: definition.line, character: definition.character + word.length },
          },
          {
            start: { line: definition.line, character: definition.character },
            end: { line: definition.line, character: definition.character + word.length },
          }
        ),
      ];
    }
  }

  // Clicking on `@label` itself also goes to its definition (self)
  const jumpLabelDef = Object.values(jumpLabels.definitions).find(
    (label) =>
      label.name === word &&
      label.line === params.position.line &&
      params.position.character >= label.character &&
      params.position.character < label.character + word.length
  );
  if (jumpLabelDef) {
    const targetUri = jumpLabelDef.uri || params.textDocument.uri;
    return [
      LocationLink.create(
        targetUri,
        {
          start: { line: jumpLabelDef.line, character: jumpLabelDef.character - 1 },
          end: { line: jumpLabelDef.line, character: jumpLabelDef.character + word.length },
        },
        {
          start: { line: jumpLabelDef.line, character: jumpLabelDef.character },
          end: { line: jumpLabelDef.line, character: jumpLabelDef.character + word.length },
        }
      ),
    ];
  }

  if (!allUserFunctions[params.textDocument.uri])
    allUserFunctions[params.textDocument.uri] = scanDocumentForUserFunctions(
      document.getText(),
      params.textDocument.uri
    );

  const userFunc = allUserFunctions[params.textDocument.uri][word];
  if (userFunc && userFunc.line !== undefined && userFunc.column !== undefined) {
    const targetUri = userFunc.uri || params.textDocument.uri;
    return [
      LocationLink.create(
        targetUri,
        {
          start: { line: userFunc.line, character: 0 },
          end: { line: userFunc.line, character: userFunc.column + word.length },
        },
        {
          start: { line: userFunc.line, character: userFunc.column },
          end: { line: userFunc.line, character: userFunc.column + word.length },
        }
      ),
    ];
  }

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocumentForVariables(
      document.getText(),
      params.textDocument.uri
    );
  const variable = Object.values(allVariables[params.textDocument.uri]).find(
    (variable) => {
      let referenceFound = false;
      variable.references.forEach((position) => {
        referenceFound ||=
          position.line === params.position.line &&
          params.position.character >= position.character &&
          params.position.character < position.character + word.length;
      });
      referenceFound ||=
        params.position.line === variable.line &&
        params.position.character >= variable.column &&
        params.position.character < variable.column + word.length;

      return (variable.name === word && referenceFound) || (variable.isIncluded && variable.name === word);
    }
  );
  if (!variable) return null;

  const targetUri = variable.uri || params.textDocument.uri;
  return [
    LocationLink.create(
      targetUri,
      {
        start: { line: variable.line, character: variable.columnWithType },
        end: { line: variable.line, character: variable.column + word.length },
      },
      {
        start: { line: variable.line, character: variable.column },
        end: { line: variable.line, character: variable.column + word.length },
      }
    ),
  ];
});

connection.onReferences((params): Location[] | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const word = getWord(document.getText(), params.position);
  if (!word) return null;

  // Check for jump labels — find all @label definitions and jump label usages
  if (!allJumpLabels[params.textDocument.uri])
    allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
      document.getText(),
      params.textDocument.uri
    );
  const jumpLabels = allJumpLabels[params.textDocument.uri];

  const isOnJumpLabel =
    Object.values(jumpLabels.definitions).some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    ) ||
    Object.values(jumpLabels.usages).flat().some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    );

  if (isOnJumpLabel) {
    const locations: Location[] = [];
    const definition = jumpLabels.definitions[word];
    if (definition) {
      locations.push(
        Location.create(definition.uri || params.textDocument.uri, {
          start: { line: definition.line, character: definition.character - 1 },
          end: { line: definition.line, character: definition.character + word.length },
        })
      );
    }
    (jumpLabels.usages[word] || []).forEach((usage) => {
      locations.push(
        Location.create(usage.uri || params.textDocument.uri, {
          start: { line: usage.line, character: usage.character },
          end: { line: usage.line, character: usage.character + word.length },
        })
      );
    });
    return locations;
  }

  if (!allUserFunctions[params.textDocument.uri])
    allUserFunctions[params.textDocument.uri] = scanDocumentForUserFunctions(
      document.getText(),
      params.textDocument.uri
    );

  const userFunc = allUserFunctions[params.textDocument.uri][word];
  if (userFunc) {
    const functionCalls = scanDocumentForFunctionCalls(document.getText());
    const usages = functionCalls
      .filter((call) => call.functionName === word)
      .filter((call) =>
        // Exclude the function definition from the references list
        !(call.line === userFunc.line && call.character === userFunc.column)
      )
      .map((call) =>
        Location.create(params.textDocument.uri, {
          start: { line: call.line, character: call.character },
          end: { line: call.line, character: call.character + word.length },
        })
      );

    return usages;
  }

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocumentForVariables(
      document.getText(),
      params.textDocument.uri
    );
  const variable = Object.values(allVariables[params.textDocument.uri]).find(
    (variable) => variable.name === word
  );
  if (!variable) return null;

  return variable.references.map(({ line, character }) =>
    Location.create(params.textDocument.uri, {
      start: { line, character },
      end: { line, character: character + word.length },
    })
  );
});

connection.onDocumentHighlight((params): DocumentHighlight[] | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const word = getWord(document.getText(), params.position);
  if (!word) return null;

  // Check for jump labels
  if (!allJumpLabels[params.textDocument.uri])
    allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
      document.getText(),
      params.textDocument.uri
    );
  const jumpLabels = allJumpLabels[params.textDocument.uri];

  const isJumpLabelDef = Object.values(jumpLabels.definitions).some(
    (label) =>
      label.name === word &&
      label.line === params.position.line &&
      params.position.character >= label.character &&
      params.position.character < label.character + word.length
  );
  const isJumpLabelUsage = Object.values(jumpLabels.usages).flat().some(
    (label) =>
      label.name === word &&
      label.line === params.position.line &&
      params.position.character >= label.character &&
      params.position.character < label.character + word.length
  );
  if (isJumpLabelDef || isJumpLabelUsage) {
    const highlights: DocumentHighlight[] = [];
    const definition = jumpLabels.definitions[word];
    if (definition) {
      highlights.push(
        DocumentHighlight.create(
          {
            start: { line: definition.line, character: definition.character - 1 },
            end: { line: definition.line, character: definition.character + word.length },
          },
          DocumentHighlightKind.Write
        )
      );
    }
    (jumpLabels.usages[word] || []).forEach((usage) => {
      highlights.push(
        DocumentHighlight.create(
          {
            start: { line: usage.line, character: usage.character },
            end: { line: usage.line, character: usage.character + word.length },
          },
          DocumentHighlightKind.Read
        )
      );
    });
    return highlights;
  }

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocumentForVariables(
      document.getText(),
      params.textDocument.uri
    );
  const variable = Object.values(allVariables[params.textDocument.uri]).find(
    (variable) => {
      let referenceFound = false;
      variable.references.forEach((position) => {
        referenceFound ||=
          position.line === params.position.line &&
          params.position.character >= position.character &&
          params.position.character < position.character + word.length;
      });
      referenceFound ||=
        params.position.line === variable.line &&
        params.position.character >= variable.column &&
        params.position.character < variable.column + word.length;

      return variable.name === word && referenceFound;
    }
  );
  if (!variable) return null;

  return [
    DocumentHighlight.create(
      {
        start: { line: variable.line, character: variable.column },
        end: { line: variable.line, character: variable.column + word.length },
      },
      DocumentHighlightKind.Write
    ),
  ].concat(
    variable.references.map((reference) =>
      DocumentHighlight.create(
        {
          start: { ...reference },
          end: { ...reference, character: reference.character + word.length },
        },
        reference.isWrite
          ? DocumentHighlightKind.Write
          : DocumentHighlightKind.Read
      )
    )
  );
});

connection.onPrepareRename((params): { defaultBehavior: boolean } | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const word = getWord(document.getText(), params.position);
  if (!word) return null;

  // Check for jump labels
  if (!allJumpLabels[params.textDocument.uri])
    allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
      document.getText(),
      params.textDocument.uri
    );
  const jumpLabels = allJumpLabels[params.textDocument.uri];

  const isJumpLabel =
    Object.values(jumpLabels.definitions).some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    ) ||
    Object.values(jumpLabels.usages).flat().some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    );
  if (isJumpLabel) return { defaultBehavior: true };

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocumentForVariables(
      document.getText(),
      params.textDocument.uri
    );
  let reference: Position | null = null;
  Object.values(allVariables[params.textDocument.uri]).forEach((variable) => {
    variable.references.forEach((position) => {
      if (
        position.line === params.position.line &&
        params.position.character >= position.character &&
        params.position.character < position.character + word.length
      )
        reference = position;
    });
    if (
      params.position.line === variable.line &&
      params.position.character >= variable.column &&
      params.position.character < variable.column + word.length
    )
      reference = {
        line: variable.line,
        character: variable.column,
      };
  });
  if (!reference) return null;

  return { defaultBehavior: true };
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return null;
  const word = getWord(document.getText(), params.position);
  if (!word) return null;

  // Check for jump labels
  if (!allJumpLabels[params.textDocument.uri])
    allJumpLabels[params.textDocument.uri] = scanDocumentForJumpLabels(
      document.getText(),
      params.textDocument.uri
    );
  const jumpLabels = allJumpLabels[params.textDocument.uri];

  const isJumpLabel =
    Object.values(jumpLabels.definitions).some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    ) ||
    Object.values(jumpLabels.usages).flat().some(
      (label) =>
        label.name === word &&
        label.line === params.position.line &&
        params.position.character >= label.character &&
        params.position.character < label.character + word.length
    );
  if (isJumpLabel) {
    const edits: TextEdit[] = [];
    const definition = jumpLabels.definitions[word];
    if (definition) {
      edits.push(
        TextEdit.replace(
          {
            start: { line: definition.line, character: definition.character },
            end: {
              line: definition.line,
              character: definition.character + word.length,
            },
          },
          params.newName
        )
      );
    }
    (jumpLabels.usages[word] || []).forEach((usage) => {
      edits.push(
        TextEdit.replace(
          {
            start: { line: usage.line, character: usage.character },
            end: {
              line: usage.line,
              character: usage.character + word.length,
            },
          },
          params.newName
        )
      );
    });
    return {
      changes: {
        [params.textDocument.uri]: edits,
      },
    };
  }

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocumentForVariables(
      document.getText(),
      params.textDocument.uri
    );
  const variable = Object.values(allVariables[params.textDocument.uri]).find(
    (variable) => {
      let referenceFound = false;
      variable.references.forEach((position) => {
        referenceFound ||=
          position.line === params.position.line &&
          params.position.character >= position.character &&
          params.position.character < position.character + word.length;
      });
      referenceFound ||=
        params.position.line === variable.line &&
        params.position.character >= variable.column &&
        params.position.character < variable.column + word.length;

      return variable.name === word && referenceFound;
    }
  );
  if (!variable) return null;

  return {
    changes: {
      [params.textDocument.uri]: [
        TextEdit.replace(
          {
            start: { line: variable.line, character: variable.column },
            end: {
              line: variable.line,
              character: variable.column + word.length,
            },
          },
          params.newName
        ),
      ].concat(
        variable.references.map((reference) =>
          TextEdit.replace(
            {
              start: reference,
              end: {
                line: reference.line,
                character: reference.character + word.length,
              },
            },
            params.newName
          )
        )
      ),
    },
  };
});

connection.onDocumentSymbol((params): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return [];
  const allScopes = getScopes(document.getText());
  const filteredScopes = allScopes.scopes.filter(
    (scope) =>
      !scope.name ||
      !(
        ['if', 'else if', 'else', 'for', 'while', 'do', 'switch'].includes(
          scope.name
        ) ||
        scope.name.startsWith('case ') ||
        scope.name.startsWith('#define ')
      )
  );

  const result: DocumentSymbol[] = [];

  let globalScopeCount = -1;
  let foundFirstState = false;
  const nonGlobalVariables: string[] = [];
  let hasMissingEndCurly = false;
  filteredScopes.forEach((scope) => {
    if (scope.name) {
      const startLine = scope.nameStartLine || scope.startLine;
      const startCol = scope.nameStartCol ?? scope.startCol + 1;
      const endLine = scope.endLine!;
      const endCol = scope.endCol! + 1;
      if (scope.name === 'default' || scope.name.startsWith('state ')) {
        foundFirstState = true;
        result.push(
          DocumentSymbol.create(
            scope.name,
            undefined,
            SymbolKind.Class,
            {
              start: { line: startLine, character: startCol },
              end: { line: endLine, character: endCol },
            },
            {
              start: { line: startLine, character: startCol },
              end: { line: startLine, character: startCol },
            },
            []
          )
        );
        globalScopeCount++;
      } else if (!foundFirstState) {
        result.push(
          DocumentSymbol.create(
            scope.name,
            undefined,
            SymbolKind.Function,
            {
              start: { line: startLine, character: startCol },
              end: { line: endLine, character: endCol },
            },
            {
              start: { line: startLine, character: startCol },
              end: { line: startLine, character: startCol },
            },
            Object.keys(allVariables[params.textDocument.uri] || {})
              .filter((varName) => {
                const variable = allVariables[params.textDocument.uri][varName];
                if (variable.isIncluded) return false;
                return (
                  (variable.line > startLine ||
                    (variable.line === startLine &&
                      variable.columnWithType >= startCol)) &&
                  (variable.line < endLine! ||
                    (variable.line === endLine &&
                      variable.columnWithType < endCol!))
                );
              })
              .map((varName) => {
                const variable = allVariables[params.textDocument.uri][varName];
                nonGlobalVariables.push(varName);

                return DocumentSymbol.create(
                  variable.name,
                  undefined,
                  SymbolKind.Variable,
                  {
                    start: { line: variable.line, character: variable.column },
                    end: {
                      line: variable.line,
                      character: variable.column + variable.name.length,
                    },
                  },
                  {
                    start: { line: variable.line, character: variable.column },
                    end: { line: variable.line, character: variable.column },
                  }
                );
              })
          )
        );
        globalScopeCount++;
      } else {
        result[globalScopeCount].children?.push(
          DocumentSymbol.create(
            scope.name,
            undefined,
            SymbolKind.Method,
            {
              start: { line: startLine, character: startCol },
              end: { line: endLine, character: endCol },
            },
            {
              start: { line: startLine, character: startCol },
              end: { line: startLine, character: startCol },
            },
            Object.keys(allVariables[params.textDocument.uri] || {})
              .filter((varName) => {
                const variable = allVariables[params.textDocument.uri][varName];
                if (variable.isIncluded) return false;
                return (
                  (variable.line > startLine ||
                    (variable.line === startLine &&
                      variable.columnWithType >= startCol)) &&
                  (variable.line < endLine! ||
                    (variable.line === endLine &&
                      variable.columnWithType < endCol!))
                );
              })
              .map((varName) => {
                const variable = allVariables[params.textDocument.uri][varName];
                nonGlobalVariables.push(varName);

                return DocumentSymbol.create(
                  variable.name,
                  undefined,
                  SymbolKind.Variable,
                  {
                    start: { line: variable.line, character: variable.column },
                    end: {
                      line: variable.line,
                      character: variable.column + variable.name.length,
                    },
                  },
                  {
                    start: { line: variable.line, character: variable.column },
                    end: { line: variable.line, character: variable.column },
                  }
                );
              })
          )
        );
      }
    }
    if (!scope.endLine) hasMissingEndCurly = true;
  });

  if (hasMissingEndCurly) return [];

  Object.keys(allVariables[params.textDocument.uri] || {})
    .filter((varName) => !nonGlobalVariables.includes(varName) && !allVariables[params.textDocument.uri][varName].isIncluded)
    .forEach((varName) => {
      const variable = allVariables[params.textDocument.uri][varName];
      result.push(
        DocumentSymbol.create(
          variable.name,
          undefined,
          SymbolKind.Variable,
          {
            start: { line: variable.line, character: variable.column },
            end: {
              line: variable.line,
              character: variable.column + variable.name.length,
            },
          },
          {
            start: { line: variable.line, character: variable.column },
            end: { line: variable.line, character: variable.column },
          }
        )
      );
    });

  return result;
});

const getListElementsPositions = (
  startPos: Position,
  documentText: string
): { positions: Position[], listString: string } | null => {
  let index = 0;
  const lines = documentText.split('\n');
  for (let i = 0; i < startPos.line; i++) {
    index += lines[i].length + 1;
  }
  index += startPos.character;

  while (index < documentText.length && documentText[index] !== '[') {
    if (documentText[index] === ';' || documentText[index] === ')') return null;
    index++;
  }
  if (index >= documentText.length) return null;

  const startIndex = index;
  let inString = false;
  let escape = false;
  let bracketMatch = 0;
  let vectorMatch = 0;
  let parenMatch = 0;
  const commaIndexes: number[] = [index];

  while (index < documentText.length) {
    const char = documentText[index];
    if (inString) {
      if (char === '\n') {
        inString = false;
        escape = false;
      } else if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === '<') {
      vectorMatch++;
    } else if (char === '>') {
      if (vectorMatch > 0) vectorMatch--;
    } else if (char === '(') {
      parenMatch++;
    } else if (char === ')') {
      if (parenMatch > 0) parenMatch--;
    } else if (char === '[') {
      bracketMatch++;
    } else if (char === ']') {
      bracketMatch--;
      if (bracketMatch === 0) {
        index++;
        break;
      }
    } else if (char === ',' && bracketMatch === 1 && vectorMatch === 0 && parenMatch === 0) {
      commaIndexes.push(index);
    }
    index++;
  }

  const listString = documentText.substring(startIndex, index);
  
  const positionFromIndex = (idx: number): Position => {
    let l = 0;
    let c = 0;
    for (let i = 0; i < idx; i++) {
      if (documentText[i] === '\n') {
        l++;
        c = 0;
      } else {
        c++;
      }
    }
    return { line: l, character: c };
  };

  const positions = commaIndexes.map(idx => positionFromIndex(idx));
  return { positions, listString };
};

connection.languages.inlayHint.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const resultInlayHints = [] as InlayHint[];

  const documentText = document.getText();
  const documentLines = documentText.split('\n');

  const userFuncs = allUserFunctions[params.textDocument.uri] || {};

  try {
    const commentedOutSections = getCommentedOutSections(documentText);
    const functionCalls: LSLFunctionCall[] =
      scanDocumentForFunctionCalls(documentText);
    functionCalls.forEach((funcCall) => {
      const isUserFunc = userFuncs[funcCall.functionName];
      if (!allFunctions[funcCall.functionName] && !isUserFunc) return;
      const funcCommaLocations = findFunctionCommaLocations(
        {
          textDocument: params.textDocument,
          position: {
            line: funcCall.line,
            character: funcCall.character + funcCall.functionName.length,
          },
        },
        document,
        commentedOutSections
      );
      const funcDef = allFunctions[funcCall.functionName] || isUserFunc;
      funcDef?.arguments.forEach(
        (param, index) => {
          if (index >= funcCommaLocations.length) return;
          let tempLineNumber = funcCommaLocations[index].position.line;
          let tempCharNumber = funcCommaLocations[index].position.character + 1;
          let charAtPosition =
            documentLines[tempLineNumber].charAt(tempCharNumber);
          while (/\s/.test(charAtPosition)) {
            tempCharNumber++;
            if (tempCharNumber >= documentLines[tempLineNumber].length) {
              tempLineNumber++;
              if (tempLineNumber >= documentLines.length) break;
              tempCharNumber = 0;
            }
            charAtPosition =
              documentLines[tempLineNumber].charAt(tempCharNumber);
          }
          const hint = InlayHint.create(
            Position.create(tempLineNumber, tempCharNumber),
            Object.keys(param)[0] + ':',
            InlayHintKind.Parameter
          );
          hint.paddingRight = true;
          resultInlayHints.push(hint);

          if (
            (funcCall.functionName === 'llSetPrimitiveParams' && index === 0) ||
            (funcCall.functionName === 'llSetLinkPrimitiveParams' && index === 1) ||
            (funcCall.functionName === 'llSetLinkPrimitiveParamsFast' && index === 1)
          ) {
            const listInfo = getListElementsPositions(
              Position.create(funcCommaLocations[index].position.line, funcCommaLocations[index].position.character + 1),
              documentText
            );
            if (listInfo) {
              const labels = primParamsStateMachine(listInfo.listString);
              listInfo.positions.forEach((pos, i) => {
                if (i < labels.length && labels[i] !== 'unknown' && labels[i] !== 'param') {
                  let l = pos.line;
                  let c = pos.character + 1;
                  let charAtPos = documentLines[l].charAt(c);
                  while (/\s/.test(charAtPos)) {
                    c++;
                    if (c >= documentLines[l].length) {
                      l++;
                      if (l >= documentLines.length) break;
                      c = 0;
                    }
                    charAtPos = documentLines[l].charAt(c);
                  }
                  const listHint = InlayHint.create(
                    Position.create(l, c),
                    labels[i] + ':',
                    InlayHintKind.Parameter
                  );
                  listHint.paddingRight = true;
                  resultInlayHints.push(listHint);
                }
              });
            }
          }
        }
      );
    });
  } catch (e) {
    console.error('Error while computing inlay hints:', e);
  }
  return resultInlayHints;
});

// TODO: See if this could be used later
// connection.languages.inlayHint.resolve((hint) => {
//   (hint.label as InlayHintLabelPart[])[0].tooltip = 'tooltip';
//   // hint.textEdits = [TextEdit.insert(Position.create(1, 1), 'number')];
//   return hint;
// });

/**
 * Checks for missing semicolons at the end of statements.
 */

/**
 * Checks for missing semicolons at the end of statements.
 */
const checkMissingSemicolons = (documentText: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const lines = documentText.split('\n');
  const commentedOutSections = getCommentedOutSections(documentText);

  // Keywords that should NOT be followed by semicolons (control flow statements)
  const controlFlowKeywords = ['if', 'else', 'for', 'while', 'do', 'switch', 'case'];

  lines.forEach((line, lineNum) => {
    // Skip empty lines and lines with only whitespace
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    // Skip comment lines
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) return;

    // Skip preprocessor lines
    if (trimmedLine.startsWith('#')) return;

    // Skip lines that are just curly braces or whitespace + curly braces
    const curliesOnlyMatch = trimmedLine.match(/^[{}]+\s*$/);
    if (curliesOnlyMatch) return;

    // Find the actual code portion (excluding trailing comments)
    let codeEndIndex = line.length;
    let commentIndex = line.length;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === '/' && line[i + 1] === '/') {
        commentIndex = i;
        break;
      }
    }
    if (commentIndex < line.length) {
      // Check if the comment start is inside a string
      let inString = false;
      for (let i = 0; i < commentIndex; i++) {
        const ch = line[i];
        if (ch === '"') inString = !inString;
      }
      if (!inString) {
        codeEndIndex = commentIndex;
      }
    }

    const codePart = line.substring(0, codeEndIndex);

    // Skip if the line ends with semicolon (correct)
    if (codePart.trimEnd().endsWith(';')) return;

    // Skip if the line ends with a colon (function declaration, case, label, etc.)
    if (codePart.trimEnd().endsWith(':')) return;

    // Skip lines that start with control flow keywords (they have their own termination rules)
    const firstWordMatch = trimmedLine.match(/^[a-z_][a-zA-Z0-9_]*/i);
    const firstWord = firstWordMatch ? firstWordMatch[0].toLowerCase() : '';
    if (controlFlowKeywords.includes(firstWord)) return;

    // Track parentheses and brackets to find actual statement end
    let parenDepth = 0;
    let bracketDepth = 0;
    let inString = false;

    for (let i = 0; i < codePart.length; i++) {
      // Skip if we're in a comment
      if (commentedOutSections.isInSection(lineNum, i)) continue;

      // Handle string literals
      const ch = codePart[i];
      if (ch === '"' && (i === 0 || codePart[i - 1] !== '\\')) {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (ch === ';') {
        // Found a semicolon - this line has proper termination
        return;
      }
    }

    // If we have unclosed parens, the statement continues to next line - skip
    if (parenDepth > 0 || bracketDepth > 0) return;

    // Check if the code part ends with a closing parenthesis (end of function call or cast)
    const trimmedCodeEnd = codePart.trimEnd();
    const lastSignificantChar = trimmedCodeEnd[trimmedCodeEnd.length - 1];

    // Check if this line or the next line contains an opening brace (function/event declaration)
    // Function declarations have the signature on one line and { on the next
    // But we only want to skip if this line is a function signature (ends with ))
    if (codePart.includes('{')) return;
    // Skip if this looks like a function/event declaration (next line starts with {)
    // and this line ends with ) without assignment
    const nextLine = lineNum + 1 < lines.length ? lines[lineNum + 1].trim() : '';
    if (nextLine.startsWith('{') && lastSignificantChar === ')') return;

    // If we end with ), check if it's a function call or cast
    if (lastSignificantChar === ')') {
      // This looks like a function call or cast ending - needs semicolon if it doesn't have one
      diagnostics.push(
        Diagnostic.create(
          { start: { line: lineNum, character: trimmedCodeEnd.length }, end: { line: lineNum, character: trimmedCodeEnd.length } },
          'Missing semicolon',
          DiagnosticSeverity.Error,
          'lsl'
        )
      );
    }
    // Check if ends with ] (list literal)
    else if (lastSignificantChar === ']') {
      diagnostics.push(
        Diagnostic.create(
          { start: { line: lineNum, character: trimmedCodeEnd.length }, end: { line: lineNum, character: trimmedCodeEnd.length } },
          'Missing semicolon',
          DiagnosticSeverity.Error,
          'lsl'
        )
      );
    }
    // Check if ends with identifier or string (variable declaration, assignment, etc.)
    else if (/[a-zA-Z_]/.test(lastSignificantChar) || lastSignificantChar === '"') {
      // Check if it looks like a statement that needs semicolon
      // Patterns: "integer x", "x = value" (standalone variable with assignment), "x" (undeclared variable usage should not trigger this)
      // Only flag if it starts with a type keyword (variable declaration) or has an assignment
      const looksLikeStatement = /^(integer|float|string|key|list|vector|rotation|quaternion)\s+[a-zA-Z_]/.test(trimmedCodeEnd);
      if (looksLikeStatement) {
        diagnostics.push(
          Diagnostic.create(
            { start: { line: lineNum, character: trimmedCodeEnd.length }, end: { line: lineNum, character: trimmedCodeEnd.length } },
            'Missing semicolon',
            DiagnosticSeverity.Error,
            'lsl'
          )
        );
      }
    }
    // Check if ends with a digit (literal number) - this includes cases like "integer i = 5" or "i = 5"
    else if (/\d/.test(lastSignificantChar)) {
      // Could be variable initialization like "integer i = 5" or "i = 5"
      // Check if there's an assignment operator before the number
      if (/\s=\s*\d+$/.test(trimmedCodeEnd) || /=\s*\d+$/.test(trimmedCodeEnd)) {
        diagnostics.push(
          Diagnostic.create(
            { start: { line: lineNum, character: trimmedCodeEnd.length }, end: { line: lineNum, character: trimmedCodeEnd.length } },
            'Missing semicolon',
            DiagnosticSeverity.Error,
            'lsl'
          )
        );
      }
    }
  });

  return diagnostics;
};

/**
 * Scans a document for all potential identifier references that could be undeclared variables.
 * Returns positions where identifiers are used but not declared in scope.
 */
const findUndeclaredVariableUsages = (documentText: string, documentUri?: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const lines = documentText.split('\n');
  const allScopes = getScopes(documentText);
  const commentedOutSections = getCommentedOutSections(documentText);

  // Always scan fresh for variables to ensure we have up-to-date data
  const declaredVariables = scanDocumentForVariables(documentText, documentUri);
  const userFuncs = scanDocumentForUserFunctions(documentText, documentUri);

  // Collect all known valid names (functions, events, constants, keywords)
  const knownNames = new Set<string>();
  Object.keys(userFuncs).forEach(name => knownNames.add(name));
  Object.keys(allFunctions).forEach(name => knownNames.add(name));
  Object.keys(allEvents).forEach(name => knownNames.add(name));
  Object.keys(allConstants).forEach(name => knownNames.add(name));
  const keywords = [
    'default', 'state', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
    'integer', 'float', 'string', 'key', 'list', 'vector', 'rotation', 'quaternion',
    'return', 'jump', 'break', 'continue', 'TRUE', 'FALSE'
  ];
  keywords.forEach(kw => knownNames.add(kw));

  // First, collect all #define names from the document to add them to known names
  // This handles identifiers defined via preprocessor
  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#define')) {
      const afterDefine = trimmedLine.substring(7).trim();
      const defineNameMatch = afterDefine.match(/([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (defineNameMatch) {
        knownNames.add(defineNameMatch[1]);
      }
    }
  });

  // Track whether we are inside a multi-line #define continuation block
  let inPreprocessorContinuation = false;

  // Scan each line for undeclared variable references
  lines.forEach((line, lineNum) => {
    // Skip all preprocessor directive lines and their multi-line continuations.
    // All identifiers on these lines are either directive keywords, the defined name,
    // or values/expressions used by the preprocessor — not regular LSL code.
    const trimmedLine = line.trim();
    if (inPreprocessorContinuation) {
      if (!line.trimEnd().endsWith('\\')) {
        inPreprocessorContinuation = false;
      }
      return; // Skip this continuation line
    }
    if (/^#(define|include|if|ifdef|ifndef|elif|else|endif|undef|pragma|warning|error)\b/.test(trimmedLine)) {
      if (line.trimEnd().endsWith('\\')) {
        inPreprocessorContinuation = true;
      }
      return; // Skip this preprocessor directive line
    }

    const quoteRanges = getQuoteRanges(line);

    // Find all identifier references in this line
    const identifierMatches = line.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/gm);

    for (const match of identifierMatches) {
      const colNum = match.index ?? -1;
      const word = match[1];

      // Skip if no match or in comments/strings
      if (colNum === -1) continue;
      if (commentedOutSections.isInSection(lineNum, colNum)) continue;
      if (quoteRanges.isInRange(colNum)) continue;

      // Skip if it's a known function/event/constant/keyword
      if (knownNames.has(word)) continue;

      // Skip if preceded immediately by a type keyword (variable declaration)
      // The text immediately before this identifier should end with a type keyword followed by optional whitespace
      const beforeText = line.substring(0, colNum).trimEnd();
      if (/^(integer|float|string|key|list|vector|rotation|quaternion)$/i.test(beforeText)) continue;

      // Skip if preceded by a type keyword (handles "integer myVar")
      const justBeforeMatch = line.substring(0, colNum);
      const lastWordBefore = justBeforeMatch.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*$/);
      const typeKeywords = ['integer', 'float', 'string', 'key', 'list', 'vector', 'rotation', 'quaternion'];
      if (lastWordBefore && typeKeywords.includes(lastWordBefore[0].trim().toLowerCase())) continue;

      // Skip if preceded by 'state' keyword (state declaration like "state custom {")
      if (/\bstate\s*$/i.test(justBeforeMatch.trimEnd())) continue;

      // Skip vector/rotation properties (.x, .y, .z, .s)
      if (['x', 'y', 'z', 's'].includes(word) && justBeforeMatch.trimEnd().endsWith('.')) continue;

      // Skip jump target labels — `@label;` defines a jump target, and
      // `jump label;` references one. Both are valid LSL and should not be
      // reported as undeclared variables.
      if (justBeforeMatch.trimEnd().endsWith('@')) continue;
      if (/\bjump\s*$/i.test(justBeforeMatch.trimEnd())) continue;

      // Check if this variable is declared and in scope
      const isDeclaredAndInScope = Object.values(declaredVariables).some(variable =>
        variable.name === word &&
        // Global variables are visible throughout the entire script regardless
        // of where they are declared (forward reference resolution).
        (variable.isGlobal ||
          variable.isIncluded ||
          allScopes.isInScope(
            { line: lineNum, character: colNum },
            { line: variable.line, character: variable.column }
          ))
      );

      // If not declared or not in scope, flag it as undeclared
      if (!isDeclaredAndInScope) {
        diagnostics.push(
          Diagnostic.create(
            { start: { line: lineNum, character: colNum }, end: { line: lineNum, character: colNum + word.length } },
            `Undeclared variable '${word}'`,
            DiagnosticSeverity.Error,
            'lsl'
          )
        );
      }
    }
  });

  return diagnostics;
};

/**
 * Checks for unused variables - variables that have no read references.
 * Returns diagnostics: Hint severity for variables with inline initialization only,
 * Warning severity for variables assigned in separate statements.
 */
const checkUnusedVariables = (documentText: string, documentUri?: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const declaredVariables = scanDocumentForVariables(documentText, documentUri);
  const lines = documentText.split('\n');

  Object.values(declaredVariables).forEach((variable) => {
    // Skip included variables - they are declared in external/included files
    if (variable.isIncluded) {
      return;
    }

    // Skip parameters - they are part of function/event signatures and intentionally may be unused
    if (variable.isParameter) {
      return;
    }

    // Skip preprocessor #define names (LSLType.Unknown) — these are macros, not regular
    // variables, and their usage can't be reliably tracked by the scanner.
    if (variable.type === LSLType.Unknown) {
      return;
    }

    // Check if a reference is a post-increment/decrement (read then write)
    // e.g., "trip--" reads the value before decrementing
    const isPostIncrementOrDecrement = (ref: { line: number; character: number }): boolean => {
      const line = lines[ref.line];
      // Get the text after the variable name
      const afterVar = line.slice(ref.character + variable.name.length).trimStart();
      // Check for ++ or -- after the variable name (post-increment/decrement)
      // e.g., "trip --" -> afterVar = "--..."
      return /^(\+\+|--)/.test(afterVar);
    };

    // Check if there are any read references
    // Post-increment/decrement (x++) counts as a read since the value is used before modification
    const hasReadReferences = variable.references.some((ref) => {
      if (!ref.isWrite) return true;
      // Post-increment/decrement counts as a read
      if (isPostIncrementOrDecrement(ref)) return true;
      return false;
    });

    // No read references - check if variable is set but never used
    if (hasReadReferences) {
      return;
    }

    // Check if the declaration has an initial value (e.g., "integer x = 5;")
    const declarationLine = lines[variable.line] || '';
    const hasInitialValue = /=[^=]/.test(declarationLine.substring(variable.column));

    // Check if there are any write references on separate lines (e.g., "myVar = 3;")
    // But exclude post-increment/decrement since they involve reading
    const hasSeparateWrite = variable.references.some(
      (ref) => ref.isWrite && ref.line !== variable.line && !isPostIncrementOrDecrement(ref)
    );

    if (hasSeparateWrite) {
      // Assigned in separate statements - warning (yellow squiggly)
      diagnostics.push(
        Diagnostic.create(
          {
            start: { line: variable.line, character: variable.column },
            end: { line: variable.line, character: variable.column + variable.name.length },
          },
          `Variable '${variable.name}' is set but never read`,
          DiagnosticSeverity.Warning,
          'lsl'
        )
      );
    } else {
      // No separate assignments or only post-increment/decrement operations - hint (faded out)
      // This covers both inline init and declared-but-never-touched cases
      const unnecessaryDiagnostic = Diagnostic.create(
          {
            start: { line: variable.line, character: variable.column },
            end: { line: variable.line, character: variable.column + variable.name.length },
          },
          hasInitialValue
            ? `Unused variable '${variable.name}'`
            : `Variable '${variable.name}' is declared but never used`,
          DiagnosticSeverity.Hint,
          'lsl'
        );
      unnecessaryDiagnostic.tags = [DiagnosticTag.Unnecessary];
      diagnostics.push(
        unnecessaryDiagnostic
      );
    }
  });

  return diagnostics;
};

/**
 * Checks for unused user-defined functions - functions that are defined but never called.
 */
const checkUnusedUserFunctions = (documentText: string, documentUri?: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const userFuncs = scanDocumentForUserFunctions(documentText, documentUri);
  const functionCalls = scanDocumentForFunctionCalls(documentText);

  // Collect all called function names (excluding the definitions themselves)
  const calledFunctions = new Set<string>();
  functionCalls.forEach((call) => {
    // Only count as called if this function exists in user functions
    if (userFuncs[call.functionName]) {
      // Check if this call is the function definition itself (same line and adjacent column)
      const funcDef = userFuncs[call.functionName];
      if (funcDef && funcDef.line !== undefined && funcDef.column !== undefined) {
        // Exclude calls that are at the function definition position
        const isDefinitionCall = call.line === funcDef.line &&
          Math.abs(call.character - funcDef.column) < call.functionName.length;
        if (!isDefinitionCall) {
          calledFunctions.add(call.functionName);
        }
      } else {
        calledFunctions.add(call.functionName);
      }
    }
  });

  // Check each user-defined function
  Object.entries(userFuncs).forEach(([funcName, func]) => {
    // Skip included functions - they are defined in external/included files
    if (func.isIncluded) {
      return;
    }

    // Skip deprecated functions - they may intentionally be unused
    if (func.deprecated) {
      return;
    }

    // If the function is defined but never called, flag it
    if (!calledFunctions.has(funcName)) {
      if (func.line !== undefined) {
        const unnecessaryDiagnostic = Diagnostic.create(
          {
            start: { line: func.line, character: func.column || 0 },
            end: { line: func.line, character: (func.column || 0) + funcName.length },
          },
          `Unused function '${funcName}'`,
          DiagnosticSeverity.Hint,
          'lsl'
        );
        unnecessaryDiagnostic.tags = [DiagnosticTag.Unnecessary];
        diagnostics.push(unnecessaryDiagnostic);
      }
    }
  });

  return diagnostics;
};

// Handle diagnostics request
connection.languages.diagnostics.on(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return { kind: 'full', items: [] };
  }

  // Get errors from Tailslide parser
  const tailslideDiagnostics = await parseLSL(document.getText(), document.uri, builtinIdentifiers);
  
  // Check for undeclared variables
  const undeclaredDiagnostics = findUndeclaredVariableUsages(document.getText(), document.uri);
  
  // Check for unused variables
  const unusedDiagnostics = checkUnusedVariables(document.getText(), document.uri);

  // Check for unused functions
  const unusedFunctionsDiagnostics = checkUnusedUserFunctions(document.getText(), document.uri);

  // Add missing semicolon diagnostics (custom check since Tailslide may not detect these)
  // const missingSemiDiagnostics = checkMissingSemicolons(document.getText());

  const allDiagnostics: Diagnostic[] = [
    ...tailslideDiagnostics,
    ...undeclaredDiagnostics,
    ...unusedDiagnostics,
    ...unusedFunctionsDiagnostics,
    // ...missingSemiDiagnostics
  ];

  return {
    kind: 'full',
    items: allDiagnostics
  };
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

