import { LSLVariable } from './lslTypes';

export const getQuoteRanges = (line: string) => {
  const quoteRanges: { start: number; end: number }[] = [];
  let start = -1;
  let previousChar: string;
  line.split('').forEach((char, index) => {
    if (char === '"' && previousChar !== '\\' && start === -1) {
      start = index;
    } else if (char === '"' && previousChar !== '\\' && start !== -1) {
      quoteRanges.push({ start, end: index });
      start = -1;
    }
    previousChar = char;
  });

  return quoteRanges;
};

const allVariables: { [key: string]: LSLVariable } = {};

type CommentedOutSection = {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

let commentedOutSections: CommentedOutSection[] = [];

export const getCommentedOutSections = (document: string) => {
  commentedOutSections = [];
  const lines = document.split('\n');
  let isInCommentBlock = false;
  let commentBlock: CommentedOutSection | null = null;
  lines.forEach((line, i) => {
    if (line.includes('//')) {
      commentedOutSections.push({ startLine: i, startCol: line.indexOf('//'), endLine: i, endCol: line.length });
    } else if (line.includes('/*') && line.includes('*/')) {
      commentedOutSections.push({ startLine: i, startCol: line.indexOf('/*'), endLine: i, endCol: line.indexOf('*/') + 2 });
    } else if (line.includes('/*') && !isInCommentBlock) {
      isInCommentBlock = true;
      commentBlock = { startLine: i, startCol: line.indexOf('/*'), endLine: i, endCol: line.indexOf('*/') + 2 };
    } else if (isInCommentBlock && commentBlock !== null && line.includes('*/')) {
      isInCommentBlock = false;
      commentBlock.endLine = i;
      commentBlock.endCol = line.indexOf('*/') + 2;
      commentedOutSections.push(commentBlock);
      commentBlock = null;
    }
  });
  // console.log(JSON.stringify(commentedOutSections));
};

const isInCommentedOutSection = (line: number, col: number) => {
  return commentedOutSections.some(section => 
    line > section.startLine && line < section.endLine ||
    line === section.startLine && line === section.endLine && col >= section.startCol && col < section.endCol ||
    line === section.startLine && col >= section.startCol ||
    line === section.endLine && col < section.endCol
  );
};

const scanDocument = (document: string) => {
  const lines = document.split('\n');
  lines.forEach((line, i) => {
    const quoteRanges = getQuoteRanges(line);
    const lineVariables = line.match(/(integer|float|key|string|vector|rotation|quarternion|list) ([a-zA-Z_][a-zA-Z0-9_]*)(?=.*?[;,)])/gm);
    if (lineVariables) {
      lineVariables.forEach(match => {
        const colNumber = line.indexOf(match);
        if (
          isInCommentedOutSection(i, colNumber) ||
          quoteRanges.some(range => range.start <= colNumber && range.end >= colNumber)
        ) return;
        const [type, name] = match.split(' ');
        if (!allVariables[name]) {
          allVariables[name] = { name, type, line: i, column: colNumber, references: [] };
        }
      });

      Object.keys(allVariables).forEach(variableName => {
        const indexOfVariable = line.indexOf(variableName);
        if (
          allVariables[variableName] &&
          !isInCommentedOutSection(i, indexOfVariable) &&
          !quoteRanges.some(range => range.start <= indexOfVariable && range.end >= indexOfVariable)
        ) {
          allVariables[variableName].references.push({ line: i, character: indexOfVariable });
        }
      });
    }
  });
};

// const determineDefinedVariables = (lines: string[], lineNumber: number): LSLVariable[] => {
//   let currentLineNumber = lineNumber;
//   const result: LSLVariable[] = [];
//   const bracketMatch: string[] = [];
//   while (currentLineNumber >= 0) {
//     const line = lines[currentLineNumber];
//     const quoteRanges = getQuoteRanges(line);
//     const lineVariables = line.match(/(integer|float|key|string|vector|rotation|quarternion|list) ([a-zA-Z_][a-zA-Z0-9_]*)(?=.*?[;,)])/gm);
//     if (lineVariables) {
//       lineVariables.forEach(match => {
//         const colNumber = line.indexOf(match);
//         if (
//           isInCommentedOutSection(currentLineNumber, colNumber) ||
//           quoteRanges.some(range => range.start <= colNumber && range.end >= colNumber)
//         ) return;
//         const [type, name] = match.split(' ');
//         result.push({ name, type, line: currentLineNumber, column: colNumber });
//       });
//     }
//     currentLineNumber--;
//   }
//   console.log(result);
//   return result;
// };