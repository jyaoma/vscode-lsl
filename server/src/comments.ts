import getQuoteRanges from './quoteRanges';

type CommentedOutSection = {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

type CommmentedOutSections = {
  sections: CommentedOutSection[];
  isInSection: (line: number, col: number) => boolean;
}

const isInCommentedOutSection = (commentedOutSections: CommentedOutSection[]) => (line: number, col: number) => {
  return commentedOutSections.some(section => 
    line > section.startLine && line < section.endLine ||
    line === section.startLine && line === section.endLine && col >= section.startCol && col < section.endCol ||
    line === section.startLine && line !== section.endLine && col >= section.startCol ||
    line !== section.startLine && line === section.endLine && col < section.endCol
  );
};

// line numbers are zero-based
const getCommentedOutSections = (document: string): CommmentedOutSections => {
  const commentedOutSections: CommentedOutSection[] = [];
  const lines = document.split('\n');
  let isInCommentBlock = false;
  let commentBlock: CommentedOutSection | null = null;
  lines.forEach((line, i) => {
    const quoteRanges = getQuoteRanges(line);
    const noQuoteRanges = [];
    const indexMap = [];
    for (let j = line.length; j >= 0; j--) {
      if (!quoteRanges.isInRange(j)) {
        noQuoteRanges.push(line[j]);
        indexMap.push(j);
      }
    }
    const noQuoteLine = noQuoteRanges.reverse().join('');
    indexMap.reverse();
    
    if (noQuoteLine.includes('//')) {
      commentedOutSections.push({
        startLine: i,
        startCol: indexMap[noQuoteLine.indexOf('//')],
        endLine: i,
        endCol: line.length + 1,
      });
    } else if (noQuoteLine.includes('/*') && noQuoteLine.includes('*/')) {
      commentedOutSections.push({
        startLine: i,
        startCol: indexMap[noQuoteLine.indexOf('/*')],
        endLine: i,
        endCol: indexMap[noQuoteLine.indexOf('*/')] + 2,
      });
    } else if (noQuoteLine.includes('/*') && !isInCommentBlock) {
      isInCommentBlock = true;
      commentBlock = {
        startLine: i,
        startCol: indexMap[noQuoteLine.indexOf('/*')],
        endLine: i,
        endCol: indexMap[noQuoteLine.indexOf('*/')] + 2,
      };
    } else if (
      isInCommentBlock &&
      commentBlock !== null &&
      noQuoteLine.includes('*/')
    ) {
      isInCommentBlock = false;
      commentBlock.endLine = i;
      commentBlock.endCol = indexMap[noQuoteLine.indexOf('*/')] + 2;
      commentedOutSections.push(commentBlock);
      commentBlock = null;
    }
  });
  // console.log(JSON.stringify(commentedOutSections));
  return {
    sections: commentedOutSections,
    isInSection: isInCommentedOutSection(commentedOutSections)
  };
};

export default getCommentedOutSections;
