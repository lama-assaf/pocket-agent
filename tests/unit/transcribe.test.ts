/**
 * Unit tests for the local audio transcription utility.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockAsr = vi.fn();
const mockPipeline = vi.fn();
const mockDecodeFile = vi.fn();
const mockFree = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
  env: {},
}));

vi.mock('ogg-opus-decoder', () => {
  const OggOpusDecoder = vi.fn(function OggOpusDecoder() {
    return {
      ready: Promise.resolve(),
      decodeFile: mockDecodeFile,
      free: mockFree,
    };
  });

  return { OggOpusDecoder };
});

import {
  decodeOggOpus,
  downmixToMono,
  isTranscriptionAvailable,
  resample,
  transcribeAudio,
} from '../../src/utils/transcribe';

describe('transcribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsr.mockResolvedValue({ text: 'Hello from local Whisper' });
    mockPipeline.mockResolvedValue(mockAsr);
    mockDecodeFile.mockResolvedValue({
      channelData: [new Float32Array([0, 0.5, -0.5, 0])],
      sampleRate: 16000,
    });
  });

  describe('transcribeAudio', () => {
    it('transcribes OGG/Opus audio locally', async () => {
      const result = await transcribeAudio(Buffer.from('fake-ogg-opus'), 'ogg');

      expect(result.success).toBe(true);
      expect(result.text).toBe('Hello from local Whisper');
      expect(result.duration).toBeTypeOf('number');
      expect(mockDecodeFile).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        dtype: 'fp32',
      });
      expect(mockAsr).toHaveBeenCalledWith(expect.any(Float32Array));
      expect(mockFree).toHaveBeenCalledTimes(1);
    });

    it('returns an error for unsupported local audio formats', async () => {
      const result = await transcribeAudio(Buffer.from('fake-audio'), 'mp3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Local transcription currently supports Telegram OGG/Opus');
      expect(mockPipeline).not.toHaveBeenCalled();
    });

    it('returns an error when local decoding fails', async () => {
      mockDecodeFile.mockRejectedValue(new Error('Decoder failed'));

      const result = await transcribeAudio(Buffer.from('fake-audio'), 'ogg');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Decoder failed');
      expect(mockFree).toHaveBeenCalledTimes(1);
    });

    it('handles unknown error types', async () => {
      mockDecodeFile.mockRejectedValue('string error');

      const result = await transcribeAudio(Buffer.from('fake-audio'), 'ogg');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown transcription error');
    });
  });

  describe('decodeOggOpus', () => {
    it('throws when decoded audio is empty', async () => {
      mockDecodeFile.mockResolvedValue({ channelData: [], sampleRate: 16000 });

      await expect(decodeOggOpus(Buffer.from('empty'))).rejects.toThrow('Decoded audio is empty');
      expect(mockFree).toHaveBeenCalledTimes(1);
    });
  });

  describe('audio helpers', () => {
    it('downmixes multiple channels to mono', () => {
      const mixed = downmixToMono([
        new Float32Array([1, 0, -1]),
        new Float32Array([0, 1, -1]),
      ]);

      expect(Array.from(mixed)).toEqual([0.5, 0.5, -1]);
    });

    it('resamples audio with linear interpolation', () => {
      const output = resample(new Float32Array([0, 1, 0]), 3, 2);

      expect(output.length).toBe(2);
      expect(output[0]).toBeCloseTo(0);
      expect(output[1]).toBeCloseTo(0.5);
    });
  });

  describe('isTranscriptionAvailable', () => {
    it('returns true because transcription is bundled locally', () => {
      expect(isTranscriptionAvailable()).toBe(true);
    });
  });
});
