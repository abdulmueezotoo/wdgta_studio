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

## More tools

- **Dictionary**: fixes for words the speech model often mishears (names, Pidgin, brand terms). Applied automatically to every new transcription; "Remember this fix" on Replace all adds to it.
- **Host and guest**: click a word, then "Guest from here" or "Host from here" where the speaker changes. Guest screens are right-aligned, host screens left-aligned; names can show on the video.
- **Chapters**: Episode Blueprint sections (Founder's Case File, Reality Check, Whiteboard Moment…) or mini-episode sections, marked on the timeline. Copy YouTube chapter timestamps, or show the chapter name on the video.
- **Highlights**: suggests strong clip moments (questions, lessons, mistakes, decisions, numbers) to add as clips.
- **Intro and closing cards**: branded cards added to every exported video.
- **Music bed**: background music that dips automatically under speech.
- **Carousel**: Reality Check / Founder Playbook / quote slides (1080×1350 PNG) in the brand style. Use *stars* for yellow words.
- **Subtitles**: .srt and .vtt saved alongside each video.
- **Caption prompt**: copies the transcript with WDGTA voice rules to paste into Claude for hooks, captions, titles and hashtags.

## Working faster

- **Projects**: every project is kept in this browser with its recording and music. Reopen it from *Projects* (top bar) or *Recent projects* on the start screen; no need to add files again. *Save* still downloads a `.wdgta.json` backup you can open on another computer.
- **Projects folder** (Projects → Choose projects folder): every project is also written to a folder you pick, with its recording and music, so it survives browser clean-ups. Choose a folder inside Google Drive to back it up and open it on other computers. Chrome may ask once per session to reconnect the folder; choose "Allow on every visit" when offered.
- **Weekly pack** (Export tab): the full recording in 16:9, every clip in 9:16, the carousel slides and all subtitles in one run.
- **Keyboard**: Space play/pause · ←/→ 5 s (Shift: 1 s) · S new screen at the playhead · Y make the spoken word yellow · M mute · ? all shortcuts.
- **Loudness levelling**: exports are brought to about −14 LUFS (the level YouTube, Spotify and TikTok play at) with a soft limiter; boosts are capped at +15 dB so very quiet recordings don't turn hissy.
- **Safe zones**: shows where TikTok, Reels and Shorts put their buttons on 9:16 (preview only).
- **Word animation**: fade-in karaoke, pop, slide up or typewriter.

### Editing on the video, call to action and your default layout

- **Double-click the words on the video** to edit that screen in place. Press Enter to save or Esc to cancel. If you change the number of words, the screen's timing is shared out across the new words.
- **Punctuation shows on the video** (commas, full stops, question marks, colons and so on), the way it appears in the transcript.
- **Call to action.** Design → Call to action sets the line under the title (for example "Follow @wedeygothrougham for more"). Pick a preset or type your own. It can be moved and resized like any other element.
- **My default layout.** Arrange a project the way you like, then press Design → **Make this my default layout**. Every project then starts with that layout, in every format. **Reset to my default** brings an existing project back in line.

## Home

The app opens on **Home** (`#home`). Everything on it is read live from the other modules:

- **Greeting** with the date, the days left to Episode 1, and where the January bank stands.
- **Next up:** overdue items, the next seven days, and how many founders are waiting to be booked.
- **Road to launch:** every Capsule Sunday, the 13 Dec readiness check, Episode 1 on 3 Jan and the launch session on 10 Jan, with today marked.
- **January bank meters:** recorded, edited, and Capsule Sundays published.
- **Module doors** with a live line each: last Studio project, guest counts, next release, next calendar item.

## Guests (module 02)

Open **Guests** in the top bar (or go to `#guests`). It tracks every founder from first contact to a published episode.

- **Board and list views.** Stages: Prospect, Contacted, Discovery, Booked, Recorded, Editing, Ready, Published and On hold. Drag a card to change its stage.
- **Detail panel.** Contact details, episode angle, discovery notes, recording date, consent / photo / bio checks, and a link to the guest's Studio project. It saves as you type.
- **Bank counters.** Recorded toward the 5–6 November–December recordings, and edited toward the 4 needed by the 13 Dec readiness check.
- **Next actions.** Each guest has a next action with a date; ones due soon show in yellow, and overdue ones in marker orange.
- **Import** a `.json` (from WDGTA) or a `.csv` with a header row (columns such as Founder Name, Venture, Topic, Next Steps, Scheduled Date are recognised). Re-importing fills in gaps and never duplicates or overwrites your edits.
- **Export CSV** for a spreadsheet copy.
- **Storage.** Guests are kept in this browser. When a projects folder is connected (Studio → Projects), they are also saved as `wdgta-guests.json` in that folder and restored from it if the browser is cleared.

## Episodes (module 03)

Open **Episodes** in the top bar (or go to `#episodes`). It tracks every founder episode, Capsule and trailer.

- **Board.** Stages: Planned, Recorded, Editing, Review, Ready, Scheduled and Published. Drag a card to change its stage.
- **Release plan.** All dated releases in order, with every Capsule Sunday from 1 Nov to 27 Dec (an empty one has **+ Capsule**). It also shows the 13 Dec readiness check, Episode 1 on 3 Jan and the launch session on 10 Jan.
- **Detail panel.** Each episode has:
  - title and number (Capsules are numbered automatically; founder episodes get a number when you decide the order)
  - its guest and its Studio project
  - recording and release dates
  - a before-release checklist: audio, video, thumbnail, show notes, captions, clips, and guest approval
  - show notes, published links and notes
- **Linked to Guests.** "Plan an episode" on a guest opens a new episode for them. When an episode moves forward, its guest moves forward on the Guests board too.
- **Flags.** An episode is flagged when its release date has passed, or when it releases within a week and isn't ready.
- **Storage.** Kept in this browser, and saved as `wdgta-episodes.json` in the projects folder when one is connected.

## Calendar (module 04)

Open **Calendar** in the top bar (or go to `#calendar`). It shows every date from Guests and Episodes on one calendar:

- discovery sessions, recordings and next actions from Guests
- recordings, releases and Capsules from Episodes
- every Capsule Sunday from 1 Nov to 27 Dec
- the locked milestones: 13 Dec readiness check, 3 Jan Episode 1, 10 Jan launch session
- **My entries** you add yourself: social posts, meetings, tasks and events

- **Month and Agenda views.** The agenda covers six weeks and lists anything overdue at the top. On a phone, tap a day to see its agenda.
- **Filter chips** show or hide each kind of item.
- **Click** an item to open its guest or episode. Click an empty day (or **+**) to add your own entry, a recording or a Capsule.
- **Drag** an item to another day. The date changes in Guests or Episodes as well. Milestones can't be moved.
- **Warnings** in marker orange: overdue next actions, and releases that have passed or aren't ready a week out.
- **Export to Google Calendar** downloads an `.ics` file. Import it into a separate "WDGTA" calendar, then clear that calendar and re-import when dates change.
- **Keys:** ← / → change the month and T goes to today.

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
