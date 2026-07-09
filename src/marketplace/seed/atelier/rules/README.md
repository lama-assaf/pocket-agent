# rules

rules are always-follow guidelines for design, product, and brand work. they're the things that should hold across every output, regardless of project.

## organization

```
rules/
├── common/      # universal principles across design, product, brand
├── design/      # spacing, type, color, motion, accessibility
├── product/     # prd structure, jtbd, metrics, specs, research
├── brand/       # voice, tone, banned words, naming, messaging
└── copy/        # sentence rhythm, anti-ai tone, active voice
```

## installation

these don't auto-install with the claude code plugin (plugin system can't distribute rules). install manually:

```bash
mkdir -p ~/.claude/rules/atelier
cp -r rules/common ~/.claude/rules/atelier/
cp -r rules/design ~/.claude/rules/atelier/
cp -r rules/product ~/.claude/rules/atelier/
cp -r rules/brand ~/.claude/rules/atelier/
cp -r rules/copy ~/.claude/rules/atelier/
```

or use the installer:

```bash
./install.sh --target claude --rules common,design,brand
```

## conflicts

if a project has its own rules, project rules win. atelier's rules are defaults.
