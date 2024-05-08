import getCommentedOutSections from './comments';
import { LSLVariable } from './lslTypes';
import getQuoteRanges from './quoteRanges';
import { convertToType } from './types';
import getScopes from './scopes';

export type Variables = { [key: string]: LSLVariable };

const scanDocument = (document: string): Variables => {
  const allVariables: { [key: string]: LSLVariable } = {};
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');

  const allScopes = getScopes(document);

  lines.forEach((line, lineNum) => {
    const quoteRanges = getQuoteRanges(line);

    // determine all defined variables
    const lineVariables = line.match(
      /(integer|float|key|string|vector|rotation|quarternion|list) +([a-zA-Z_][a-zA-Z0-9_]*)(?=.*?[;,)])/gm
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
        while (trimmedMatch.includes('  ')) trimmedMatch = trimmedMatch.replace('  ', ' ');
        const [type, name] = trimmedMatch.split(' ');
        // if (!allVariables[name]) {
          allVariables[`${name}:${lineNum}`] = {
            name,
            type: convertToType(type),
            line: lineNum,
            columnWithType: colNum,
            column:
              line.slice(colNum).search(new RegExp(`\\b${name}\\b`, 'gm')) +
              colNum,
            references: [],
          };
        // }
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
            colNum = line
              .slice(colNum + 1)
              .search(new RegExp(`\\b${variable.name}\\b`, 'gm')) + colNum + 1;
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

  console.log(allVariables);

  return allVariables;
};

export default scanDocument;
