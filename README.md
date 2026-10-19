# Anki Video Studio

Local tool for importing Anki deck packages or canonical JSON cards, reviewing content, previewing a frame based design, and exporting one portrait MP4 per card. The default visual style follows the project brief in [SKILL.md](SKILL.md).

## Requirements

- Node.js 24 or later, npm, FFmpeg and ffprobe on `PATH`.
- A supported Chromium browser. Remotion downloads Chrome Headless Shell on first render if needed.
- A deck you have the right to republish. The included JSON demo cards are CC0.

## Start

```bash
npm install
npm run studio
```

Open `http://127.0.0.1:5173`. In **Library**, click **Choose deck**, select a `.json` or legacy `.apkg` file, then click **Import selected**. The page shows an import message while large decks are processed. **Refresh** reloads the library; the page retries automatically if the API starts after the browser page. Review a card in **Studio**, then use **Production** to generate the next N videos. **Exports** shows historical versions and downloads. Project data is stored in `work/`; output files default to `outputs/`.

Choose the source deck in **Production** before generating. Export names include the deck, card number, short prompt, card type, and version, for example `part-1-listening-comprehension_0001_konnichiha_listening_v01.mp4`. The **Exports** view shows each full file path. Batch manifests are beside the MP4 files. `npm run app -- rename-exports` updates older UUID-named local exports and their database paths.

The Studio runs only on localhost. Card previews and final videos use the same Remotion component and integer frame plan. Select `OpenAI TTS` explicitly and set `OPENAI_API_KEY` before using paid synthesis. The `mock` mode creates a quiet test tone, not speech.

## CLI

On Windows with npm 11, include the second `--` before flags:

```bash
npm run app -- import fixtures/cards.json
npm run app -- validate -- fixtures/cards.json
npm run app -- preview -- --card json:demo:1
npm run app -- generate -- --count 1 --audio silent --out outputs/demo
npm run app -- jobs -- list
npm run app -- stats
npm run app -- generate Anki/Japanese_course_based_on_Tae_Kims_grammar_guide__anime.apkg -- --count 1 --audio original --out outputs/jlab
```

For a repeatable 20-card batch:

```bash
node scripts/make-demo.mjs
npm run app -- import fixtures/cards-20.json
npm run app -- generate -- --count 20 --audio silent --think-seconds 0 --reveal-seconds 0.2 --hold-seconds 0 --out outputs/demo20
```

`generate` reserves eligible cards without an existing verified output for the current card content and render settings. The response reports a shortfall if fewer than N remain. `--regenerate` explicitly creates new output versions. Use `jobs show|pause|resume|cancel|retry ID` and `reconcile` for interruption recovery. Each output folder contains a `manifest-JOB_ID.json` with statuses, errors, fingerprints, and file paths.

Timing flags: `--duration-mode flexible|target`, `--target-seconds N`, `--think-seconds N`, `--min-think-seconds N`, `--reveal-seconds N`, `--hold-seconds N`, `--infeasible-target fail|extend`. Countdown begins after question narration. A target that cannot contain narration plus minimum timing fails or extends as configured.

Design flags: `--theme washi-editorial|technical-dark|playful`, `--layout reveal|multiple-choice`, `--template reveal|multiple-choice`. Multiple choice only renders when options are explicit and valid. `--selected ids.txt` filters to listed card IDs; `--tags a,b` and `--deck ID` narrow selection. `--dry-run` shows current settings and counts without reserving outputs.

## Supported imports and review

Legacy Anki SQLite package variants (`collection.anki2` and `collection.anki21`) are supported for Basic, reversed and simple cloze cards. Modern compressed `.anki21b` exports produce an actionable error; export with Anki's **Support older Anki versions** option. `.colpkg`, arbitrary card scripts, complex conditional templates, and unknown media are not rendered. Import warnings and skipped cards remain visible.

The supplied Jlab course uses custom card templates. Its listening cards are mapped to Japanese prompt, image, bundled question audio, and the first line of the English remarks as the answer. Short supplemental remarks become explanations; longer ones remain in the source fields for review. Its reading cards have no distinct answer in the package, and information cards are not question and answer cards, so both are imported but skipped until reviewed. Answers above the safe layout limit are also skipped. The original MP3 is assigned automatically for Jlab listening cards. Other decks need an explicit audio assignment in Studio. Silent is the default. JSON cards follow the `Flashcard` schema in [core.ts](src/core.ts); see [cards.json](fixtures/cards.json) for examples. Relative media paths in JSON should be made absolute before import.

Run `npm test` for import, timing and selection tests, and `npm run build` for TypeScript and Studio bundling. FFmpeg output is verified for dimensions, H.264, AAC and duration before a job counts as completed.

## Limits

See [known limitations](docs/known-limitations.md). Check [Remotion licensing](https://www.remotion.dev/docs/license) and your TTS provider terms before commercial release.
