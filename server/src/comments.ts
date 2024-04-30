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
    line === section.startLine && col >= section.startCol ||
    line === section.endLine && col < section.endCol
  );
};

// line numbers are zero-based
const getCommentedOutSections = (document: string): CommmentedOutSections => {
  const commentedOutSections: CommentedOutSection[] = [];
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
  return {
    sections: commentedOutSections,
    isInSection: isInCommentedOutSection(commentedOutSections)
  };
};

export default getCommentedOutSections;
