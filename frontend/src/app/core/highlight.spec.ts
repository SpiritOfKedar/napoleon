import { queryTerms, splitHighlight } from './highlight';

describe('queryTerms', () => {
  it('lowercases, strips punctuation and drops stop words', () => {
    expect(queryTerms('The Q3 budget?')).toEqual(['q3', 'budget']);
  });
});

describe('splitHighlight', () => {
  it('marks matching words case-insensitively', () => {
    expect(splitHighlight('We discussed the Budget today', 'budget')).toEqual([
      { text: 'We discussed the ', match: false },
      { text: 'Budget', match: true },
      { text: ' today', match: false },
    ]);
  });

  it('matches word prefixes but not the middle of words', () => {
    const parts = splitHighlight('budgets and rebudget', 'budget');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['budget']);
  });

  it('returns the whole text unmarked when nothing matches', () => {
    expect(splitHighlight('hello world', 'budget')).toEqual([{ text: 'hello world', match: false }]);
  });

  it('treats regex characters in the query literally', () => {
    expect(splitHighlight('cost (c++) review', 'c++')).toEqual([
      { text: 'cost (', match: false },
      { text: 'c++', match: true },
      { text: ') review', match: false },
    ]);
  });
});
