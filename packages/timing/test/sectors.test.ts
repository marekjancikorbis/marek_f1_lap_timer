import { describe, expect, it } from 'vitest';
import { bigSectorEnds, bigSplits } from '../src';

describe('big sectors', () => {
  it('ends at the minisector boundaries closest to the thirds', () => {
    // 10 minisectors of 100 m: thirds at 333 m and 667 m.
    const b = Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
    expect(bigSectorEnds(b)).toEqual([2, 6, 9]);
  });

  it('keeps every big sector non-empty on uneven routes', () => {
    expect(bigSectorEnds([100, 900, 950, 1000])).toEqual([0, 1, 3]);
    expect(bigSectorEnds([50, 60, 70, 1000])).toEqual([1, 2, 3]);
  });

  it('uses short routes as they are', () => {
    expect(bigSectorEnds([400, 800])).toEqual([0, 1]);
  });

  it('picks the splits at those ends', () => {
    expect(bigSplits([10, 20, 30, 40, 50], [1, 3, 4])).toEqual([20, 40, 50]);
  });
});
