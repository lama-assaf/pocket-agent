/**
 * Write-path guards for marketplace operator packs.
 *
 * Ports Atelier/Salon's pre-write "anti-AI-tone / banned-words" hook natively
 * as a scan run before writes/edits — see chat-tools.ts for the blocking
 * policy. This module never executes pack-shipped JS (scripts/hooks/*.js);
 * it re-implements the same checks in TypeScript and vendors the pattern
 * *data* by hand (see PATTERN DATA below) — the marketplace sync pipeline
 * (src/marketplace/loader.ts) only fetches `.md` rule/skill/agent files, so
 * there's no existing channel to safely pull JS-shipped data on pack update;
 * re-vendor by hand if upstream patterns drift.
 */

import fs from 'fs';
import { allBannedAndToneRules } from '../marketplace/registry';
import { guardrailFilesForContext } from '../clients/registry';
import { howToActFacts, bannedWordsFromFacts } from './how-to-act';
import type { SessionContext } from '../memory/sessions';

// ============ Types ============

export type ToneCategory = 'banned-word' | 'ai-tone' | 'corporate-filler' | 'hollow-opener';
export type ToneSeverity = 'warning' | 'info';

export interface ToneHit {
  phrase: string;
  category: ToneCategory;
  severity: ToneSeverity;
}

export interface RhythmResult {
  /** True when sentence length is suspiciously uniform (an AI-writing tell). */
  flag: boolean;
  sentenceCount: number;
  mean: number;
  stddev: number;
}

export interface ToneScanResult {
  /** Flat, deduplicated list of matched phrases (all categories) — back-compat shape. */
  hits: string[];
  /** Same hits with category/severity attached, one entry per unique phrase. */
  categorizedHits: ToneHit[];
  rhythm: RhythmResult;
  emDashHits: number;
  warning: string | null;
}

// ============ Pattern data (vendored, not executed) ============
//
// Ported by hand from Atelier/Salon's scripts/hooks/lib/patterns.js (identical
// in both packs as of 2026-07-13):
//   https://github.com/lama-assaf/atelier/blob/main/scripts/hooks/lib/patterns.js
//   https://github.com/lama-assaf/salon/blob/main/scripts/hooks/lib/patterns.js
// Category/severity tagging mirrors scripts/hooks/lib/checks.js's findBannedTone().

/** category: 'ai-tone', severity: 'warning' */
const BANNED_AI_TONE = [
  'delve',
  'delves',
  'delved',
  'delving',
  'delve into',
  'delving into',
  'navigate the complexities',
  "in today's fast-paced world",
  "in today's rapidly evolving",
  "in today's digital age",
  'leverage',
  'leverages',
  'leveraged',
  'leveraging',
  'robust',
  'robustness',
  'seamless',
  'seamlessly',
  'elevate',
  'elevates',
  'elevated',
  'elevating',
  'empower',
  'empowers',
  'empowered',
  'empowering',
  'harness',
  'harnesses',
  'harnessed',
  'harnessing',
  'tapestry',
  'rich tapestry',
  'realm of',
  'foster',
  'fosters',
  'fostered',
  'fostering',
  'meticulous',
  'meticulously',
  'cutting-edge',
  'state-of-the-art',
  'groundbreaking',
  'revolutionary',
  'game-changing',
  'unparalleled',
];

/** category: 'corporate-filler', severity: 'warning' */
const CORPORATE_FILLER = [
  'circle back',
  'touch base',
  'synergies',
  'synergistic',
  'at the end of the day',
  'low-hanging fruit',
  'move the needle',
  'value-add',
  'best-in-class',
  'world-class',
  'best-of-breed',
];

/** category: 'hollow-opener', severity: 'warning' */
const HOLLOW_OPENERS = [
  'we listened to your feedback',
  'exciting news',
  "we're thrilled to announce",
  'we are thrilled to announce',
  'welcome to the future of',
];

/**
 * Legitimate technical uses where a flagged word is fine. Keyed by the
 * lowercased phrase; a hit is downgraded (not flagged) when a 40-char window
 * around the match contains one of its context phrases — e.g. "leverage" is
 * flagged, but "financial leverage" is not.
 *
 * Applied uniformly to every match source (vendored patterns AND the legacy
 * pack/context/facts banned-word lists below) — upstream only applies it to
 * the vendored arrays, but pocket-agent merges a second banned-word source
 * (banned-words.md bullets, which independently list "harness"/"leverage"/
 * "robust"), so the allowlist must cover both or "test harness" would still
 * false-positive via that path.
 */
const TECHNICAL_CONTEXT_ALLOWLIST: Record<string, string[]> = {
  leverage: ['financial leverage', 'leverage ratio', 'debt leverage'],
  robust: ['load-tested', 'fault tolerance', 'mtbf'],
  harness: ['test harness', 'wire harness', 'agent harness'],
};

/** Chars of context on each side of a match considered for the allowlist window. */
const ALLOWLIST_CONTEXT_CHARS = 40;

// ============ Legacy banned-word sources (pack rules + guardrails + facts) ============

let cachedWords: string[] | null = null;

/** Parse banned words/phrases from a banned-words markdown body (bullet or code list). */
function parseBannedWords(content: string, into: Set<string>): void {
  for (const line of content.split('\n')) {
    const m = line.match(/^[-*]\s+`?([a-zA-Z][a-zA-Z '-]+)`?/);
    if (m) into.add(m[1].trim().toLowerCase());
  }
}

/** Extract banned words/phrases from the vendored banned-words rule (bullet or code list). */
function bannedWords(): string[] {
  if (cachedWords) return cachedWords;
  const words = new Set<string>();
  for (const r of allBannedAndToneRules()) {
    if (!/banned-words/.test(r.filename)) continue;
    parseBannedWords(r.content, words);
  }
  cachedWords = [...words];
  return cachedWords;
}

/**
 * Banned words contributed by the selected context's on-disk guardrails (world +
 * active client `guardrails/banned-words.md`), layered on top of the pack rules.
 * Read fresh (files are tiny) so brand edits take effect without a restart.
 */
function contextBannedWords(context: SessionContext): string[] {
  const words = new Set<string>();
  for (const file of guardrailFilesForContext(context)) {
    try {
      parseBannedWords(fs.readFileSync(file, 'utf-8'), words);
    } catch {
      // Missing/unreadable guardrail file — nothing to merge for this scope.
    }
  }
  return [...words];
}

// ============ Matching helpers ============

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a single word-boundary regex from a list of phrases, longest-first so
 * multi-word phrases match before their single-word substrings.
 */
function buildPatternRegex(phrases: string[]): RegExp {
  const sorted = [...phrases].sort((a, b) => b.length - a.length).map(escapeRegex);
  return new RegExp(`(?<![\\w-])(${sorted.join('|')})(?![\\w-])`, 'gi');
}

const AI_TONE_REGEX = buildPatternRegex(BANNED_AI_TONE);
const CORPORATE_FILLER_REGEX = buildPatternRegex(CORPORATE_FILLER);
const HOLLOW_OPENER_REGEX = buildPatternRegex(HOLLOW_OPENERS);

/** True when the match at `index` falls within an allowlisted technical context. */
function isAllowlisted(text: string, index: number, matchLength: number, phraseLower: string): boolean {
  const contexts = TECHNICAL_CONTEXT_ALLOWLIST[phraseLower];
  if (!contexts) return false;
  const window = text
    .slice(Math.max(0, index - ALLOWLIST_CONTEXT_CHARS), index + matchLength + ALLOWLIST_CONTEXT_CHARS)
    .toLowerCase();
  return contexts.some((ctx) => window.includes(ctx));
}

/** Scan text against one vendored pattern group, downgrading allowlisted hits. */
function scanPatternGroup(
  text: string,
  regex: RegExp,
  category: ToneCategory,
  severity: ToneSeverity
): ToneHit[] {
  const hits: ToneHit[] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const phrase = m[0];
    const phraseLower = phrase.toLowerCase();
    if (isAllowlisted(text, m.index, phrase.length, phraseLower)) continue;
    hits.push({ phrase, category, severity });
  }
  return hits;
}

/** Scan the vendored AI-tone / corporate-filler / hollow-opener pattern data. */
function scanVendoredPatterns(text: string): ToneHit[] {
  if (!text) return [];
  return [
    ...scanPatternGroup(text, AI_TONE_REGEX, 'ai-tone', 'warning'),
    ...scanPatternGroup(text, CORPORATE_FILLER_REGEX, 'corporate-filler', 'warning'),
    ...scanPatternGroup(text, HOLLOW_OPENER_REGEX, 'hollow-opener', 'warning'),
  ];
}

/**
 * Scan the legacy banned-word sources: pack rules (banned-words.md), the
 * selected context's on-disk guardrails, and `how_to_act` facts (subject
 * `banned_words`). Brand-specific words layer on top of pack words per scope —
 * unchanged from before this port, just restructured to emit ToneHit and to
 * respect the same technical-context allowlist as the vendored patterns.
 */
function scanLegacyBannedWords(text: string, context?: SessionContext): ToneHit[] {
  const all = context
    ? [
        ...bannedWords(),
        ...contextBannedWords(context),
        ...bannedWordsFromFacts(howToActFacts(context)),
      ]
    : bannedWords();

  const seen = new Set<string>();
  const hits: ToneHit[] = [];
  for (const w of all) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const m = new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').exec(text);
    if (!m) continue;
    if (isAllowlisted(text, m.index, m[0].length, key)) continue;
    hits.push({ phrase: w, category: 'banned-word', severity: 'warning' });
  }
  return hits;
}

/** Dedupe by lowercased phrase, first occurrence wins (banned-word takes priority). */
function dedupeToneHits(hits: ToneHit[]): ToneHit[] {
  const seen = new Set<string>();
  const out: ToneHit[] = [];
  for (const h of hits) {
    const key = h.phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

// ============ Rhythm / em-dash checks (native reimplementation) ============

/**
 * Check sentence rhythm: are all sentences roughly the same length? Ported
 * from scripts/hooks/lib/checks.js#checkRhythm — flags flatness (stddev < 3
 * words) across 4+ sentences, a common AI-writing tell. Code blocks are
 * stripped first so fenced snippets never skew the count.
 */
export function checkRhythm(text: string): RhythmResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { flag: false, sentenceCount: 0, mean: 0, stddev: 0 };
  }

  const stripped = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const sentences = stripped
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  if (sentences.length < 4) {
    return { flag: false, sentenceCount: sentences.length, mean: 0, stddev: 0 };
  }

  const wordCounts = sentences.map((s) => s.split(/\s+/).filter((w) => w.length > 0).length);
  const mean = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  const variance = wordCounts.reduce((a, b) => a + (b - mean) ** 2, 0) / wordCounts.length;
  const stddev = Math.sqrt(variance);

  return {
    flag: stddev < 3,
    sentenceCount: sentences.length,
    mean: Number(mean.toFixed(1)),
    stddev: Number(stddev.toFixed(2)),
  };
}

/**
 * Count em-dash-filler interjections ("— X —"), ported from
 * scripts/hooks/lib/checks.js#checkEmDashFiller. Long em-dash interjections
 * are a common AI-writing tell.
 */
export function checkEmDashFiller(text: string): number {
  if (typeof text !== 'string') return 0;
  const matches = text.match(/\s—\s[^—\n]+\s—\s/g);
  return matches ? matches.length : 0;
}

// ============ Public API ============

/**
 * Scan text for banned/AI-tone language: the legacy pack/context/facts
 * banned-word lists, the vendored AI-tone/corporate-filler/hollow-opener
 * pattern data (technical-context-allowlist-aware), sentence-rhythm flatness,
 * and em-dash filler. Returns a null `warning` for clean text.
 */
export function scanForBannedTone(text: string, context?: SessionContext): ToneScanResult {
  const categorizedHits = dedupeToneHits([
    ...scanLegacyBannedWords(text, context),
    ...scanVendoredPatterns(text),
  ]);
  const hits = categorizedHits.map((h) => h.phrase);
  const rhythm = checkRhythm(text);
  const emDashHits = checkEmDashFiller(text);

  if (categorizedHits.length === 0 && !rhythm.flag && emDashHits === 0) {
    return { hits: [], categorizedHits: [], rhythm, emDashHits: 0, warning: null };
  }

  const messages: string[] = [];
  if (categorizedHits.length > 0) {
    const byCategory = new Map<ToneCategory, string[]>();
    for (const h of categorizedHits) {
      const list = byCategory.get(h.category) ?? [];
      list.push(h.phrase);
      byCategory.set(h.category, list);
    }
    const parts = [...byCategory.entries()].map(([cat, phrases]) => `${cat}: ${phrases.join(', ')}`);
    messages.push(`banned/AI-tone terms — ${parts.join('; ')}`);
  }
  if (rhythm.flag) {
    messages.push(
      `sentence rhythm is unusually flat (${rhythm.sentenceCount} sentences, stddev ${rhythm.stddev} words) — vary sentence length`
    );
  }
  if (emDashHits > 0) {
    messages.push(`${emDashHits} em-dash-filler pattern(s) ("— X —") — often reads as AI-written`);
  }

  return {
    hits,
    categorizedHits,
    rhythm,
    emDashHits,
    warning: `⚠️ tone guard: ${messages.join('; ')}. Revise per the brand voice rules before finalizing.`,
  };
}
