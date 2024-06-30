type QuoteRange = {
  start: number;
  end: number;
};

type QuoteRanges = {
  ranges: QuoteRange[];
  isInRange: (colNumber: number) => boolean;
};

const isInQuoteRange = (ranges: QuoteRange[]) => (colNumber: number) => {
  let isInQuote = false;
  ranges.forEach(range => {
    if (colNumber >= range.start && colNumber < range.end) {
      isInQuote = true;
    }
  });
  return isInQuote;
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
    isInRange: isInQuoteRange(ranges)
  };
};

export default getQuoteRanges;
