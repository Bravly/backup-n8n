import { describe, it, expect } from 'vitest';
import { slugify, parseArgs } from '../src/cli';

describe('slugify', () => {
  it('turns name into safe slug', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('  --A  B  -- ')).toBe('a-b');
  });
});

describe('parseArgs', () => {
  it('parses baseUrl and apiKey positionally', () => {
    const parsed: any = parseArgs(['node', 'cli', 'https://x', 'key']);
    expect(parsed.baseUrl).toBe('https://x');
    expect(parsed.apiKey).toBe('key');
  });

  it('supports flags', () => {
    const p: any = parseArgs(['node', 'cli', 'https://x', 'k', '--pretty', '--dir', '--out', 'outdir']);
    expect(p.pretty).toBe(true);
    expect(p.dir).toBe(true);
    expect(p.out).toBe('outdir');
  });
});
