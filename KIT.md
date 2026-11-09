# Episode kit: how Studio and Claude hand work to each other

The kit removes the copy-and-paste step between Studio and Claude. Studio saves one **request** file in the projects folder. Claude reads it, writes everything the episode needs, and saves one **kit** file in the same folder. Studio finds the kit and fills itself in.

When the projects folder sits inside Google Drive (Drive for desktop), Claude reads and writes it through Drive, so nothing is attached, copied or pasted.

```
Studio  ──►  <projectId>--kit-request.json  ──►  Claude
Studio  ◄──  <projectId>--kit-<stamp>.json  ◄──  Claude
```

## In Studio

Pack tab → **Episode kit**.

1. Finish the pack (clips, quotes, points, carousel), then press **Ask Claude for the kit**.
2. Tell Claude "run the WDGTA kit", or leave it to the scheduled check.
3. Open the Pack tab again (or press **Check**). The kit loads by itself:
   - **Captions** go straight into `Captions.docx` and `Posting plan.csv` when you export the pack.
   - **Title options, thumbnail words, YouTube and Spotify descriptions, promo playbook:** each has a Copy button.
   - **Show notes → Save to episode** puts them on the linked episode.
   - **Posting plan → Add to Calendar** makes one Calendar entry per post, with its caption and file names in the notes. Export to Google Calendar takes them to your phone.
   - **Claude needs from you** lists anything Claude would not guess.

Without a projects folder, the request is downloaded instead: attach it to a Claude chat, then use **Open a kit file** with what Claude sends back. The older "Copy for Claude" box still works, and anything pasted there replaces the kit's captions for those posts.

If you change the pack after asking, captions still land on the right posts as long as the words of the post are the same. Ask again after bigger changes.

## The request (written by Studio)

`<projectId>--kit-request.json`

| Field | What it is |
|---|---|
| `kind` | `"kit-request"` |
| `projectId` | Studio project id |
| `requestedAt` | ISO time of the request |
| `title` | Episode title as it will be published |
| `episode` | `{ type, number, title, releaseDate, stage }` from Episodes, or `null` when not linked |
| `host`, `guest` | Names as set in Studio (`guest` is empty for Capsules) |
| `duration` | Length of the recording |
| `hashtags`, `ctas` | The hashtag(s) for every post and the allowed calls to action |
| `chapters` | `[{ t, name }]` |
| `transcript` | `[{ t, spk, text }]` timed paragraphs; `spk` is `host` or `guest` |
| `posts` | `[{ id, key, kind, name, text, sub, at, seconds, captionsFor }]` every post in the pack. `captionsFor` lists the caption fields wanted for that post |

## The kit (written by Claude)

`<projectId>--kit-<YYYYMMDD-HHMM>.json`, saved next to the request. A new kit gets a new name; Studio uses the one with the latest `madeAt`.

```json
{
  "app": "wdgta-os",
  "kind": "kit",
  "version": 1,
  "projectId": "…",
  "madeAt": "2026-11-09T21:30:00Z",
  "requestedAt": "…copied from the request…",
  "titles": ["…", "…", "…"],
  "thumbnails": ["…", "…", "…"],
  "youtubeDescription": "…",
  "spotifyDescription": "…",
  "showNotes": "…",
  "captions": { "C1": { "Instagram": "…", "TikTok": "…", "YouTube Shorts title": "…", "Facebook": "…", "LinkedIn": "…" } },
  "postKeys": { "C1": "…the post's key, copied from the request…" },
  "promo": [{ "play": "Cold-open Short", "text": "…", "needs": "…" }],
  "plan": [{ "day": 0, "post": "FULL", "what": "Full episode", "platforms": ["YouTube"], "time": "", "note": "" }],
  "questions": ["…"]
}
```

- `captions` uses the post ids and the exact `captionsFor` names from the request.
- `postKeys` copies each post's `key`, so captions follow a post if its number changes.
- `plan`: `day` counts from release day (0). `post` is a post id when the entry is one of the pack's posts; leave it out for promo plays and use `what` and `text`.
- `promo`: one entry per play from the promo playbook that this episode can honestly support. `needs` says what must exist first (a guest photo, a voice note). Plays that need a guest are left out for Capsules.
- `questions`: anything missing that Claude will not invent.

## Rules Claude follows when writing a kit

- Use only what the request contains. Never invent facts, quotes, numbers, guest details or release dates. Put gaps in `questions`.
- Voice: clear English first; Pidgin only where it is natural. Honest, direct, warm. Founders' decisions and reasoning, not generic motivation.
- Tagline "Beyond the Success Stories." Abbreviation WDGTA. Capsule titles read `Capsule [number] | [Title]`.
- The full episode lives on YouTube (and Spotify). Every short post points to it. Instagram and Facebook captions end with "Full episode on YouTube (link in bio)". Write `[YouTube link]` where a link belongs.
- TikTok under 40 words. LinkedIn 80–150 words. YouTube Shorts titles under 60 characters.
- Every caption ends with one of the request's `ctas` and carries the request's `hashtags`; up to 4 more relevant hashtags on Instagram and TikTok only.
- Thumbnail words are hooks: short, thought-provoking, and need not match the title.
- No publishing schedule is promised in any public text.
