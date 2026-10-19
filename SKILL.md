---
name: anki-video-japanese-editorial-design
description: Design and implement the Japanese-editorial-inspired UI and deterministic video templates for Anki-to-Video MVP.
---

# Japanese Editorial Design — Project Skill

## When to apply
Use while implementing Studio screens, flashcard video layouts, motion, theming, typography, or visual QA for the Anki-to-Video project. Read `plan.md`, particularly section 14, first.

## Intent
Build a calm, considered, highly legible educational visual system inspired by **ma (間)**: meaningful negative space. This is one optional aesthetic, not a claim about all Japanese UI. It must accommodate any subject and writing system.

## Visual rules
- Compose on a consistent grid with asymmetry that reinforces hierarchy, never asymmetry for its own sake.
- Choose a warm off-white paper surface, near-black ink, one controlled vermilion accent, and restrained success/error colors. Test real contrast.
- Favor elegant editorial headline type + robust multilingual body fallbacks. Include CJK/Devanagari coverage; never rely on Latin-only font metrics.
- Use generous negative space but prioritize legible question, answer and options within 1080×1920 and mobile safe areas.
- Limit decoration to rules, sparse texture and carefully placed progress indicators. Avoid stereotypical Japanese icons and gratuitous sakura motifs.
- Motion should convey stages: question entrance → narration → countdown → answer reveal → explanation. Use fade/translate rather than bounce; reduced-motion alternative required.
- Frame-based deterministic animation only. Never use CSS wall-clock transition timing as the source of truth for rendered video.

## Modularity rules
- Keep Theme, Layout, MotionPreset, Branding and Timeline independent.
- Timeline states derive from real speech-duration probes; countdown starts only once question narration finishes.
- Use one data schema and component implementation for preview and final rendering.
- Design changes are versioned and reflected in render identity, but should not invalidate TTS caches.
- Never inject arbitrary CSS/JS from imported Anki cards.

## Required deliverables
1. Three named themes: `washi-editorial`, `technical-dark`, `playful`.
2. Two layouts: `reveal`, `multiple-choice` (only with validated options).
3. Shared reusable components, design tokens and override validation.
4. Studio preview with timeline scrubbing and exact-frame comparison to renders.
5. Screenshot tests for Japanese/Latin/Devanagari, long content and images; mobile legibility checks.

## Review before merge
Does the actual flashcard remain the hero? Is every character legible on a phone? Does the reveal happen only after the countdown? Does typography survive script changes? Are backgrounds and decoration quiet enough to support recall? Does the output match preview exactly?

## Inspiration (read source; don't blindly copy)
- https://github.com/julianoczkowski/designer-skills/blob/main/frontend-design/SKILL.md — Japanese Minimalism (Ma) direction.
- https://github.com/JetBrains/skills/blob/main/frontend-design/SKILL.md — production frontend craftsmanship.
- https://www.utsubo.com/blog/japanese-web-design-style-guide — nuance about Japanese visual traditions.
