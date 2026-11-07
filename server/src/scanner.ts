import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import getCommentedOutSections from './comments';
import { LSLType, LSLVariable, LSLFunctionCall, LSLFunction, LSLJumpLabel } from './lslTypes';
import getQuoteRanges from './quoteRanges';
import { convertToType } from './types';
import getScopes from './scopes';

export type Variables = { [key: string]: LSLVariable };

export function uriToFilePath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) {
    try {
      return fileURLToPath(uriOrPath);
    } catch {
      return uriOrPath.replace(/^file:\/\/\/?/, '');
    }
  }
  return uriOrPath;
}

export function filePathToUri(filePath: string): string {
  try {
    return pathToFileURL(filePath).toString();
  } catch {
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }
}

export function resolveIncludePath(
  baseUriOrPath: string,
  includePath: string,
  extraSearchDirs: string[] = []
): string | null {
  try {
    const basePath = uriToFilePath(baseUriOrPath);
    const baseDir = fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()
      ? basePath
      : path.dirname(basePath);

    // First, try relative to the script's own directory (original behaviour)
    const resolvedPath = path.resolve(baseDir, includePath);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }

    // Then search each user-configured include directory in order
    for (const dir of extraSearchDirs) {
      try {
        const candidate = path.resolve(dir, includePath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore bad entries
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export const extractIncludes = (document: string): string[] => {
  const includes: string[] = [];
  const lines = document.split('\n');
  const commentedOutSections = getCommentedOutSections(document);

  lines.forEach((line, lineNum) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) return;

    const hashCol = line.indexOf('#');
    if (hashCol !== -1 && commentedOutSections.isInSection(lineNum, hashCol)) return;

    const match = line.match(/^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/);
    if (match) {
      const includeFile = match[1] || match[2];
      if (includeFile && includeFile.trim()) {
        includes.push(includeFile.trim());
      }
    }
  });

  return includes;
};

export const scanDocumentForUserFunctions = (
  document: string,
  documentUri?: string,
  visited = new Set<string>(),
  includePaths: string[] = []
): { [name: string]: LSLFunction } => {
  const userFunctions: { [name: string]: LSLFunction } = {};
  const scopes = getScopes(document);
  const lines = document.split('\n');

  let foundFirstState = false;

  const filteredScopes = scopes.scopes.filter(
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

  filteredScopes.forEach((scope) => {
    if (scope.name) {
      if (scope.name === 'default' || scope.name.startsWith('state ')) {
        foundFirstState = true;
      } else if (!foundFirstState) {
        // User defined function - get the signature text first
        let signatureText = '';
        if (scope.nameStartLine !== undefined) {
          if (scope.nameStartLine === scope.startLine) {
            signatureText = lines[scope.startLine].substring(0, scope.startCol);
          } else {
            signatureText = lines[scope.nameStartLine];
            for (let i = scope.nameStartLine + 1; i < scope.startLine; i++) {
              signatureText += ' ' + lines[i];
            }
            signatureText += ' ' + lines[scope.startLine].substring(0, scope.startCol);
          }
        }

        const args: any[] = [];
        let returnType = LSLType.Void;
        let functionName = '';

        const argsMatch = signatureText.match(/\((.*)\)/);
        let textBeforeParen = signatureText;
        if (argsMatch) {
          textBeforeParen = signatureText.substring(0, argsMatch.index!);
          const argsStr = argsMatch[1];
          if (argsStr.trim()) {
            argsStr.split(',').forEach(arg => {
              const parts = arg.trim().split(/\s+/);
              if (parts.length >= 2) {
                const argType = convertToType(parts[0]);
                const argName = parts[parts.length - 1]; // get the last part as name in case of extra spaces
                args.push({ [argName]: { type: argType, tooltip: '' } });
              }
            });
          }
        }

        const returnMatch = textBeforeParen.match(/(integer|float|string|key|vector|rotation|quaternion|quaternion|list)\s+/);
        if (returnMatch) {
          returnType = convertToType(returnMatch[1].trim());
        }

        // Extract just the function name from textBeforeParen (after return type if present)
        const funcNameMatch = textBeforeParen.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
        if (funcNameMatch) {
          functionName = funcNameMatch[1];
        } else {
          // Fallback: try to extract from scope.name
          const nameMatch = scope.name.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
          if (nameMatch) {
            functionName = nameMatch[1];
          } else {
            return; // Can't determine function name
          }
        }

        let lineNum = scope.nameStartLine ?? scope.startLine;
        let colNum = lines[lineNum].indexOf(functionName);
        if (colNum === -1 && scope.nameStartLine !== scope.startLine && scope.startLine !== undefined) {
           lineNum = scope.startLine;
           colNum = lines[lineNum].indexOf(functionName);
        }

        // Skip if we couldn't find the function name position
        if (colNum === -1) {
          return;
        }

        userFunctions[functionName] = {
          arguments: args,
          energy: 0,
          'func-id': 0,
          return: returnType,
          sleep: 0,
          tooltip: '',
          categories: [],
          line: lineNum,
          column: Math.max(0, colNum),
          uri: documentUri
        };
      }
    }
  });

  if (documentUri) {
    const normPath = uriToFilePath(documentUri).toLowerCase();
    visited.add(normPath);
    const includes = extractIncludes(document);
    for (const inc of includes) {
      const resolved = resolveIncludePath(documentUri, inc, includePaths);
      if (resolved && !visited.has(resolved.toLowerCase())) {
        visited.add(resolved.toLowerCase());
        const incUri = filePathToUri(resolved);
        try {
          const content = fs.readFileSync(resolved, 'utf8');
          const incFuncs = scanDocumentForUserFunctions(content, incUri, visited, includePaths);
          for (const [name, func] of Object.entries(incFuncs)) {
            if (!userFunctions[name]) {
              userFunctions[name] = {
                ...func,
                isIncluded: true,
                uri: func.uri || incUri,
              };
            }
          }
        } catch (err) {
          console.error(`Error reading include ${resolved}:`, err);
        }
      }
    }
  }

  return userFunctions;
};

export const scanDocumentForVariables = (
  document: string,
  documentUri?: string,
  visited = new Set<string>(),
  includePaths: string[] = []
): Variables => {
  const allVariables: { [key: string]: LSLVariable } = {};
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');

  const allScopes = getScopes(document);
  let currentPreprocessorDefine: {
    name: string;
    macroParams?: string;
    line: number;
    column: number;
    columnWithType: number;
    valueParts: string[];
    comment?: string;
  } | null = null;

  lines.forEach((line, lineNum) => {
    const quoteRanges = getQuoteRanges(line);

    if (currentPreprocessorDefine) {
      let content = line.trim();
      let endsWithBackslash = false;
      if (content.endsWith('\\')) {
        endsWithBackslash = true;
        content = content.slice(0, -1).trim();
      }
      if (content) {
        currentPreprocessorDefine.valueParts.push(content);
      }
      if (!endsWithBackslash) {
        const val = currentPreprocessorDefine.valueParts.join(' ').trim();
        allVariables[`${currentPreprocessorDefine.name}:${currentPreprocessorDefine.line}`] = {
          name: currentPreprocessorDefine.name,
          type: LSLType.Unknown,
          line: currentPreprocessorDefine.line,
          columnWithType: currentPreprocessorDefine.columnWithType,
          column: currentPreprocessorDefine.column,
          references: [],
          isPreprocessor: true,
          uri: documentUri,
          value: val,
          macroParams: currentPreprocessorDefine.macroParams,
          comment: currentPreprocessorDefine.comment,
        };
        currentPreprocessorDefine = null;
      }
      return;
    }

    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#define')) {
      const defineIdx = line.indexOf('#define');
      const afterDefine = line.slice(defineIdx + '#define'.length).trimStart();
      const macroMatch = afterDefine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\([^)]*\))?/);
      if (macroMatch) {
        const name = macroMatch[1];
        const macroParams = macroMatch[2];
        const nameCol = line.indexOf(name, defineIdx + '#define'.length);

        let remainder = afterDefine.slice(macroMatch[0].length).trim();
        let comment: string | undefined = undefined;

        // Parse comments and value from remainder
        let inQuote = false;
        let commentStart = -1;
        for (let i = 0; i < remainder.length; i++) {
          if (remainder[i] === '"' && (i === 0 || remainder[i - 1] !== '\\')) {
            inQuote = !inQuote;
          } else if (!inQuote) {
            if (remainder[i] === '/' && remainder[i + 1] === '/') {
              commentStart = i;
              comment = remainder.slice(i + 2).trim();
              break;
            } else if (remainder[i] === '/' && remainder[i + 1] === '*') {
              const endComment = remainder.indexOf('*/', i + 2);
              if (endComment !== -1) {
                const commentText = remainder.slice(i + 2, endComment).trim();
                comment = commentText;
                remainder = remainder.slice(0, i) + remainder.slice(endComment + 2);
                i--;
              }
            }
          }
        }

        let valuePart = commentStart !== -1 ? remainder.slice(0, commentStart).trim() : remainder.trim();
        let endsWithBackslash = false;
        if (valuePart.endsWith('\\')) {
          endsWithBackslash = true;
          valuePart = valuePart.slice(0, -1).trim();
        }

        if (endsWithBackslash) {
          currentPreprocessorDefine = {
            name,
            macroParams,
            line: lineNum,
            column: nameCol !== -1 ? nameCol : defineIdx,
            columnWithType: defineIdx,
            valueParts: valuePart ? [valuePart] : [],
            comment,
          };
        } else {
          allVariables[`${name}:${lineNum}`] = {
            name,
            type: LSLType.Unknown,
            line: lineNum,
            columnWithType: defineIdx,
            column: nameCol !== -1 ? nameCol : defineIdx,
            references: [],
            isPreprocessor: true,
            uri: documentUri,
            value: valuePart,
            macroParams,
            comment,
          };
        }
      }
      return;
    }

    // determine all defined variables
    const lineVariables = line.match(
      /(integer|float|key|string|vector|rotation|quaternion|list) +([a-zA-Z_][a-zA-Z0-9_]*)(?=[^(]*?[=;,)])/gm
    );
    if (lineVariables?.length) {
      lineVariables.forEach((match) => {
        const colNum = line.indexOf(match);
        if (
          commentedOutSections.isInSection(lineNum, colNum) ||
          quoteRanges.isInRange(colNum)
        )
          return;

        let trimmedMatch = match;
        while (trimmedMatch.includes('  '))
          trimmedMatch = trimmedMatch.replace('  ', ' ');
        const [type, name] = trimmedMatch.split(' ');

        // Check if this variable is a function/event parameter
        // by looking at the scope that contains this line
        let currentScope = null;
        for (let i = allScopes.scopes.length - 1; i >= 0; i--) {
          const scope = allScopes.scopes[i];
          if (scope.startLine <= lineNum &&
              (scope.endLine === undefined || lineNum <= scope.endLine) &&
              scope.name) {
            currentScope = scope;
            break;
          }
        }
        // Check if this line has a function/event declaration signature
        // Function/event names are lowercase and followed by parentheses
        const funcNameMatch = trimmedLine.match(/^[a-z_][a-zA-Z0-9_]*\s*\([^)]*\)/);
        const isParameter = currentScope?.name !== undefined && !!funcNameMatch;

        // A variable is global if it is declared outside of any named scope
        // (e.g. not inside a function or state block). In LSL, global variables
        // are visible throughout the entire script regardless of declaration order.
        const isGlobal = currentScope === null;

        allVariables[`${name}:${lineNum}`] = {
          name,
          type: convertToType(type),
          line: lineNum,
          columnWithType: colNum,
          column:
            line.slice(colNum).search(new RegExp(`\\b${name}\\b`, 'gm')) +
            colNum,
          references: [],
          isParameter,
          isGlobal,
          uri: documentUri,
        };
      });
    }

    // look for references of existing variables
    Object.keys(allVariables).forEach((variableKey) => {
      const variable = allVariables[variableKey];
      const references = line.match(new RegExp(`\\b${variable.name}\\b`, 'gm'));
      if (references?.length) {
        references.forEach((_, refNum) => {
          let colNum = -1;
          for (let i = 0; i <= refNum; i++) {
            colNum =
              line
                .slice(colNum + 1)
                .search(new RegExp(`\\b${variable.name}\\b`, 'gm')) +
              colNum +
              1;
          }
          if (
            !commentedOutSections.isInSection(lineNum, colNum) &&
            !quoteRanges.isInRange(colNum) &&
            !(lineNum === variable.line && colNum === variable.column) &&
            allScopes.isInScope(
              { line: lineNum, character: colNum },
              { line: variable.line, character: variable.column }
            )
          ) {
            allVariables[variableKey].references.push({
              line: lineNum,
              character: colNum,
              isWrite:
                line
                  .slice(colNum)
                  .search(
                    new RegExp(`(?<=(?:\\+\\+|\\-\\-)) *(${variable.name})`)
                  ) === 0 ||
                line
                  .slice(colNum)
                  .search(
                    new RegExp(
                      `(${variable.name})(?= *(?:[+\\-*\\/%]=|\\+\\+|\\-\\-|=[^=]))`
                    )
                  ) === 0,
            });
          }
        });
      }
    });
  });

  if (documentUri) {
    const normPath = uriToFilePath(documentUri).toLowerCase();
    visited.add(normPath);
    const includes = extractIncludes(document);
    for (const inc of includes) {
      const resolved = resolveIncludePath(documentUri, inc, includePaths);
      if (resolved && !visited.has(resolved.toLowerCase())) {
        visited.add(resolved.toLowerCase());
        const incUri = filePathToUri(resolved);
        try {
          const content = fs.readFileSync(resolved, 'utf8');
          const incVars = scanDocumentForVariables(content, incUri, visited, includePaths);
          for (const incVar of Object.values(incVars)) {
            const key = `${incVar.uri || incUri}:${incVar.name}:${incVar.line}`;
            if (!allVariables[key]) {
              allVariables[key] = {
                ...incVar,
                isIncluded: true,
                uri: incVar.uri || incUri,
              };
            }
          }
        } catch (err) {
          console.error(`Error reading include ${resolved}:`, err);
        }
      }
    }
  }

  return allVariables;
};

const allFunctions: { [key: string]: LSLFunction } = JSON.parse(
  fs.readFileSync(`${__dirname}/../../functions.json`, { encoding: 'utf8' })
);

export const scanDocumentForFunctionCalls = (document: string): LSLFunctionCall[] => {
  const functionCalls: LSLFunctionCall[] = [];
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');

  lines.forEach((line, lineNum) => {
    const quoteRanges = getQuoteRanges(line);
    const functionCallMatches = line.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*\s*(?=\()/gm);
    for (const match of functionCallMatches) {
      const colNum = match.index ?? -1;
      if (
        colNum === -1 ||
        commentedOutSections.isInSection(lineNum, colNum) ||
        quoteRanges.isInRange(colNum)
      ) {
        continue;
      }
      const functionName = match[0].trim();
      functionCalls.push({
        line: lineNum,
        character: colNum,
        functionName,
      });
    }
  });
  
  return functionCalls;
};

export type JumpLabelMap = {
  definitions: { [name: string]: LSLJumpLabel }
  usages: { [name: string]: LSLJumpLabel[] }
};

/**
 * Scans the document for LSL jump labels: `@label;` (definitions) and
 * `jump label;` (usages). Used for goto-definition and to suppress
 * false-positive undeclared-variable diagnostics.
 */
export const scanDocumentForJumpLabels = (
  document: string,
  documentUri?: string
): JumpLabelMap => {
  const definitions: { [name: string]: LSLJumpLabel } = {};
  const usages: { [name: string]: LSLJumpLabel[] } = {};
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');

  lines.forEach((line, lineNum) => {
    // Find jump target definitions: @label (followed by ; on this line)
    const labelDefMatches = line.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g);
    for (const match of labelDefMatches) {
      const colNum = match.index ?? -1;
      if (colNum === -1) continue;
      if (commentedOutSections.isInSection(lineNum, colNum)) continue;
      const name = match[1];
      if (!definitions[name]) {
        definitions[name] = {
          name,
          line: lineNum,
          character: colNum + 1, // position of label name (after @)
          uri: documentUri,
          isDefinition: true,
        };
      }
    }

    // Find jump usages: jump label
    const jumpMatches = line.matchAll(/\bjump\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
    for (const match of jumpMatches) {
      const colNum = match.index ?? -1;
      if (colNum === -1) continue;
      if (commentedOutSections.isInSection(lineNum, colNum)) continue;
      const name = match[1];
      if (!usages[name]) usages[name] = [];
      const labelOffset = match[0].indexOf(match[1]);
      usages[name].push({
        name,
        line: lineNum,
        character: colNum + labelOffset,
        uri: documentUri,
        isDefinition: false,
      });
    }
  });

  return { definitions, usages };
};
