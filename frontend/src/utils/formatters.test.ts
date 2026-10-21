import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatPercent,
  calcPercent,
  formatDuration,
  truncate,
  capitalize,
  slugToLabel,
  getMotivationText,
} from './formatters';

describe('formatters utility suite', () => {
  it('formats numbers correctly', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(12345)).toBe('12.3K');
    expect(formatNumber(1000000)).toBe('1M');
    expect(formatNumber(1500000)).toBe('1.5M');
  });

  it('formats percentages correctly', () => {
    expect(formatPercent(49.4)).toBe('49.4%');
    expect(formatPercent(50, 0)).toBe('50%');
  });

  it('calculates percentages safely', () => {
    expect(calcPercent(5, 10)).toBe(50);
    expect(calcPercent(1, 3)).toBe(33.3);
    expect(calcPercent(10, 0)).toBe(0);
  });

  it('formats duration into readable human text', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(62)).toBe('1m 02s');
    expect(formatDuration(3661)).toBe('1h 01m');
  });

  it('truncates strings properly', () => {
    expect(truncate('Hello world', 20)).toBe('Hello world');
    expect(truncate('Hello world long string', 8)).toBe('Hello...');
  });

  it('capitalizes strings and formats slugs', () => {
    expect(capitalize('developer')).toBe('Developer');
    expect(slugToLabel('dynamic_programming')).toBe('Dynamic Programming');
    expect(slugToLabel('graph-traversal')).toBe('Graph Traversal');
  });

  it('produces deterministic motivational copy', () => {
    expect(getMotivationText(0, false)).toContain("Don't break your streak");
    expect(getMotivationText(7, true)).toContain('One week down');
  });
});
