import getCommentedOutSections from './comments';
import { LSLVariable } from './lslTypes';
import getQuoteRanges from './quoteRanges';
import { convertToType } from './types';
import getScopes from './scopes';

let allVariables: { [key: string]: LSLVariable } = {};

export const scanDocument = (document: string) => {
  allVariables = {};
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');

	const allScopes = getScopes(document);

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
					const variable = allVariables[variableName]; 
          if (
            !commentedOutSections.isInSection(lineNum, colNum) &&
            !quoteRanges.isInRange(colNum) &&
            !(lineNum === variable.line && colNum === variable.column) &&
						allScopes.isInScope(
							{ line: lineNum, character: colNum }, 
							{ line: variable.line, character: variable.column })
          ) {
            allVariables[variableName].references.push({
              line: lineNum,
              character: colNum
            });
          }
        });
      }
    });
  });

  console.log(allVariables);
};
