import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  serializeVector,
  deserializeVector,
} from '../../src/memory/embeddings';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  it('is scale-invariant (normalizes magnitude)', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([10, 20, 30]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity(Float32Array.from([1, 2]), Float32Array.from([1]))).toBe(0);
  });

  it('returns 0 for a zero-magnitude vector', () => {
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });
});

describe('serializeVector / deserializeVector', () => {
  it('round-trips a vector exactly', () => {
    const original = Float32Array.from([0.1, -0.5, 3.14159, 42, -0.0001]);
    const blob = serializeVector(original);
    const restored = deserializeVector(blob);
    expect(restored).not.toBeNull();
    expect(restored!.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored![i]).toBeCloseTo(original[i]!, 6);
    }
  });

  it('round-trips through a copied (offset) buffer', () => {
    const original = Float32Array.from([1, 2, 3, 4]);
    const blob = serializeVector(original);
    // Simulate sqlite returning a Buffer slice with a non-zero byte offset
    const padded = Buffer.concat([Buffer.from([0, 0, 0]), blob]);
    const sliced = padded.subarray(3);
    const restored = deserializeVector(sliced);
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual([1, 2, 3, 4]);
  });

  it('returns null for empty or invalid blobs', () => {
    expect(deserializeVector(null)).toBeNull();
    expect(deserializeVector(Buffer.alloc(0))).toBeNull();
    expect(deserializeVector(Buffer.from([1, 2, 3]))).toBeNull(); // not divisible by 4
  });
});
