/**
 * Shareable client setup strings (roadmap item 9): encode/decode round-trip,
 * tolerance for pasted-with-or-without-prefix input, and rejection of
 * malformed/incomplete payloads. Never encodes a token — see the module doc
 * for why.
 */
import { describe, it, expect } from 'vitest';
import { encodeClientSetupString, decodeClientSetupString } from '../../src/clients/setup-string';

describe('encodeClientSetupString / decodeClientSetupString — round trip', () => {
  it('round-trips id/name/repoUrl/syncMode', () => {
    const encoded = encodeClientSetupString({
      id: 'acme',
      name: 'Acme Co',
      repoUrl: 'https://github.com/acme/brain.git',
      syncMode: 'manual',
    });
    const decoded = decodeClientSetupString(encoded);
    expect(decoded.ok).toBe(true);
    expect(decoded.payload).toEqual({
      id: 'acme',
      name: 'Acme Co',
      repoUrl: 'https://github.com/acme/brain.git',
      syncMode: 'manual',
    });
  });

  it('defaults syncMode to "live" when omitted', () => {
    const encoded = encodeClientSetupString({
      id: 'acme',
      name: 'Acme Co',
      repoUrl: 'https://github.com/acme/brain.git',
    });
    const decoded = decodeClientSetupString(encoded);
    expect(decoded.payload?.syncMode).toBe('live');
  });

  it('produces a pocketagent://join? prefixed string', () => {
    const encoded = encodeClientSetupString({
      id: 'acme',
      name: 'Acme',
      repoUrl: 'https://github.com/acme/brain.git',
    });
    expect(encoded.startsWith('pocketagent://join?')).toBe(true);
  });

  it('never includes a github token or "token" substring in the encoded string', () => {
    const encoded = encodeClientSetupString({
      id: 'acme',
      name: 'Acme',
      repoUrl: 'https://github.com/acme/brain.git',
    });
    expect(encoded.toLowerCase()).not.toContain('token');
    expect(encoded.toLowerCase()).not.toContain('ghp_');
  });

  it('round-trips names with unicode/special characters', () => {
    const encoded = encodeClientSetupString({
      id: 'cafe-brand',
      name: 'Café & Co. 日本語',
      repoUrl: 'https://github.com/cafe/brain.git',
    });
    const decoded = decodeClientSetupString(encoded);
    expect(decoded.payload?.name).toBe('Café & Co. 日本語');
  });

  it('throws when encoding is missing required fields', () => {
    expect(() =>
      encodeClientSetupString({ id: '', name: 'x', repoUrl: 'https://x' })
    ).toThrow();
    expect(() =>
      encodeClientSetupString({ id: 'x', name: '', repoUrl: 'https://x' })
    ).toThrow();
    expect(() => encodeClientSetupString({ id: 'x', name: 'x', repoUrl: '' })).toThrow();
  });
});

describe('decodeClientSetupString — tolerance and error handling', () => {
  it('decodes the blob even when the pocketagent://join? prefix is stripped', () => {
    const encoded = encodeClientSetupString({
      id: 'acme',
      name: 'Acme',
      repoUrl: 'https://github.com/acme/brain.git',
    });
    const blobOnly = encoded.replace('pocketagent://join?', '');
    const decoded = decodeClientSetupString(blobOnly);
    expect(decoded.ok).toBe(true);
    expect(decoded.payload?.id).toBe('acme');
  });

  it('tolerates surrounding whitespace/newlines (common when pasted)', () => {
    const encoded = encodeClientSetupString({
      id: 'acme',
      name: 'Acme',
      repoUrl: 'https://github.com/acme/brain.git',
    });
    const decoded = decodeClientSetupString(`  \n${encoded}\n  `);
    expect(decoded.ok).toBe(true);
  });

  it('rejects an empty string', () => {
    const decoded = decodeClientSetupString('');
    expect(decoded.ok).toBe(false);
    expect(decoded.error).toBeTruthy();
  });

  it('rejects garbage input (not base64/not JSON)', () => {
    const decoded = decodeClientSetupString('not a real setup string!!!');
    expect(decoded.ok).toBe(false);
  });

  it('rejects valid base64/JSON missing required fields', () => {
    const blob = Buffer.from(JSON.stringify({ id: 'acme' }), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const decoded = decodeClientSetupString('pocketagent://join?' + blob);
    expect(decoded.ok).toBe(false);
    expect(decoded.error).toMatch(/name|repo/i);
  });

  it('rejects a non-object JSON payload (e.g. an array or a string)', () => {
    const blob = Buffer.from(JSON.stringify(['not', 'an', 'object']), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const decoded = decodeClientSetupString('pocketagent://join?' + blob);
    expect(decoded.ok).toBe(false);
  });

  it('coerces an unrecognized syncMode value to "live"', () => {
    const blob = Buffer.from(
      JSON.stringify({ id: 'acme', name: 'Acme', repoUrl: 'https://x', syncMode: 'bogus' }),
      'utf-8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const decoded = decodeClientSetupString('pocketagent://join?' + blob);
    expect(decoded.ok).toBe(true);
    expect(decoded.payload?.syncMode).toBe('live');
  });
});
