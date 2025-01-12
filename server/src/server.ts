/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
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
} from 'vscode-languageserver/node';
import fs from 'fs';
import type { LSLConstant, LSLEvent, LSLFunction } from './lslTypes';

import { Position, TextDocument } from 'vscode-languageserver-textdocument';
import scanDocument, { Variables } from './scanner';
import getQuoteRanges from './quoteRanges';
import getCommentedOutSections from './comments';
import getScopes from './scopes';

const allFunctions: { [key: string]: LSLFunction } = JSON.parse(
  fs.readFileSync(`${__dirname}/../../functions.json`, { encoding: 'utf8' })
);
const allConstants: { [key: string]: LSLConstant } = JSON.parse(
  fs.readFileSync(`${__dirname}/../../constants.json`, { encoding: 'utf8' })
);
const allEvents: { [key: string]: LSLEvent } = JSON.parse(
  fs.readFileSync(`${__dirname}/../../events.json`, { encoding: 'utf8' })
);

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

  while (
    !(allFunctionNames.includes(funcName) && parenFound) &&
    !'{};'.includes(line[colNumber])
  ) {
    const char = line[colNumber--];

    if (quoteRanges.isInRange(colNumber)) continue;
    if (commentedOutSections.isInSection(lineNumber, colNumber)) continue;

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
        if (char.match(/[a-zA-Z0-9_]/)) {
          funcName = char + funcName;
        }
        break;
    }
    if (colNumber < 0) {
      if (lineNumber === 0) return undefined;
      line = lines[--lineNumber];
      quoteRanges = getQuoteRanges(line);
      colNumber = line.length - 1;
    }
  }

  return { funcName, parenFound, numberOfCommas };
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
        resolveProvider: true,
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
    },
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

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  getCommentedOutSections(change.document.getText());
  allVariables[change.document.uri] = scanDocument(change.document.getText());
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log('We received a file change event');
});

const getConstantCompletionItems = (array: string[]): CompletionItem[] =>
  array.map<CompletionItem>((name) => ({
    label: name,
    kind: CompletionItemKind.Constant,
    data: name,
    detail: `${allConstants[name].type} ${allConstants[name].name} = ${allConstants[name].value}`,
    documentation: allConstants[name].meaning ?? undefined,
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
    const allScopes = getScopes(document.getText());

    if (' (,'.includes(lastChar)) {
      const functionNameInfo = findFunctionName(params);
      if (!functionNameInfo) return [];
      const { funcName, parenFound, numberOfCommas } = functionNameInfo;
      if (
        !allFunctionNames.includes(funcName) ||
        !parenFound ||
        !funcName ||
        ['if', 'for', 'while'].includes(funcName)
      )
        return [];

      const currentFunction = allFunctions[funcName];
      const { parameters } = currentFunction;
      const currentParam = parameters[numberOfCommas];
      if (!currentParam) return [];
      const { type, subtype, name } = currentParam;
      const smartCompletionItems: CompletionItem[] = [];
      switch (subtype) {
        case 'attach_point':
          smartCompletionItems.push(
            ...getConstantCompletionItems([
              'ATTACH_HEAD',
              'ATTACH_NOSE',
              'ATTACH_MOUTH',
              'ATTACH_FACE_TONGUE',
              'ATTACH_CHIN',
              'ATTACH_FACE_JAW',
              'ATTACH_LEAR',
              'ATTACH_REAR',
              'ATTACH_FACE_LEAR',
              'ATTACH_FACE_REAR',
              'ATTACH_LEYE',
              'ATTACH_REYE',
              'ATTACH_FACE_LEYE',
              'ATTACH_FACE_REYE',
              'ATTACH_NECK',
              'ATTACH_LSHOULDER',
              'ATTACH_RSHOULDER',
              'ATTACH_LUARM',
              'ATTACH_RUARM',
              'ATTACH_LLARM',
              'ATTACH_RLARM',
              'ATTACH_LHAND',
              'ATTACH_RHAND',
              'ATTACH_LHAND_RING1',
              'ATTACH_RHAND_RING1',
              'ATTACH_LWING',
              'ATTACH_RWING',
              'ATTACH_CHEST',
              'ATTACH_LEFT_PEC',
              'ATTACH_RIGHT_PEC',
              'ATTACH_BELLY',
              'ATTACH_BACK',
              'ATTACH_TAIL_BASE',
              'ATTACH_TAIL_TIP',
              'ATTACH_AVATAR_CENTER',
              'ATTACH_PELVIS',
              'ATTACH_GROIN',
              'ATTACH_LHIP',
              'ATTACH_RHIP',
              'ATTACH_LULEG',
              'ATTACH_RULEG',
              'ATTACH_RLLEG',
              'ATTACH_LLLEG',
              'ATTACH_LFOOT',
              'ATTACH_RFOOT',
              'ATTACH_HIND_LFOOT',
              'ATTACH_HIND_RFOOT',
              'ATTACH_HUD_CENTER_2',
              'ATTACH_HUD_TOP_RIGHT',
              'ATTACH_HUD_TOP_CENTER',
              'ATTACH_HUD_TOP_LEFT',
              'ATTACH_HUD_CENTER_1',
              'ATTACH_HUD_BOTTOM_LEFT',
              'ATTACH_HUD_BOTTOM',
              'ATTACH_HUD_BOTTOM_RIGHT',
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
            ...getConstantCompletionItems(['PUBLIC_CHANNEL', 'DEBUG_CHANNEL'])
          );
          break;
        case 'click_action':
          smartCompletionItems.push(
            ...getConstantCompletionItems([
              'CLICK_ACTION_NONE',
              'CLICK_ACTION_TOUCH',
              'CLICK_ACTION_SIT',
              'CLICK_ACTION_BUY',
              'CLICK_ACTION_PAY',
              'CLICK_ACTION_OPEN',
              'CLICK_ACTION_PLAY',
              'CLICK_ACTION_OPEN_MEDIA',
              'CLICK_ACTION_ZOOM',
              'CLICK_ACTION_DISABLED',
              'CLICK_ACTION_IGNORE',
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
              'LINK_ROOT',
              'LINK_SET',
              'LINK_ALL_OTHERS',
              'LINK_ALL_CHILDREN',
              'LINK_THIS',
            ])
          );
          break;
        case 'mask':
          smartCompletionItems.push(
            ...getConstantCompletionItems([
              'MASK_BASE',
              'MASK_OWNER',
              'MASK_GROUP',
              'MASK_EVERYONE',
              'MASK_NEXT',
            ])
          );
          break;
        case 'pass':
          smartCompletionItems.push(
            ...getConstantCompletionItems([
              'PASS_IF_NOT_HANDLED',
              'PASS_ALWAYS',
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
              'PERMISSION_DEBIT',
              'PERMISSION_TAKE_CONTROLS',
              'PERMISSION_TRIGGER_ANIMATION',
              'PERMISSION_ATTACH',
              'PERMISSION_CHANGE_LINKS',
              'PERMISSION_TRACK_CAMERA',
              'PERMISSION_CONTROL_CAMERA',
              'PERMISSION_TELEPORT',
              'PERMISSION_SILENT_ESTATE_MANAGEMENT',
              'PERMISSION_OVERRIDE_ANIMATIONS',
              'PERMISSION_RETURN_OBJECTS',
            ])
          );
          break;
        case 'status':
          smartCompletionItems.push(
            ...getConstantCompletionItems([
              'STATUS_PHYSICS',
              'STATUS_ROTATE_X',
              'STATUS_ROTATE_Y',
              'STATUS_ROTATE_Z',
              'STATUS_PHANTOM',
              'STATUS_SANDBOX',
              'STATUS_BLOCK_GRAB',
              'STATUS_DIE_AT_EDGE',
              'STATUS_RETURN_AT_EDGE',
              'STATUS_CAST_SHADOWS',
              'STATUS_BLOCK_GRAB_OBJECT',
              'STATUS_DIE_AT_NO_ENTRY',
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
              'VEHICLE_ANGULAR_MOTOR_DECAY_TIMESCALE',
              'VEHICLE_ANGULAR_MOTOR_TIMESCALE',
              'VEHICLE_BANKING_EFFICIENCY',
              'VEHICLE_BANKING_MIX',
              'VEHICLE_BANKING_TIMESCALE',
              'VEHICLE_BUOYANCY',
              'VEHICLE_HOVER_HEIGHT',
              'VEHICLE_HOVER_EFFICIENCY',
              'VEHICLE_HOVER_TIMESCALE',
              'VEHICLE_LINEAR_DEFLECTION_EFFICIENCY',
              'VEHICLE_LINEAR_DEFLECTION_TIMESCALE',
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
              'VEHICLE_TYPE_NONE',
              'VEHICLE_TYPE_SLED',
              'VEHICLE_TYPE_CAR',
              'VEHICLE_TYPE_BOAT',
              'VEHICLE_TYPE_AIRPLANE',
              'VEHICLE_TYPE_BALLOON',
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

      smartCompletionItems.push(
        ...Object.values(allVariables[params.textDocument.uri])
          .filter(
            (variable) =>
              allScopes.isInScope(params.position, {
                line: variable.line,
                character: variable.column,
              }) &&
              (variable.type === type ||
                (['rotation', 'quarternion'].includes(variable.type) &&
                  ['rotation', 'quarternion'].includes(type)))
          )
          .map((variable) => ({
            label: variable.name,
            kind: CompletionItemKind.Variable,
            data: variable.name,
            sortText: `${
              (subtype &&
                variable.name.toLowerCase().includes(subtype.toLowerCase())) ||
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
                (['rotation', 'quarternion'].includes(
                  allConstants[name].type
                ) &&
                  ['rotation', 'quarternion'].includes(type))) &&
              !smartCompletionItems.find((existing) => existing.label === name)
          )
          .map<CompletionItem>((name) => ({
            label: name,
            kind: CompletionItemKind.Constant,
            data: name,
            detail: `${allConstants[name].type} ${allConstants[name].name} = ${allConstants[name].value}`,
            documentation: allConstants[name].meaning ?? undefined,
          }))
      );
      return smartCompletionItems;
    } else {
      const functions = Object.keys(allFunctions).map<CompletionItem>(
        (name) => {
          const func = allFunctions[name];
          const tags: CompletionItemTag[] = [];
          if (func.deprecated) {
            tags.push(CompletionItemTag.Deprecated);
          }

          let documentation = func.description || '';
          if (func.returnType) {
            if (documentation !== '') {
              documentation += '\n\n';
            }
            documentation += `Returns a ${func.returnType} ${
              func.returns ?? ''
            }`;
          }

          return {
            label: name,
            kind: CompletionItemKind.Function,
            data: name,
            detail: `${
              func.returnType ? `(${func.returnType}) ` : ''
            }${name}(${func.parameters
              .map((p) => `${p.type} ${p.name}`)
              .join(', ')})`,
            documentation,
            tags,
          };
        }
      );
      const constants = Object.keys(allConstants).map<CompletionItem>(
        (name) => ({
          label: name,
          kind: CompletionItemKind.Constant,
          data: name,
          detail: `${allConstants[name].type} ${allConstants[name].name} = ${allConstants[name].value}`,
          documentation: allConstants[name].meaning ?? undefined,
        })
      );

      const userVariables = Object.values(allVariables[params.textDocument.uri])
        .filter((variable) =>
          allScopes.isInScope(params.position, {
            line: variable.line,
            character: variable.column,
          })
        )
        .map((variable) => ({
          label: variable.name,
          kind: CompletionItemKind.Variable,
          data: variable.name,
        }));

      return [...functions, ...constants, ...userVariables];
    }
  }
);

connection.onHover((params: TextDocumentPositionParams): Hover => {
  const document = documents.get(params.textDocument.uri);
  if (document === undefined) return { contents: '' };
  const word = getWord(document.getText(), params.position);
  if (!word) return { contents: '' };

  const lslConstant = allConstants[word];
  if (lslConstant) {
    const hoverContent = [`\`\`\`lsl\n${lslConstant.name}\n\`\`\``];
    if (lslConstant.meaning) {
      hoverContent.push(...lslConstant.meaning.split('\n'));
    }
    hoverContent.push(`@see - ${lslConstant.wiki}`);
    return { contents: hoverContent };
  }

  const lslFunction = allFunctions[word];
  if (lslFunction) {
    const hoverContent = [];
    if (lslFunction.godMode) {
      hoverContent.push(`This function requires god-mode.`);
    }
    if (lslFunction.deprecated) {
      hoverContent.push(
        `@deprecated${
          lslFunction.deprecated !== 'none'
            ? ` - Use ${lslFunction.deprecated} instead`
            : ''
        }`
      );
    }
    if (lslFunction.broken) {
      hoverContent.push(
        `@deprecated - This function is either broken or does not do anything.`
      );
    }
    if (lslFunction.experimental) {
      hoverContent.push(
        `This is an experimental function currently being tested on the beta-grid.`
      );
    }
    if (lslFunction.experience) {
      hoverContent.push(`This function requires an experience.`);
    }
    hoverContent.push(
      `\`\`\`lsl\n${
        lslFunction.returnType ? `(${lslFunction.returnType}) ` : ''
      }${word}(${lslFunction.parameters
        .map((p) => `${p.type} ${p.name}`)
        .join(', ')})\n\`\`\``
    );
    if (lslFunction.description) {
      hoverContent.push(...lslFunction.description.split('\n'));
    }
    lslFunction.parameters.forEach((p) => {
      hoverContent.push(
        `@param \`${p.type} ${p.name}\`${
          p.description ? ` - ${p.description}` : ''
        }`
      );
    });
    hoverContent.push(`@see - ${lslFunction.wiki}`);
    return { contents: hoverContent };
  }

  const lslEvent = allEvents[word];
  if (lslEvent) {
    const hoverContent = [
      `\`\`\`lsl\n${word}(${lslEvent.parameters
        .map((p) => `${p.type} ${p.name}`)
        .join(', ')})\n\`\`\``,
    ];
    if (lslEvent.description) {
      hoverContent.push(...lslEvent.description.split('\n'));
    }
    hoverContent.push(`@see - ${lslEvent.wiki}`);
    return { contents: hoverContent };
  }

  return { contents: '' };
});

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  // if (item.data === 'llSay') {
  //   item.detail = 'llSay(integer channel, string msg)';
  //   item.documentation =
  //     'Says the text supplied in <= string msg on channel supplied in integer channel. The message can be heard 20m away, usually.';
  // }
  // if (Object.keys(allConstants).includes(item.data)) {
  //   item.kind = CompletionItemKind.Constant;
  // }
  // if (item.data === 1) {
  //   item.detail = 'TypeScript details'lS
  //   item.documentation = 'TypeScript documentation';
  // } else if (item.data === 2) {
  //   item.detail = 'JavaScript details';
  //   item.documentation = 'JavaScript documentation';
  // }
  return item;
});

const allFunctionNames = Object.keys(allFunctions);
connection.onSignatureHelp(
  (_textDocumentPosition: TextDocumentPositionParams): SignatureHelp => {
    const functionNameInfo = findFunctionName(_textDocumentPosition);
    if (!functionNameInfo) return { signatures: [], activeSignature: 0 };
    const { funcName, parenFound, numberOfCommas } = functionNameInfo;
    if (!funcName || ['if', 'for', 'while'].includes(funcName))
      return { signatures: [], activeSignature: 0 };

    if (!allFunctionNames.includes(funcName) || !parenFound)
      return { signatures: [], activeSignature: 0 };

    const { parameters, returnType, returns, description } =
      allFunctions[funcName];

    let documentation: string | undefined = '';

    if (returnType && returns) {
      documentation += `Returns a ${returnType} ${returns}\n\n`;
    }
    if (description) {
      documentation += description;
    }
    if (documentation === '') {
      documentation = undefined;
    }

    return {
      signatures: [
        {
          label: `${funcName}(${parameters
            .map((p) => `${p.type} ${p.name}`)
            .join(', ')})`,
          documentation,
          parameters: parameters.map((p) => ({
            label: `${p.type} ${p.name}`,
            documentation: p.description ?? undefined,
          })),
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

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocument(document.getText());
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
    LocationLink.create(
      params.textDocument.uri,
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

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocument(document.getText());
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

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocument(document.getText());
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

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocument(document.getText());
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

  if (!allVariables[params.textDocument.uri])
    allVariables[params.textDocument.uri] = scanDocument(document.getText());
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
            Object.keys(allVariables[params.textDocument.uri])
              .filter((varName) => {
                const variable = allVariables[params.textDocument.uri][varName];
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
            Object.keys(allVariables[params.textDocument.uri])
              .filter((varName) => {
                const variable = allVariables[params.textDocument.uri][varName];
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

  Object.keys(allVariables[params.textDocument.uri])
    .filter((varName) => !nonGlobalVariables.includes(varName))
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

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
