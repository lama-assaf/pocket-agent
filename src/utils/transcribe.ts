/**
 * Audio transcription utility using a local Whisper model.
 * Uses @huggingface/transformers and downloads the model once on first use.
 */

import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

const TARGET_SAMPLE_RATE = 16000;
const MODEL_ID = 'Xenova/whisper-tiny.en';

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let loadPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  duration?: number;
}

/**
 * Resample audio from one sample rate to another using linear interpolation.
 */
export function resample(audio: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return audio;

  const ratio = fromRate / toRate;
  const newLength = Math.round(audio.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, audio.length - 1);
    const frac = srcIndex - low;
    result[i] = audio[low]! * (1 - frac) + audio[high]! * frac;
  }

  return result;
}

/**
 * Downmix multi-channel audio to mono by averaging all channels.
 */
export function downmixToMono(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 0) return new Float32Array();
  if (channelData.length === 1) return channelData[0]!;

  const samples = channelData[0]!.length;
  const out = new Float32Array(samples);
  const scale = 1 / channelData.length;

  for (let i = 0; i < samples; i++) {
    let mixed = 0;
    for (const channel of channelData) mixed += channel[i] ?? 0;
    out[i] = mixed * scale;
  }

  return out;
}

/**
 * Decode OGG Opus audio buffer to 16kHz mono PCM Float32Array.
 */
export async function decodeOggOpus(buffer: Uint8Array): Promise<Float32Array> {
  const { OggOpusDecoder } = await import('ogg-opus-decoder');
  const decoder = new OggOpusDecoder();
  await decoder.ready;

  try {
    const decoded = await decoder.decodeFile(buffer);

    if (!decoded.channelData?.length || !decoded.channelData[0]?.length) {
      throw new Error('Decoded audio is empty');
    }

    const mono = downmixToMono(decoded.channelData);
    return resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
  } finally {
    decoder.free();
  }
}

/**
 * Get or initialize the local Whisper transcription pipeline.
 */
async function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber) return transcriber;

  if (!loadPromise) {
    loadPromise = (async () => {
      console.log(`[Transcribe] Loading local Whisper model: ${MODEL_ID}`);
      const { pipeline } = await import('@huggingface/transformers');
      const instance = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'fp32',
      });
      transcriber = instance;
      return instance;
    })();
  }

  return loadPromise;
}

/**
 * Transcribe Telegram voice/audio using local Whisper. Currently supports OGG/Opus voice notes.
 */
export async function transcribeAudio(
  buffer: Buffer,
  format: string
): Promise<TranscriptionResult> {
  const startTime = Date.now();

  try {
    const normalizedFormat = format.toLowerCase();
    if (!['ogg', 'oga', 'opus'].includes(normalizedFormat)) {
      return {
        success: false,
        error: `Local transcription currently supports Telegram OGG/Opus voice notes. Received: ${format}`,
      };
    }

    const pcm = await decodeOggOpus(buffer);
    const asr = await getTranscriber();
    const response = await asr(pcm);
    const text = Array.isArray(response) ? response[0]?.text : (response as { text?: string }).text;

    return {
      success: true,
      text: (text ?? '').trim(),
      duration: (Date.now() - startTime) / 1000,
    };
  } catch (error) {
    console.error('[Transcribe] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown transcription error',
      duration: (Date.now() - startTime) / 1000,
    };
  }
}

/**
 * Check if voice transcription is available locally.
 */
export function isTranscriptionAvailable(): boolean {
  return true;
}
