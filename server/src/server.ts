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
  DocumentDiagnosticReportKind,
  type DocumentDiagnosticReport,
  CompletionItemTag,
  SignatureHelp,
  SignatureHelpRequest,
  Hover,
} from 'vscode-languageserver/node';
import fs from 'fs';
import type { LSLConstant, LSLEvent, LSLFunction } from './lslTypes';

import { TextDocument } from 'vscode-languageserver-textdocument';

const allFunctions: { [key: string]: LSLFunction } = JSON.parse(fs.readFileSync(`${__dirname}/../../functions.json`, { encoding: 'utf8' }));
const allConstants: { [key: string]: LSLConstant } = JSON.parse(fs.readFileSync(`${__dirname}/../../constants.json`, { encoding: 'utf8' }));
const allEvents: { [key: string]: LSLEvent } = JSON.parse(fs.readFileSync(`${__dirname}/../../events.json`, { encoding: 'utf8' }));

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

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
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
      hoverProvider: true
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
  connection.client.register(
    SignatureHelpRequest.type,
    {
      triggerCharacters: ['(', ','],
      documentSelector: [{ scheme: 'file', language: 'lsl' }],
    }
  );
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

connection.languages.diagnostics.on(async (params) => {
  const document = documents.get(params.textDocument.uri);
  // if (document !== undefined) {
  //   return {
  //     kind: DocumentDiagnosticReportKind.Full,
  //     items: await validateTextDocument(document),
  //   } satisfies DocumentDiagnosticReport;
  // } else {
    // We don't know the document. We can either try to read it from disk
    // or we don't report problems for it.
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: [],
    } satisfies DocumentDiagnosticReport;
  // }
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  connection.console.log('We received a content change event');
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log('We received a file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    const functions = Object.keys(allFunctions).map<CompletionItem>(name => {
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
        documentation += `Returns a ${func.returnType} ${func.returns ?? ''}`;
      }

      return {
        label: name,
        kind: CompletionItemKind.Function,
        data: name,
        detail: `${func.returnType ? `(${func.returnType}) ` : ''}${name}(${func.parameters.map(p => `${p.type} ${p.name}`).join(', ')})`,
        documentation,
        tags
      };
    });
    const constants = Object.keys(allConstants).map<CompletionItem>(name => ({
      label: name,
      kind: CompletionItemKind.Constant,
      data: name,
      detail: `${allConstants[name].type} ${allConstants[name].name} = ${allConstants[name].value}`,
      documentation: allConstants[name].meaning ?? undefined
    }));

    return [
      ...functions,
      ...constants
    ];
  }
);

connection.onHover((textDocumentPosition: TextDocumentPositionParams): Hover => {
  const document = documents.get(textDocumentPosition.textDocument.uri);
  if (document === undefined) {
    return { contents: '' };
  }
  const lines = document.getText().split('\n');
  const line = lines[textDocumentPosition.position.line];
  let word = line[textDocumentPosition.position.character];
  if (!word || !word.match(/[a-zA-Z0-9_]/)) {
    return { contents: '' };
  }
  let leftDone = false;
  let rightDone = false;
  let pointer1 = textDocumentPosition.position.character - 1;
  let pointer2 = textDocumentPosition.position.character + 1;
  while (!leftDone || !rightDone) {
    const leftChar = line[pointer1--];
    if (!leftDone) {
      if (leftChar.match(/[a-zA-Z0-9_]/)) {
        word = leftChar + word;
      } else {
        leftDone = true;
      }
    }
    const rightChar = line[pointer2++];
    if (!rightDone) {
      if (rightChar.match(/[a-zA-Z0-9_]/)) {
        word = word + rightChar;
      } else {
        rightDone = true;
      }
    }
  }

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
          hoverContent.push(`@deprecated${lslFunction.deprecated !== 'none' ? ` - Use ${lslFunction.deprecated} instead` : ''}`);
      }
      if (lslFunction.broken) {
          hoverContent.push(`@deprecated - This function is either broken or does not do anything.`);
      }
      if (lslFunction.experimental) {
          hoverContent.push(`This is an experimental function currently being tested on the beta-grid.`);
      }
      if (lslFunction.experience) {
          hoverContent.push(`This function requires an experience.`);
      }
      hoverContent.push(`\`\`\`lsl\n${lslFunction.returnType ? `(${lslFunction.returnType}) ` : ''}${word}(${lslFunction.parameters.map(p => `${p.type} ${p.name}`).join(', ')})\n\`\`\``);
      if (lslFunction.description) {
          hoverContent.push(...lslFunction.description.split('\n'));
      }
      hoverContent.push(`@see - ${lslFunction.wiki}`);
      return { contents: hoverContent };
  }

  const lslEvent = allEvents[word];
  if (lslEvent) {
    const hoverContent = [`\`\`\`lsl\n${word}(${lslEvent.parameters.map(p => `${p.type} ${p.name}`).join(', ')})\n\`\`\``];
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
connection.onSignatureHelp((_textDocumentPosition: TextDocumentPositionParams): SignatureHelp => {
  const document = documents.get(_textDocumentPosition.textDocument.uri);
  const text = document?.getText();
  
  // console.log(_textDocumentPosition);
  if (!text) return { signatures: [], activeSignature: 0 };
  const lines = text.split('\n');
  let lineNumber = _textDocumentPosition.position.line;
  if (lineNumber >= lines.length) return { signatures: [], activeSignature: 0 };
  let line = lines[lineNumber];
  let quoteRanges: { start: number; end: number }[] = [];
  let start = -1;
  line.split('').forEach((char, index) => {
    if (char === '"' && start === -1) {
      start = index;
    } else if (char === '"' && start !== -1) {
      quoteRanges.push({ start, end: index });
      start = -1;
    }
  });
  let colNumber = _textDocumentPosition.position.character - 1;
  // find the function name
  let numberOfCommas = 0;
  let funcName = '';
  let parenFound = false;
  const bracketMatch: string[] = [];
  // console.log('---------');
  while (!(allFunctionNames.includes(funcName) && parenFound) && !'{};'.includes(line[colNumber])) {
    const char = line[colNumber--];
    console.log({ char, numberOfCommas, funcName, bracketMatch, colNumber, quoteRanges });
    let isInQuote = false;
    quoteRanges.forEach(range => {
      if (colNumber + 1 >= range.start && colNumber + 1 <= range.end) {
        isInQuote = true;
      }
    });
    if (isInQuote) continue;

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
      if (lineNumber === 0) return { signatures: [], activeSignature: 0 };
      line = lines[--lineNumber];
      quoteRanges = [];
      start = -1;
      line.split('').forEach((char, index) => {
        if (char === '"' && start === -1) {
          start = index;
        } else if (char === '"' && start !== -1) {
          quoteRanges.push({ start, end: index });
          start = -1;
        }
      });
      colNumber = line.length - 1;
    }
  }

  console.log({ numberOfCommas, funcName });

  if (!allFunctionNames.includes(funcName) || !parenFound) return { signatures: [], activeSignature: 0 };

  const { parameters, returnType, returns, description } = allFunctions[funcName];

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
        label: `${funcName}(${parameters.map(p => `${p.type} ${p.name}`).join(', ')})`,
        documentation,
        parameters: parameters.map(p => ({
          label: `${p.type} ${p.name}`,
          documentation: p.description ?? undefined
        }))
      }
    ],
    activeSignature: 0,
    activeParameter: numberOfCommas
  };
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
