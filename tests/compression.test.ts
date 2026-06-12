import { describe, expect, it } from 'vitest';
import { compressContext } from '../src/lib/compression.js';

describe('compressContext', () => {
  it('keeps important log lines while reducing token count', () => {
    const input = [
      ...Array.from({ length: 120 }, (_, index) => `info request ${index} completed`),
      'ERROR payment failed: insufficient_funds',
      'Stack trace: PaymentService.charge',
      ...Array.from({ length: 120 }, (_, index) => `info request ${index + 120} completed`)
    ].join('\n');

    const result = compressContext(input, { maxTokens: 180 });

    expect(result.originalTokens).toBeGreaterThan(result.compressedTokens);
    expect(result.compressedTokens).toBeLessThanOrEqual(180);
    expect(result.compressedText).toContain('ERROR payment failed');
    expect(result.compressedText).toContain('Stack trace');
    expect(result.compressedText).toContain('omitted');
  });

  it('returns the original text when it is already small enough', () => {
    const input = 'Use PostgreSQL for durable project memory.';
    const result = compressContext(input, { maxTokens: 100 });

    expect(result.compressedText).toBe(input);
    expect(result.originalTokens).toBe(result.compressedTokens);
  });
});
