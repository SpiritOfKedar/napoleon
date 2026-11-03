import { formatTimestamp, parseSeconds, formatEta, formatDuration, formatClock } from './time';

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

describe('formatEta', () => {
  it('rounds to friendly units', () => {
    expect(formatEta(20)).toBe('Less than a minute remaining');
    expect(formatEta(4 * 60 + 10)).toBe('About 4 minutes remaining');
    expect(formatEta(72 * 60)).toBe('About 1 hr 12 min remaining');
    expect(formatEta(120 * 60)).toBe('About 2 hr remaining');
  });

  it('formats clock positions', () => {
    expect(formatClock(245)).toBe('4:05');
    expect(formatClock(2091)).toBe('34:51');
    expect(formatClock(3730)).toBe('1:02:10');
  });
});

describe('formatDuration', () => {
  it('formats short and long durations', () => {
    expect(formatDuration(36)).toBe('36s');
    expect(formatDuration(252)).toBe('4m 12s');
    expect(formatDuration(4081)).toBe('1h 08m');
    expect(formatDuration(null)).toBe('—');
  });
});
