import getCommentedOutSections from './comments';
import { LSLVariable } from './lslTypes';
import getQuoteRanges from './quoteRanges';
import { convertToType } from './types';

let allVariables: { [key: string]: LSLVariable } = {};

// colNumber is inclusive on start and exclusive on end
type Scope = {
  parentIndex: number;
  startLine: number;
  startCol: number;
  endLine?: number;
  endCol?: number;
};

const scopes: Scope[] = [
  {
    parentIndex: -1,
    startLine: 0,
    startCol: 0,
  },
];

export const scanDocument = (document: string) => {
  allVariables = {};
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');
  let currentScopeIndex = 0;

  // Step 1: determine where the curly braces are, note down line number and column number
  lines.forEach((line, lineNum) => {
    const quoteRanges = getQuoteRanges(line);
    line.split('').forEach((char, colNum) => {
      if (
        !quoteRanges.isInRange(colNum) &&
        !commentedOutSections.isInSection(lineNum, colNum)
      ) {
        if (char === '{') {
          scopes.push({
            parentIndex: currentScopeIndex,
            startLine: lineNum,
            startCol: colNum,
          });
          currentScopeIndex = scopes.length - 1;
        } else if (char === '}') {
          scopes[currentScopeIndex].endLine = lineNum;
          scopes[currentScopeIndex].endCol = colNum;
          currentScopeIndex = scopes[currentScopeIndex].parentIndex;
        }
      }
    });
  });

  lines.forEach((line, lineNum) => {
    const quoteRanges = getQuoteRanges(line);

    // determine all defined variables
    const lineVariables = line.match(
      /(integer|float|key|string|vector|rotation|quarternion|list)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?=.*?[;,)])/gm
    );
    if (lineVariables?.length) {
      lineVariables.forEach((match) => {
        const colNum = line.indexOf(match);
        if (
          commentedOutSections.isInSection(lineNum, colNum) ||
          quoteRanges.isInRange(colNum)
        )
          return;

        const [type, name] = match.split(' ');
        if (!allVariables[name]) {
          allVariables[name] = {
            name,
            type: convertToType(type),
            line: lineNum,
            column: line.indexOf(name, colNum),
            references: [],
          };
        }
      });
    }

    // look for references of existing variables
    Object.keys(allVariables).forEach((variableName) => {
      const references = line.match(new RegExp(`\\b${variableName}\\b`, 'gm'));
      if (references?.length) {
        references.forEach((_, refNum) => {
          let colNum = -1;
          for (let i = 0; i <= refNum; i++) {
            colNum = line.indexOf(variableName, colNum + 1);
          }
          if (
            !commentedOutSections.isInSection(lineNum, colNum) &&
            !quoteRanges.isInRange(colNum) &&
            !(
              lineNum === allVariables[variableName].line &&
              colNum === allVariables[variableName].column
            )
          ) {
            allVariables[variableName].references.push({
              line: lineNum,
              character: colNum,
            });
          }
        });
      }
    });
  });

  console.log(allVariables);
};
