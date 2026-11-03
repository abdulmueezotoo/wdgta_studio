# WDGTA Studio

Part of the **We Dey Go Through Am** operating system. Module 01: turn an episode recording into branded, captioned videos for every platform.

## What it does

1. **Add the recording.** Upload the audio (MP3, M4A, WAV, AAC, or a video file).
2. **Transcribe.** Studio runs OpenAI's open-source Whisper speech model *inside your browser*. The audio is never uploaded anywhere. The model downloads once (about 80–250 MB depending on the quality setting) and is cached after that.
3. **Check the words.** Click any word to fix it, highlight it in WDGTA yellow, start a new screen from it, or join screens. Find & replace fixes repeated mistakes (names, Pidgin, brand terms) in one go. Undo with Ctrl/Cmd+Z.
4. **Preview** in every format while the audio plays, or press **Full screen**.
5. **Arrange the design.** Drag the words, logo, title, handle or progress line anywhere on the preview. Select one to resize it (size slider, mouse wheel, or arrow keys to nudge; Shift+arrow for bigger steps). Positions are saved separately for each size.
6. **Background colour.** Ink, Black (blends into dark-mode apps), Graphite, Mist, Stone or Yellow. On light backgrounds the words turn Ink and yellow words become yellow blocks, following the brand rules.
7. **Marker.** Click a word and choose *Circle*, *Underline* or *Cross it out*: a hand-drawn marker-orange mark draws itself when the word is spoken. Add a handwritten note (Kalam) with an arrow to any screen; drag it to move it.
8. **Yellow words.** Choose 1–3 yellow words per screen, or click any word and press **Make yellow**.
9. **Cut it into clips.** Split the recording automatically into ~30/45/60/90-second parts (cut at natural pauses), or add a clip at the play position and adjust its start and end. Each clip can have its own on-screen title.
10. **Export** the full recording and/or any clips, in any sizes, in one go. Save into a folder (pick a folder inside Google Drive for desktop to send them straight to Drive) or to Downloads. **Save this frame as image** makes a PNG for quote cards, carousel slides or thumbnails.

| Format | Size | Use |
|---|---|---|
| 9:16 | 1080×1920 | TikTok, Reels, Shorts, WhatsApp Status |
| 4:5 | 1080×1350 | Instagram & Facebook feed, LinkedIn |
| 1:1 | 1080×1080 | Instagram, Facebook, LinkedIn |
| 16:9 | 1920×1080 | YouTube, Facebook, LinkedIn |

The official WDGTA logo is built in (white on dark backgrounds, black on light ones: `assets/`); you can swap in another logo under Look.

Projects auto-save in the browser, and **Save project** downloads a `.wdgta.json` file you can open on another computer (add the audio file again there).

## Requirements

- **Chrome or Edge (latest), on a laptop or desktop.** Video export uses the browser's built-in encoders (WebCodecs). Safari and Firefox are not supported for export.
- Internet connection the first time you transcribe (to download the speech model).
- A 10-minute episode typically transcribes in a few minutes and exports each format in a few minutes, depending on the computer.

## Brand rules built in

Ink background `#0E0E0C`, headlines in Arial Black (Archivo Black fallback, bundled), labels in IBM Plex Mono, one WDGTA yellow `#FFC710` word per screen, `@wedeygothrougham` handle. In 9:16 the branding sits at the top so platform buttons don't cover it.

## How it's built

Plain HTML, CSS and JavaScript modules: no build step, no server, no accounts.

- `index.html`, `css/studio.css`: the app shell (module rail for future WDGTA modules) and Studio UI
- `js/app.js`: upload, editing, preview, project save/load, export flow
- `js/render.js`: the kinetic-typography renderer (shared by preview and export)
- `js/transcribe-worker.js`: Whisper via [Transformers.js](https://github.com/huggingface/transformers.js) 3.7.6 (loaded from jsDelivr), runs in a Web Worker
- `js/exporter.js`: WebCodecs H.264/AAC encoding (VP9/Opus fallback) and MP4 packaging
- `js/vendor/mp4-muxer.mjs`: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.2 (MIT)
- `fonts/`: Archivo, Archivo Black, IBM Plex Mono, Kalam (SIL Open Font License, via Fontsource)

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
