# Anki-to-Video — Modular MVP Implementation Plan

**Status:** Proposed MVP — updated with countdown timing, persistent generation controls, and modular design/video studio  
**Goal:** Import an Anki deck (`.apkg`), preview cards, apply a reusable animation template, generate or reuse speech audio, and export vertical MP4 videos locally.  
**Guiding principle:** Anki is an **input adapter**, not the core data model. The rendering engine should also accept JSON and eventually other flashcard sources.

## 1. Definition of done

A user can:

1. Select a locally stored `.apkg` file that they own or have permission to republish.
2. See the extracted decks/cards and any supported embedded images/audio.
3. Inspect and correct the front, back, explanation, voice text, and rendering eligibility for individual cards.
4. Choose a template, voice configuration, video preset, number of cards, and output directory.
5. Preview a card animation with its planned audio timing.
6. Configure question narration, a countdown that starts **only after question audio finishes**, and either a flexible or target-duration video timeline.
7. Request **exactly N new videos**, inspect generation totals and historical render versions, and pause, resume, cancel, or retry queued jobs without duplicating outputs.
8. Export **one 1080×1920, 30 fps, H.264/AAC MP4 per selected card**, and optionally one sequential compilation of selected cards.
9. Receive a manifest of outputs, warnings, provenance, and any cards skipped due to unsupported content.
10. Choose a design theme, layout, animation preset, typography, colors, countdown style, and branding; see a frame-accurate local preview before rendering.
11. Open a local Studio with Library, Studio, Production, and Exports views to manage designs and batches.

**Acceptance scenario:** Import a small Basic + Reversed, a cloze, and an image/audio deck fixture; reliably export at least 20 eligible cards with readable text and correctly timed reveal/audio, without manually writing per-card code. Unsupported cards must be reported, never silently misrendered.

## 2. Scope

### MVP (must have)

- Local-first workflow; no web app, cloud service, accounts, database server, or social media upload.
- CLI for the pipeline plus a local browser preview/editor (Remotion Studio or a thin React UI).
- `.apkg` import via a **dedicated adapter**; JSON import for testing and portability.
- Explicit support for standard **Basic**, **Basic (and reversed)**, and simple **cloze** cards. Import all cards, not just notes; maintain card identity, order, and template direction.
- Basic HTML formatting and Unicode text; bundled raster images and supported prerecorded audio.
- One polished template: `reveal` (question → thinking pause → answer → optional explanation). Multiple-choice only for cards with **explicit, validated** options; no auto-invented distractors.
- Configurable TTS adapter (start with one provider), plus `original-audio`, `silent`, and `mock` modes.
- Content/audio validation, deterministic timeline planning, asset caching, batch renders, resumability, persistent SQLite job/output tracking, and a clear error report.
- Portrait export and a machine-readable manifest.
- **Design system and Video Studio:** 3 theme presets (`washi-editorial`, `technical-dark`, `playful`), two layouts (`reveal`, `multiple-choice` for explicit options), countdown/reveal motion presets, design tokens, branding, responsive text fitting, and preview UI. Add a Japanese-inspired aesthetic by default without assuming all content is Japanese.
- Configurable countdown starting after question narration; fixed-target and flexible-duration modes; ensure answer narration is never truncated.
- Persistent generation manager: choose N **unrendered** cards, see completed/remaining/queued/failed/skipped counts, and pause/resume/cancel/retry batches.
- Deduplicate by stable card/content fingerprint + template + render settings, while allowing versioned regeneration.

### Later, not MVP

- Automated question creation from PDFs, crawling AnkiWeb, direct AnkiWeb APIs, or Anki sync.
- Automated distractor generation, AI-generated diagrams, or AI answer verification.
- Complex card JavaScript, interactive Anki add-ons, full image-occlusion rendering, or pixel-perfect faithful replay of arbitrary card templates.
- Automatic publishing, cloud render farms, subscriptions, analytics, background music licensing management, or a full SaaS editor.
- Multi-language dubbing and personalized spaced-repetition sequencing.
- Full drag-and-drop canvas editor, custom keyframe timeline authoring, online theme marketplace, AI-generated styles, and automated design A/B testing.

**Design for extensions, but do not implement them prematurely.**

## 3. Proposed stack and boundaries

| Area | Choice for MVP | Why / boundary |
|---|---|---|
| Core orchestration | TypeScript + Node.js | Shared types, straightforward Remotion integration |
| Rendering | React + Remotion | Frame-driven visuals and audio; templates remain components |
| Styling | CSS / React components | Reusable typography, transitions, safe-area layouts |
| Import | `ApkgImporter` adapter | Unzip, parse Anki collection/media **without binding the rest of the app to Anki schemas** |
| Validation | Zod + custom rules | Validate cards, assets, durations and config at boundaries |
| TTS | `SpeechProvider` interface | One real implementation, plus `mock` and `none` |
| Media | FFmpeg/ffprobe | Probe audio/video durations, normalize or convert input where necessary |
| Storage | SQLite (local) + filesystem + JSON manifests | Durable queues, counts, render histories, outputs and portable exports; no database server |
| Tests | Vitest + fixture `.apkg` decks | Unit, contract, integration and rendered smoke tests |

**Anki import detail:** `.apkg` files may contain different collection/database and media representations depending on exporter/version. The adapter should detect supported variants and fail with an actionable compatibility error for unknown ones. A maintained Anki import library is acceptable if it passes our fixture tests. **Do not assume every `.apkg` has exactly one hard-coded SQLite filename/schema.** Consider isolated use of Anki's own tooling for compatibility if direct parsing is too fragile. Handle `.colpkg` separately and explicitly mark it unsupported for the MVP.

**Licensing:** Remotion's licensing terms and TTS provider terms must be checked for the intended commercial deployment before release. Treat deck content and bundled media as separately licensed assets.

## 4. Architecture

```text
CLI / Local UI
     |
     v
Application / Job Orchestrator
     |
     +--> ImportAdapter ----------------> Raw Imported Cards
     |       +--> ApkgImporter
     |       +--> JsonImporter
     |
     +--> Normalize + Resolve Media ----> Canonical Flashcard IR
     |
     +--> Validate + Human Review ------> Eligible Cards + Warnings
     |
     +--> AudioResolver
     |       +--> EmbeddedAudioProvider
     |       +--> TTSProvider
     |       +--> SilentProvider
     |       +--> Content-addressed Cache
     |
     +--> TimelinePlanner --------------> RenderPlan (all timing fixed)
     |
     +--> TemplateRegistry / Renderer --> MP4
     |
     +--> JobManager + SQLiteStore -----> durable queue, counts, retries, render history
     |
     +--> ManifestWriter --------------> Output paths, status, diagnostics
```

**Direction of dependency:** adapters and UI depend on core contracts; core logic must not import Anki parsing, TTS SDKs, React, or FFmpeg implementation details.

### Canonical IR: one rendered card, not one Anki note

```ts
export type MediaRef = {
  id: string;
  kind: 'image' | 'audio';
  uri: string;                // normalized local, sandboxed asset URI
  mimeType?: string;
};

export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaId: string; alt?: string }
  | { kind: 'math'; latex: string };

export type Flashcard = {
  id: string;                // stable card identity, namespaced by source/deck
  source: {
    type: 'anki' | 'json';
    deckId?: string;
    noteId?: string;
    cardId?: string;
    sourceFingerprint: string;
    license?: string;
  };
  tags: string[];
  language?: string;         // optional BCP-47
  front: ContentBlock[];
  back: ContentBlock[];
  explanation?: ContentBlock[];
  options?: { id: string; label: string; correct: boolean }[];
  narration?: {
    question?: string;
    answer?: string;
    explanation?: string;
    pronunciationText?: string;
  };
  media: MediaRef[];
  warnings: string[];
};
```

**Important normalization rules:**

- Cards, notes and note types are not interchangeable: a note can generate multiple cards; import both directions for reversed cards.
- Resolve note fields through the appropriate template into front/back **before** converting to IR. Do not simply map the first two raw note fields to front/back.
- Respect cloze deletion indexes and produce separate cards for distinct cloze numbers; front hides the target and back reveals it.
- Strip or safely transform unsupported HTML; preserve meaningful line breaks, emphasis, images, and supported audio references. Do not execute arbitrary imported scripts or remote resources.
- Keep the source content and a sanitized render representation separate; avoid destructive normalization.
- Missing images/audio are validation warnings or skips depending on whether the answer requires them.
- Do not interpret `[sound:...]` markup as plain visible text. If embedded pronunciation exists, prefer it over synthesis when appropriate.
- For TTS, narration text is explicit or carefully derived from textual content. Do not automatically narrate code, equations, image-only cards, or ambiguous cloze text.

### Interfaces (illustrative)

```ts
interface ImportAdapter {
  supports(file: string): Promise<boolean>;
  import(file: string): Promise<ImportResult>;
}

interface SpeechProvider {
  synthesize(request: {
    text: string;
    language: string;
    voice?: string;
    rate?: number;
  }): Promise<{ file: string; durationMs: number }>;
}

interface VideoTemplate {
  id: string;
  supports(card: Flashcard): { ok: boolean; reasons: string[] };
  createPlan(card: Flashcard, assets: ResolvedAssets, config: RenderConfig): RenderPlan;
}

interface Renderer {
  render(plan: RenderPlan, outputFile: string): Promise<RenderResult>;
}
```

Keep these interfaces small. Provider-specific fields can live in optional adapter configuration, not in the canonical card schema.

## 5. Proposed repository layout

```text
anki-to-video/
├── plan.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── apps/
│   ├── cli/                     # import, inspect, preview, render, validate
│   └── studio/                  # local editor/preview; can start thin
├── packages/
│   ├── core/                    # IR types, config schemas, errors, validation
│   ├── import-anki/             # .apkg + Anki notes/templates/media
│   ├── import-json/             # JSON adapter
│   ├── content/                 # sanitizer, cloze + content normalization
│   ├── assets/                  # extraction, URI resolution, cache, probing
│   ├── speech/                  # speech interface + provider implementations
│   ├── timeline/                # duration, scene boundaries, sync
│   ├── design/                  # tokens, themes, layout, motion, branding and typography
│   ├── templates/               # React visual components + template registry
│   ├── renderer-remotion/       # composition registration + render API
│   └── jobs/                    # queue, concurrency, retry, manifests
├── fixtures/
│   ├── basic.apkg
│   ├── reversed.apkg
│   ├── cloze.apkg
│   ├── media.apkg
│   └── cards.json
├── config/
│   └── default.json
├── outputs/                      # gitignored
├── cache/                        # gitignored
└── docs/
    ├── IR.md
    ├── design/SKILL.md           # project-specific Japanese-inspired design brief
    ├── adapter-contracts.md
    └── known-limitations.md
```

A monorepo is convenient, but package names are **module boundaries**, not a mandate to make everything an independently published npm package. Avoid empty abstraction scaffolding.

## 6. Rendering and audio design

### MVP template: `reveal`

Default output: **1080×1920, 30 fps**, safe margins for Shorts/Reels UI overlays.

1. **Intro / question**: display the front and play the full question narration, using its probed duration (plus configurable lead-in/padding).
2. **Think** (configurable, e.g. 4 s): begin the visible progress bar/countdown **after narration finishes**, never during speech unless explicitly enabled. No answer leakage.
3. **Reveal** (1–2 s): animate answer in and visually distinguish it from the question.
4. **Pronounce / explain** (duration based on actual audio): play answer audio and show optional explanation.
5. **Hold / outro** (1–2 s): let viewers read before ending.

**Timing modes:**

- `flexible` (default): total duration = question audio + intro/padding + `thinkSeconds` + reveal + answer audio + optional explanation/hold. Do not cut off speech.
- `target` (e.g. `targetDurationSeconds=15`): fit within the requested video length by reducing only adjustable padding/hold/think time down to configured minima. If required narration and minimum thinking time cannot fit, **fail validation with a clear reason or explicitly fall back to flexible mode**; never silently truncate or speed up speech. Track actual output length even if target is infeasible.

**15-second example (illustrative, durations depend on actual speech):** 0–2 s question voice → 2–6 s timer/choices → 6–7 s reveal → 7–10 s answer voice → 10–13 s explanation/repeat → 13–15 s hold. The countdown begins at the first frame after the question narration ends.

**Timing invariants/tests:** `thinkStartFrame >= questionAudioEndFrame`, `revealStartFrame >= thinkEndFrame`, `answerSpeechStartFrame >= revealStartFrame`, `videoEndFrame >= allAudioEndFrames`. Handle zero-length/silent questions, late media probing, and frame rounding deterministically.

The timeline planner generates **integer frame boundaries** and audio start times. Audio is synthesized or located **before** timeline planning, then duration-probed; no component calls TTS during rendering. Scene transitions use frame number and configuration, not wall-clock timers or random values.

### Audio resolution priority

1. A user-selected bundled card audio asset, if compatible and licensed.
2. Synthesized speech for an explicitly selected voice/text/language.
3. Silent mode (with onscreen reveal) if no faithful speech is possible.

Cache key should include normalized narration text, locale, voice, rate, provider and engine/model version. Cache based on source fingerprint and settings; never use only card ID for synthesized assets.

**TTS safety:** avoid calling TTS automatically on arbitrary imported HTML or secrets. Show text and chargeable provider selection before batch synthesis, offer estimated character count, and provide a local/offline or mock path for development.

### Template growth

MVP registry ships `reveal` only; next implement `multipleChoice` for validated options, followed by `listening`, `imageIdentify`, `cloze`, `code`, and `math`. New templates implement the existing interface rather than changing importers.

## 7. Persistent generation manager (MVP)

SQLite is the source of truth for **logical cards**, **render variants**, and **batch attempts**. JSON manifests are exports, not the primary status store. Keep persistence behind interfaces (`CardRepository`, `VideoRepository`, `JobRepository`) to avoid coupling the renderer to SQL.

Minimum tables (illustrative):

- `cards`: `card_id` (stable, source namespaced), `deck_id`, `content_hash`, `eligible`, `skip_reason`, `updated_at`.
- `videos`: `video_id`, `card_id`, `template_id`, `settings_hash`, `content_hash`, `status`, `output_path`, `duration_ms`, `created_at`, `verified_at`, `error`; add uniqueness for a **successful/active** combination of card/content/template/settings, while retaining historical regenerated versions.
- `jobs`: `job_id`, `requested_count`, `completed_count`, `failed_count`, `skipped_count`, `status`, `created_at`, `updated_at`, `config_json`.
- `job_items`: `job_id`, `card_id`, `video_id`, `state`, `attempt_count`, `error`, `claimed_at`; unique `(job_id, card_id)` to prevent duplicate selection within a job.

**Source-of-truth rules:** calculate dashboard counts from transactional records (or reconcile cached counters); atomic enqueue and claim operations; output counts as `completed` **only after ffprobe verification and durable final-file rename**. Do not count a stale DB success if output is missing: mark it for reconciliation. Use write-ahead logging (WAL) and migrations; use one queue writer or safe transactions for concurrency. Re-importing unchanged decks should not reset history.

**User controls:**

- `generate next N`: transactionally select exactly N eligible cards without a verified successful video **for the chosen content + settings version** (or fewer, with reported shortfall); stable order, optional seed/filters. Selection and reservation must be atomic to prevent concurrent jobs selecting the same card/version.
- `pause`: stop claiming new items; allow running items to finish. `resume`: continue pending items. `cancel`: stop claiming, terminate active renders safely if supported, and mark unstarted items canceled; preserve completed work.
- `retry failed`: queue only retryable failures with bounded attempts/backoff; permanent unsupported cards remain skipped.
- `regenerate`: explicit opt-in that creates a new video version for chosen cards/settings (with no overwrite unless requested); preserve original outputs and traceability.
- `reconcile`: after crashes, treat stale `running` attempts as pending/retryable, remove orphan temp files, verify finished paths, and rebuild/repair counters.

**Tracking UI (local, minimal):** deck totals, eligible, already rendered for current settings, remaining, queued, running, completed, failed, skipped; per-job progress, current item, error summaries, and buttons for generate/pause/resume/cancel/retry. Show historical versions and outputs per card. Count cards separately from video variants to avoid misleading metrics.

**Example commands:**

```bash
pnpm app generate ./work/japanese.json --count 100 --selection unrendered --template reveal --duration-mode target --target-seconds 15 --think-seconds 4
pnpm app jobs list
pnpm app jobs show <job-id>
pnpm app jobs pause <job-id>
pnpm app jobs resume <job-id>
pnpm app jobs cancel <job-id>
pnpm app jobs retry <job-id> --failed-only
pnpm app stats --deck japanese --template reveal
pnpm app reconcile
```

**Generation acceptance test:** given 100 eligible cards and 73 verified videos under the current settings, requesting `--count 20` selects 20 of the remaining 27 and creates no duplicates; an interrupted job resumes remaining items and renders at most the originally reserved N cards. Changing voice/template/content hash makes a new variant eligible; old videos remain accessible.

### Required timer and batch-management configuration (implementation contract)

```ts
type TimingConfig = {
  mode: 'flexible' | 'target';
  targetSeconds?: number;      // e.g. 15, only for target mode
  thinkSeconds: number;        // e.g. 4; after question narration
  minThinkSeconds: number;     // floor for target-mode compression
  revealSeconds: number;
  holdSeconds: number;
  infeasibleTarget: 'fail' | 'extend';
};

type GenerationRequest = {
  deckId: string;
  count: number;               // number of NEW videos requested
  selection: 'unrendered' | 'selected' | 'all';
  selectedCardIds?: string[];
  templateId: string;
  timing: TimingConfig;
  outputDir: string;
  maxConcurrency: number;
};
```

**Timer behavior:** Narration → countdown → answer reveal → answer narration. A countdown of 4 seconds means **4 seconds of thinking after the question finishes speaking**, not a 4-second delay from the beginning of the video. Render the countdown from computed frame boundaries. For a 15-second target, reduce optional hold/padding before reducing thinking time; obey `minThinkSeconds`, and fail or extend rather than cutting off narration.

**Tracking behavior:** The dashboard must distinguish **total imported cards**, **eligible**, **already rendered for the current settings**, **remaining unrendered**, **queued**, **running**, **completed in this job**, **failed**, and **skipped**. Use persisted SQLite state plus verified output files. Do not claim an exact 15-second export when target timing was extended. Make the latest job state visible after an app restart.

**Job control UI:** Include inputs for deck, template, voice, timing mode, target seconds, thinking seconds, and number of new videos, plus **Generate Next N**, **Pause**, **Resume**, **Cancel**, **Retry Failed**, and **Regenerate Selected** buttons. Display a progress indicator, per-card outcomes, job timestamps, error messages, and links to exported files.

**Additional acceptance tests:**

1. For 15-second target timing, question voice finishing at 2.1 s must precede the first countdown frame; answer reveal must follow the full configured countdown or the permitted minimum.
2. Given 100 eligible cards with 73 verified existing videos for the selected configuration, Generate Next 20 must schedule exactly 20 *different* cards and leave 7 still unrendered.
3. Cancel after 7 of 20 finish: preserve 7 outputs, mark unfinished items appropriately, and never mark canceled files as complete. Resume is valid for paused/interrupted jobs; retry explicitly for canceled/failed work.
4. Reopen the app after a crash: restore status from SQLite, reconcile missing outputs and stale jobs, and continue without duplicate rendering.
5. Changing voice, template, card content, or meaningful render settings must create a new render identity; regenerate must preserve previous versions.

## 8. CLI and user workflow

Target commands (names may be refined during implementation):

```bash
pnpm app import ./decks/japanese.apkg --out ./work/japanese.json
pnpm app inspect ./work/japanese.json
pnpm app validate ./work/japanese.json --template reveal
pnpm app preview ./work/japanese.json --card <id>
pnpm app render ./work/japanese.json --template reveal --limit 20 --out ./outputs/japanese
pnpm app render ./work/japanese.json --template reveal --selected ids.txt --out ./outputs/selected
```

CLI flags: `--voice`, `--language`, `--audio original|tts|silent|mock`, `--fps`, `--width`, `--height`, `--think-seconds`, `--seed` (only for explicitly enabled deterministic ordering), `--resume`, `--overwrite`, `--dry-run`, `--concurrency`, `--duration-mode flexible|target`, `--target-seconds`, `--min-think-seconds`, `--count`, `--selection unrendered|all`.

**Pipeline steps:** import → inspect → review/validate → synthesize/probe → timeline plan → render → verify output → write manifest. Do not turn validation warnings into silent omissions.

Example manifest record:

```json
{
  "cardId": "anki:deck1:card42",
  "sourceFingerprint": "sha256:...",
  "template": "reveal",
  "status": "rendered",
  "output": "outputs/japanese/anki-deck1-card42.mp4",
  "durationMs": 14200,
  "warnings": [],
  "renderSettingsFingerprint": "sha256:..."
}
```

## 9. Phased implementation checklist

### Phase 0 — Skeleton and contracts

- [ ] Set up pnpm TypeScript workspace, formatting, linting, Vitest and CI.
- [ ] Define `Flashcard`, `ImportResult`, `RenderConfig`, `RenderPlan`, `RenderResult`, stable errors and Zod schemas.
- [ ] Add sample canonical JSON fixture with text, cloze, Unicode, image, and embedded-audio references.
- [ ] Document source licensing and content attribution fields.

**Exit gate:** a JSON fixture validates and can be inspected by the CLI.

### Phase 1 — Anki importer

- [ ] Build zip extraction into a restricted temp directory (path traversal and decompression-size checks).
- [ ] Detect `.apkg` variant and media mappings, then load supported collection structures.
- [ ] Parse notes + templates + cards; preserve per-card identities, including reversed directions and cloze variants.
- [ ] Resolve local images, `[sound:...]`, basic HTML/CSS and Unicode.
- [ ] Normalize to canonical IR and classify unsupported/ambiguous cards.
- [ ] Add fixtures for reversed, cloze, media, missing media and unsupported templates.

**Exit gate:** fixture imports return the expected card count, front/back direction, cloze reveals, media mapping and warnings.

### Phase 2 — Render one card end-to-end

- [ ] Create Remotion composition + reusable `reveal` template.
- [ ] Define versioned design tokens and `Theme`, `Layout`, `MotionPreset`, `Branding` interfaces; ship polished `washi-editorial` baseline and separate design from card content.
- [ ] Implement text fitting, image placement, long-answer wrapping and safe-area bounds.
- [ ] Implement a deterministic frame-based timeline with a silent audio adapter.
- [ ] Export portrait MP4 and probe the result for expected dimensions, codec and duration.
- [ ] Provide one-card preview in Remotion Studio or local React UI.

**Exit gate:** one JSON card renders deterministically to a visually legible MP4.

### Phase 3 — Speech and synchronization

- [ ] Implement `SpeechProvider`, `EmbeddedAudioProvider`, `SilentProvider`, `MockSpeechProvider`.
- [ ] Add one real TTS provider, opt-in credentials/config and rate/voice controls.
- [ ] Probe/correct actual audio durations; begin the thinking countdown after question narration ends, then reveal and play answer audio without overlap.
- [ ] Implement flexible and target-duration timeline modes, minimum pause/padding rules, and explicit target-infeasible handling.
- [ ] Cache audio and assets by content/config hash.
- [ ] Handle TTS errors without losing card rendering status.

**Exit gate:** video reveals the correct answer and plays the expected audio at the expected frame.

### Phase 4 — Review and batch processing

- [ ] Add CLI selection/filtering by card IDs/tags and `--limit` / `--count N` with atomic selection of unrendered cards.
- [ ] Create SQLite migrations, repository contracts and durable `cards`, `videos`, `jobs`, `job_items` records.
- [ ] Build job lifecycle (queued/running/paused/canceled/completed/failed), transactional claims, retries, reconciliation, versioned output hashes, and exact counts.
- [ ] Add a minimal local review UI to edit narration, skip cards, see source warnings and play previews; include job status/counts and pause/resume/cancel/retry controls.
- [ ] Implement Studio design controls (theme, layout, animation, countdown, typography, colors, logo/watermark) and a frame-scrubbable preview that matches the final video render.
- [ ] Add bounded concurrency, retries, temp-file cleanup, interruption handling and `--resume`.
- [ ] Produce outputs + manifest + skip/error summary; support deterministic sequential compilation if time permits.
- [ ] Run a 20-card real-world compatibility test using appropriately licensed test content.

**Exit gate:** batch of 20 cards completes and is resumable; every selected card has a rendered/skipped/failed status and explanation. A second `next N` batch excludes verified outputs, while changing settings creates traceable new variants.

### Phase 5 — Polish and packaging

- [ ] Complete three theme presets (`washi-editorial`, `technical-dark`, `playful`), polished motion/SFX, and accessibility/typography reviews without breaking timing.
- [ ] Add setup docs, FFmpeg/Chrome dependency checks, `.env.example` and troubleshooting.
- [ ] Measure throughput, TTS usage and per-card render cost; identify bottlenecks.
- [ ] Add final regression tests and a reproducible demo command.

**Exit gate:** another developer can clone, install dependencies, import an example deck and export a sample video from README instructions.

## 10. Test strategy

| Level | Assertions |
|---|---|
| IR unit tests | Invalid cards are rejected; valid Unicode/images/audio survive serialization |
| Import contract tests | Card count, template direction, cloze index, tags, media mapping are stable |
| Security tests | Zip-slip, oversized archives, external resource/script injection are contained |
| Timeline tests | Countdown starts after question voice; reveal follows countdown; speech finishes before end; target infeasibility is explicit; repeatable frame boundaries |
| Job/store tests | Atomic next-N reservation; no duplicates; crash/restart/resume; pause/cancel/retry; historical variants; missing-file reconciliation; truthful per-status counts |
| Audio tests | Correct source selection, cache invalidation, failed TTS handling |
| Rendering smoke tests | MP4 exists; expected dimensions, codecs, nonzero audio where required |
| Visual regression | Snapshot selected frames for short/long text, RTL, Unicode, image layouts |
| End-to-end | `.apkg` → normalized IR → preview → 20 MP4s + manifest |

Keep an explicit **golden fixture suite**; Anki importer compatibility is the highest-risk integration.

## 11. Important risks and decisions

| Risk | MVP mitigation |
|---|---|
| Different Anki package formats | Format detection + fixture matrix; unsupported formats fail clearly |
| Imported HTML/JS security | Sanitize content, no remote fetching, sandbox assets; never run untrusted code |
| Media references and fonts | Copy allowed local assets, validate paths and supported types; bundle suitable fonts |
| Visual overflow | Text-fit rules, maximum content thresholds, skip/review classification |
| Incorrect or unnatural pronunciation | Prefer known-good original audio; explicit locale and reviewable narration |
| TTS cost or latency | Dry run, request estimate, caching, bounded concurrency |
| Deck/media copyright | Require rights review; attach license/source metadata; do not scrape decks automatically |
| Rendering nondeterminism | Fixed frame timeline; seeded randomness if any; fingerprinted config |
| Scope creep | One template, local output, one provider, three note-pattern fixtures first |

## 12. Decisions to lock before coding

Defaults, unless requirements change:

- **Local desktop/developer workflow**, not a public website.
- **TypeScript-only application** with parsing adapters behind interfaces. An optional Python bridge is acceptable only if needed for robust Anki import.
- **One MP4 per card** as the primary output; compilation is secondary.
- **One template** (`reveal`) and **one TTS provider** first.
- **Original audio preferred** where explicitly selected and fit for purpose; never assume every embedded audio file is the answer pronunciation.
- **No auto-generated MCQ options** from Basic Anki cards.
- **Preview/review before bulk output** as the recommended workflow.

## 13. First coding sprint — exact sequence

1. Create workspace and `packages/core` with schemas, a canonical JSON fixture and validation tests.
2. Implement `packages/import-json` and `apps/cli` `inspect`/`validate`.
3. Implement Remotion `reveal` composition consuming **only canonical IR + RenderPlan**.
4. Render one text-only silent video; add frame and MP4 smoke tests.
5. Implement `packages/import-anki` for **Basic** package fixture and media extraction, then reversed/cloze.
6. Implement original-audio and mock-TTS paths, then one real TTS adapter and cache.
7. Add SQLite migrations and job repositories, atomic next-N selection, verified output tracking and manifest exports.
8. Add resume/pause/cancel/retry/reconcile flow and a thin preview + generation dashboard; test against 20 real cards.

**Implement minimal CLI tracking before polishing UI; persistent correctness is a must-have, visual dashboard polish is not. Do not begin with automation, scraping, or a polished dashboard.** Validate import fidelity and successful deterministic rendering first.

## 14. Design system and Video Studio (MVP contract)

### Aesthetic direction and reference skill

Use **Japanese editorial minimalism (ma / 間)** as the *default aesthetic direction*, not as a requirement to use Japanese motifs or text on every video. Prioritize disciplined whitespace, asymmetrical but balanced composition, subtle motion, careful typography, paper-like neutral surfaces, and a restrained vermilion/ink accent. The visual language should work equally well for Hindi, Japanese, biology, code, or mathematics. Avoid stereotypical sakura/torii decoration, decorative unreadable typography, gratuitous particles and over-animation. Use a dedicated project design skill at `docs/design/SKILL.md`; it adapts relevant publicly available design guidance into a task-specific brief (do not copy third-party skills verbatim).

References to evaluate when implementing:
- [`julianoczkowski/designer-skills` — frontend-design/SKILL.md](https://github.com/julianoczkowski/designer-skills/blob/main/frontend-design/SKILL.md): includes a **Japanese Minimalism (Ma)** aesthetic direction. Recommended starting skill for design thinking.
- [`JetBrains/skills` — frontend-design/SKILL.md](https://github.com/JetBrains/skills/blob/main/frontend-design/SKILL.md): production UI craft and non-generic typography/spacing/motion; credits Anthropic.
- [`y-endo/agents` — japanese-design-review/SKILL.md](https://github.com/y-endo/agents/blob/main/.agents/skills/japanese-design-review/SKILL.md): useful for a separate **Japanese-language dashboard** review, **not** designed for video styling.
- [Utsubo — Japanese web design style guide](https://www.utsubo.com/blog/japanese-web-design-style-guide): distinguishes sparse Japanese editorial aesthetics from dense Japanese commercial UI; do not generalize one to all Japanese design.

### Separating concerns

- `Theme`: palette, surface texture, spacing scale, typography tokens, borders, shadows, safe contrast values. **No scheduling logic.**
- `Layout`: semantic positions for prompt, choices, image, progress, answer, explanation; content-aware layout variants and overflow fallback. **No fixed palette.**
- `MotionPreset`: deterministic frame-based entrance, countdown, reveal, outro animations with reduced-motion counterpart. **No data fetching or TTS.**
- `Branding`: optional channel name, watermark, logo asset, placement/safe-area limits.
- `DesignPreset`: versioned composition of theme/layout/motion/branding/timer UI; serialized as part of output fingerprint. Users can override individual tokens.
- `Template`: renders the resolved canonical card and timeline with the selected design preset; **no knowledge of Anki**.

```ts
interface DesignPreset {
  id: string;
  version: number;
  themeId: 'washi-editorial' | 'technical-dark' | 'playful';
  layoutId: 'reveal' | 'multiple-choice';
  motionId: 'calm' | 'snappy' | 'none';
  countdownStyle: 'ring' | 'bar' | 'numeric';
  tokens?: Partial<{
    background: string; ink: string; accent: string;
    correct: string; incorrect: string;
    headingFont: string; bodyFont: string; codeFont: string;
  }>;
  branding?: { channelName?: string; logoAssetId?: string; watermark?: string };
}
```

Validate all custom values (hex colors, known local font families, asset paths, limits); never inject arbitrary user-supplied CSS/JS into a render. Font fallback should support CJK, Devanagari and math, with licenses compatible with redistribution. Ensure no content is cut off in the mobile safe region. Keep font sizes readable in a 9:16 phone preview, including lengthy answers and variable-size scripts.

### MVP presets and video composition

| Preset | Visual language | Best for |
| --- | --- | --- |
| `washi-editorial` **(default)** | warm ivory, charcoal ink, restrained vermilion, editorial grid, sparse rule lines, subtle paper texture, ample ma | language, history, general recall |
| `technical-dark` | near-black, high contrast, monospaced code blocks, minimal precise highlights | programming, STEM, maths |
| `playful` | bright but limited colors, rounded option cards, faster but controlled transitions | beginners, multiple-choice |

Build `reveal` + `multiple-choice` **only when explicit validated choices are present**. All must handle text, accessible contrast, occasional images, and an optional explanation. Use shared primitives: `PromptBlock`, `ChoiceList`, `Countdown`, `AnswerReveal`, `PronunciationCaption`, `ExplanationBlock`, `ProgressMark`, `BrandMark`, `SafeAreaFrame`, `RichTextOrMath`. No assumption that every card has 3 options.

**Frame contract:** `timeline` determines exactly when narration ends, choices appear, countdown starts, answer reveals, and answer audio plays; `design` merely animates those states. A 15-second *target* must never truncate narration: use declared infeasible-target fallback or fail cleanly. Timeline preview and final MP4 must derive from the same `RenderPlan`; do not use wall-clock CSS animations, timers, or random animation durations in the final composition. Seed any decorative randomness.

### Studio UX requirements

Local-first application with 4 navigable views:

1. **Library** — import decks, inspect cards and licensing, filter eligibility/tags, preview images/audio, mark skip/review.
2. **Studio** — 3-column desktop editor: **left** preset/theme/layout/motion/voice/countdown/duration controls; **center** real 9:16 video preview with play/pause, scrub and frame step; **right** card prompt/options/answer/explanation/media editor. Use a stacked, usable layout on narrow screens. Preset and token edits should update preview promptly without full MP4 export.
3. **Production** — `Generate Next N`, filter/selection, current settings fingerprint, queued/running/completed/failed/skipped counts, durable job progress, pause/resume/cancel/retry.
4. **Exports** — thumbnails, video versions, output folder, view/compare settings, regenerate, export manifests; never imply upload functionality.

Provide a preview at the **actual resolved TTS duration** when audio is ready; otherwise mark it as an estimated/timing-only preview. Autosave non-destructive user project settings locally. Avoid blocking the entire app while rendering jobs.

### Design acceptance tests

- Snapshot/render first/middle/last frames for each theme-layout pair; check 1080×1920 safe areas and that prompts/options/answers remain fully visible for Latin, Japanese and Devanagari fixtures, long words, RTL text where supported, and code/math.
- Confirm correct/incorrect states differ by **text/icon and color**, not color alone; legibility on a phone; no flashing or excessive motion; reduced-motion preset.
- Scrub preview across question-narration end and exact countdown start; check answer isn't shown prematurely and that preview/output frames match.
- Design changes alter render-settings hash and create versioned outputs; unchanged settings are deduplicated.
- Changing theme does **not** require audio regeneration; changing narration or voice does **not** alter design tokens; importer tests do **not** depend on Remotion.

### Implementation sequence for design

- **Phase 0:** add design contracts, token schema, preset registry and the project `docs/design/SKILL.md`.
- **Phase 2:** implement polished `washi-editorial` + `reveal`, visual snapshot tests and frame-stepped preview.
- **Phase 4:** wire Studio design controls into persistent project settings and jobs, ship `multiple-choice` when options are valid.
- **Phase 5:** ship `technical-dark` and `playful`, polish responsive content and accessibility tests.

---

## 15. Primary technical references

- Anki manual — exporting packaged decks and media: https://docs.ankiweb.net/exporting.html
- Remotion — CLI render and input props: https://www.remotion.dev/docs/cli/render
- Remotion — rendering overview: https://www.remotion.dev/docs/render

---

**MVP success = source deck in → validated canonical cards → deterministic, correctly narrated vertical videos out.** Everything else is an adapter or an optional extension.
