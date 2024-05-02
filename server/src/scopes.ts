import { Position } from 'vscode-languageserver';
import getCommentedOutSections from './comments';
import getQuoteRanges from './quoteRanges';

type Scopes = {
  scopes: Scope[];
  isInScope: (
    referencePosition: Position,
    definitionPosition: Position
  ) => boolean;
};

// colNumber is inclusive on start and exclusive on end
type Scope = {
  parentIndex: number;
  startLine: number;
  startCol: number;
  endLine?: number;
  endCol?: number;
};

const positionToScopeId =
  (scopes: Scope[]) =>
  ({ line, character }: Position): number => {
		let result = -1;
    scopes.forEach(({ startLine, startCol, endLine, endCol }, index) => {
      if (
        (line > startLine || (
					line === startLine && character >= startCol
				)) &&
        (line < endLine! || (
					line === endLine && character < endCol!
				))
      )
        result = index;
    });

    return result;
  };

const isReferenceInScopeOfDefinition =
  (scopes: Scope[]) =>
  (referencePosition: Position, definitionPosition: Position) => {
    const getScopeId = positionToScopeId(scopes);
    const definitionScopeId = getScopeId(definitionPosition);
    const referenceScopeId = getScopeId(referencePosition);
    let currentScopeId = referenceScopeId;

    while (currentScopeId !== -1) {
      if (currentScopeId === definitionScopeId) return true;
      currentScopeId = scopes[currentScopeId].parentIndex;
    }
    return false;
  };

const getScopes = (document: string): Scopes => {
  const scopes: Scope[] = [
    {
      parentIndex: -1,
      startLine: 0,
      startCol: 0,
			endLine: document.split('\n').length + 1,
			endCol: 0
    },
  ];

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

  return {
    scopes,
    isInScope: isReferenceInScopeOfDefinition(scopes),
  };
};

export default getScopes;
