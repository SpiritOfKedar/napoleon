import { formatTimestamp, parseSeconds } from './time';

describe('formatTimestamp', () => {
  it('formats zero', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
  });

  it('pads seconds and minutes', () => {
    expect(formatTimestamp(5)).toBe('00:00:05');
    expect(formatTimestamp(65)).toBe('00:01:05');
  });

  it('formats hours', () => {
    expect(formatTimestamp(14 * 60 + 32)).toBe('00:14:32');
    expect(formatTimestamp(3600)).toBe('01:00:00');
    expect(formatTimestamp(3 * 3600 + 25 * 60 + 9)).toBe('03:25:09');
  });

  it('truncates fractional seconds rather than rounding up', () => {
    expect(formatTimestamp(59.99)).toBe('00:00:59');
  });

  it('handles recordings over 99 hours', () => {
    expect(formatTimestamp(100 * 3600)).toBe('100:00:00');
  });

  it('treats invalid input as zero', () => {
    expect(formatTimestamp(-3)).toBe('00:00:00');
    expect(formatTimestamp(NaN)).toBe('00:00:00');
    expect(formatTimestamp(null)).toBe('00:00:00');
    expect(formatTimestamp(undefined)).toBe('00:00:00');
  });
});

describe('parseSeconds', () => {
  it('parses numbers', () => {
    expect(parseSeconds('872')).toBe(872);
    expect(parseSeconds('12.5')).toBe(12.5);
  });

  it('rejects empty, negative and non-numeric values', () => {
    expect(parseSeconds(null)).toBeNull();
    expect(parseSeconds('')).toBeNull();
    expect(parseSeconds('-1')).toBeNull();
    expect(parseSeconds('abc')).toBeNull();
  });
});
