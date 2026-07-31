import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Fixture pack root: only 'atelier' gets a real skill (fed straight into
// SKILL.md frontmatter) so lane/keyword resolution can be verified WITHOUT
// any entry in the hardcoded LANE_MAPS table (registry.ts) — this is exactly
// the drift scenario (a new upstream skill LANE_MAPS doesn't know about yet).
let tmpRoot: string;

function writeSkill(pack: string, name: string, frontmatter: Record<string, string>): void {
  const dir = path.join(tmpRoot, pack, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm}\n---\n\nBody for ${name}.\n`, 'utf-8');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-root-'));
  process.env.PACK_ROOT_OVERRIDE = tmpRoot;
});

afterEach(() => {
  delete process.env.PACK_ROOT_OVERRIDE;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.resetModules();
});

describe('frontmatter-derived lane + keywords (registry.ts)', () => {
  it('routes a skill to its frontmatter lane with no LANE_MAPS entry, without warning (it IS mapped, just via frontmatter)', async () => {
    writeSkill('atelier', 'frontmatter-test-skill', {
      name: 'frontmatter-test-skill',
      description: 'routed purely by frontmatter',
      lane: 'brand',
      keywords: 'zzztriggerword, anotherzzztrigger',
    });

    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = await import('../../src/marketplace/registry');

    // Not in LANE_MAPS.atelier.skills at all — resolved purely via its own
    // frontmatter `lane: brand`, never falling back to atelier's defaultLane
    // ('product') the way an unmapped skill used to, silently, before this.
    const brandSkills = registry.skillsForLane('brand');
    expect(brandSkills.some((s) => s.name === 'frontmatter-test-skill')).toBe(true);
    const productSkills = registry.skillsForLane('product');
    expect(productSkills.some((s) => s.name === 'frontmatter-test-skill')).toBe(false);

    // No drift warning: the frontmatter lane IS the mapping, so nothing was
    // silently defaulted here.
    expect(
      warnSpy.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('frontmatter-test-skill')
      )
    ).toBe(false);

    warnSpy.mockRestore();
  });

  it('warns for a genuinely unmapped skill in a multi-lane pack (no frontmatter lane, not in LANE_MAPS)', async () => {
    writeSkill('atelier', 'totally-new-unmapped-skill', {
      name: 'totally-new-unmapped-skill',
      description: 'a skill upstream added that nobody wired into LANE_MAPS yet',
    });

    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = await import('../../src/marketplace/registry');
    registry.skillsForLane('product'); // triggers ensureLoaded()

    expect(
      warnSpy.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('totally-new-unmapped-skill')
      )
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('auto-registers frontmatter keywords into keywordIndexForLane without a KEYWORDS table edit', async () => {
    writeSkill('atelier', 'frontmatter-test-skill', {
      name: 'frontmatter-test-skill',
      description: 'routed purely by frontmatter',
      lane: 'brand',
      keywords: 'zzztriggerword, anotherzzztrigger',
    });

    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = await import('../../src/marketplace/registry');

    const index = registry.keywordIndexForLane('brand');
    expect(index['zzztriggerword']).toContain('skill:frontmatter-test-skill');
    expect(index['anotherzzztrigger']).toContain('skill:frontmatter-test-skill');
  });

  it('does not warn for a single-lane pack (salon) relying on defaultLane', async () => {
    // No skills written at all for either pack — readPack degrades to [] for
    // missing dirs. Nothing to route, so the only thing under test is that
    // ensureLoaded() doesn't throw and doesn't warn about salon (which has
    // no ambiguity to drift into).
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = await import('../../src/marketplace/registry');
    registry.skillsForLane('social');
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('pack salon'))).toBe(false);
    warnSpy.mockRestore();
  });
});
