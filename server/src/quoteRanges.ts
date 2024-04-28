type QuoteRanges = {
  ranges: { start: number, end: number }[];
  isInRange: (colNumber: number) => boolean;
};

const getQuoteRanges = (line: string): QuoteRanges => {
  const ranges: { start: number; end: number }[] = [];
  let start = -1;
  let previousChar: string;
  line.split('').forEach((char, index) => {
    if (char === '"' && previousChar !== '\\' && start === -1) {
      start = index;
    } else if (char === '"' && previousChar !== '\\' && start !== -1) {
      ranges.push({ start, end: index });
      start = -1;
    }
    previousChar = char;
  });

  return {
    ranges,
    isInRange: (colNumber: number) => {
      let isInQuote = false;
      ranges.forEach(range => {
        if (colNumber + 1 >= range.start && colNumber + 1 <= range.end) {
          isInQuote = true;
        }
      });
      return isInQuote;
    }
  };
};

export default getQuoteRanges;
