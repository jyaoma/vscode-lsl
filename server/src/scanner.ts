import getCommentedOutSections from './comments';
import { LSLVariable } from './lslTypes';
import getQuoteRanges from './quoteRanges';

const allVariables: { [key: string]: LSLVariable } = {};

export const scanDocument = (document: string) => {
  const commentedOutSections = getCommentedOutSections(document);
  const lines = document.split('\n');

  // Step 1: determine where the curly braces are, note down line number and column number
	lines.forEach((line, i) => {
		const quoteRanges = getQuoteRanges(line);
		line.split('').forEach(char => {
      
    });
	});

//   lines.forEach((line, i) => {
//     const quoteRanges = getQuoteRanges(line);
//     const lineVariables = line.match(/(integer|float|key|string|vector|rotation|quarternion|list) ([a-zA-Z_][a-zA-Z0-9_]*)(?=.*?[;,)])/gm);
//     if (lineVariables) {
//       lineVariables.forEach(match => {
//         const colNumber = line.indexOf(match);
//         if (
//           isInCommentedOutSection(i, colNumber) ||
//           quoteRanges.some(range => range.start <= colNumber && range.end >= colNumber)
//         ) return;
//         const [type, name] = match.split(' ');
//         if (!allVariables[name]) {
//           allVariables[name] = { name, type, line: i, column: colNumber, references: [] };
//         }
//       });

//       Object.keys(allVariables).forEach(variableName => {
//         const indexOfVariable = line.indexOf(variableName);
//         if (
//           allVariables[variableName] &&
//           !isInCommentedOutSection(i, indexOfVariable) &&
//           !quoteRanges.some(range => range.start <= indexOfVariable && range.end >= indexOfVariable)
//         ) {
//           allVariables[variableName].references.push({ line: i, character: indexOfVariable });
//         }
//       });
//     }
//   });
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