# Known limitations

- Modern compressed `.anki21b` deck packages, `.colpkg`, arbitrary JavaScript/CSS card templates and full image occlusion are not supported. Use an older-version `.apkg` export, or convert reviewed cards to canonical JSON.
- Imported HTML is reduced to text, line breaks and local images. Conditional template expressions are flagged for review and skipped.
- Text that exceeds conservative safe layout limits is skipped. This keeps the renderer from quietly clipping large cards; split or shorten them in the Studio.
- The original-audio mode needs explicit audio selection per card. It does not guess whether a bundled sound is question or answer narration.
- The mock speech provider produces a tone for sync testing. It does not test pronunciation quality.
- The local Studio is a development server bound to `127.0.0.1`; use it on a trusted computer. There is no account system or remote hosting.
- A browser and FFmpeg are needed for exports. The first render may download Chrome Headless Shell.
- The demo includes four hand-reviewed cards and a generated 20-card batch; the Anki importer contract tests use small synthetic packages. Compatibility with every real-world Anki template is not claimed.
