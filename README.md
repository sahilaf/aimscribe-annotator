# AIMScribe Annotator

A web app for correcting machine drafts of the consultation recordings by listening, on a phone or
a computer. Each teammate signs in with their own Google account; the app reads audio and drafts
from the Drive folders shared with them and saves their corrections back to Drive.

Built with React, TypeScript, Tailwind and shadcn/ui. It is a static site: no server, no database.
Drive is the storage and Drive sharing is the access control.

```
 phone / laptop browser                       Google Drive (folders you share)
 ┌──────────────────────┐   sign in (Google)   {set}/audio16k/G01.wav
 │  AIMScribe Annotator │ ───────────────────► {set}/annotation/G01.json   pre-cleaned draft (preferred)
 │  (static files)      │ ◄── audio, drafts ── {set}/drafts_scribe/G01.json|srt|txt
 │                      │ ─── corrections ───► {set}/corrected/G01__rahim.json   one file per annotator
 └──────────────────────┘
```

Try it with no setup: run it (step 3) and choose **Try the demo**. It uses made-up files and
synthetic audio and saves only in that browser.

## 1. Google Cloud setup (once, about 10 minutes)

Done by the data lead in the [Google Cloud console](https://console.cloud.google.com/).

1. Create a project, for example `aimscribe-annotator`.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform → Get started** (older consoles: *OAuth consent screen*). App name
   `AIMScribe Annotator`, your email as support contact, audience **External**.
4. **Audience → Test users:** add the Google email of every teammate (up to 100). Leave the
   publishing status on **Testing**. Only these accounts can sign in at all.
5. **Data Access → Add or remove scopes:** add `https://www.googleapis.com/auth/drive`.
6. **Clients → Create client → Web application.** Under *Authorized JavaScript origins* add
   `http://localhost:8000` and your hosted address (step 4 below), for example
   `https://aimscribe-annotator.pages.dev`. No redirect URIs are needed.
7. Put the client ID (`…apps.googleusercontent.com`) in [public/config.js](public/config.js), or
   set it on your host as the environment variable `VITE_GOOGLE_CLIENT_ID`.

What teammates will see: a "Google hasn't verified this app" screen on first sign-in. That is
normal for an app in Testing; they choose **Advanced → Go to AIMScribe Annotator** and tick the
Drive box. Google asks Testing apps to re-confirm about once a week.

Why full Drive access: annotators must read audio and drafts in folders shared with them and write
into `corrected/` folders the app did not create. The narrower `drive.file` scope can do neither.
The app only ever opens the folders added to it.

## 2. Prepare the Drive folders (once per set)

1. **Move every `PRIVATE_id_map.json` out of the folders you will share** (for example into
   `MyDrive/Aimscribe/private/`). The maps link opaque IDs to file names with phone numbers. The
   app never lists `PRIVATE_*` files, but anyone with the folder can open them in Drive itself.
2. Recommended: run `scripts/annotation/preclean_drafts.py` (in the main Aimscribe repository) on each set so `annotation/{id}.json`
   exists. Annotators then get English words and numbers already in Bangla script, with
   highlights: red where the model was unsure (listen), blue where the script converted a word
   (check the spelling), orange for words still in Latin letters. Without it the app uses
   `drafts_scribe/` and highlights the words the draft model was unsure of in red.
3. Create a folder named `corrected` inside each set folder.
4. Share each set folder with the team as **Viewer** (they cannot delete audio or drafts by
   accident), and each `corrected/` folder as **Editor**. Leave "viewers can download" on: the
   app needs it to play the audio.

```
test_set/                     ← add this folder in the app (a parent folder works too)
  audio16k/G01.wav            audio (also: audio/, wav/, or audio directly in the set folder)
  annotation/G01.json|srt     pre-cleaned draft, used first
  drafts_scribe/G01.json|srt|txt   machine draft (G01_raw.json is ignored)
  corrected/G01__rahim.json   written by the app
```

Drafts it reads: the pre-clean JSON, the Scribe draft JSON (turns with word timings), SRT and VTT
(`[S1] [overlap] text`), the scripts' timed TXT, and plain untimed text. Folders named `models`,
`results`, `scripts`, `public_data`, `diar`, `rttm`, `trimmed_maps`, `eval_silver_v0` and
`private` are skipped.

## 3. Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or later.

```powershell
npm install
```

```powershell
npm run dev
```

Then open http://localhost:8000. `npm run build` writes the finished site to `dist/`.

## 4. Host it for free

Any static host works, because the site is about 1.2 MB of files. Audio never passes through the
host: it goes straight from Google Drive to each teammate's browser, so bandwidth limits do not
matter. Each option below gives an `https://` address, which phones need.

| Host | Free tier | Private GitHub repo | Notes |
| --- | --- | --- | --- |
| **Cloudflare Pages** (recommended) | 500 builds a month; static traffic is not metered | Yes | Redeploys on every push; no commercial-use restriction |
| Vercel | Hobby plan | Yes | Hobby is for personal, non-commercial use: check this fits your team |
| Netlify | 300 credits a month, hard cap (about 15 GB of traffic) | Yes | Plenty for this app; also takes a drag-and-drop of `dist/` |
| GitHub Pages | Free | Public repos only (private needs a paid plan) | Needs a small Actions workflow |

Free tiers change; check the host's pricing page before you rely on a number.

**Cloudflare Pages, step by step:**

1. This repository is on GitHub: `sahilaf/aimscribe-annotator`.
2. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create**,
   choose **Pages** and import the Git repository. (If the dashboard only offers a Worker, import
   the repository there with the same settings; it serves `dist/` the same way.)
3. Settings: *Framework preset* **Vite** (or none), *Root directory* left empty,
   *Build command* `npm run build`, *Build output directory* `dist`.
4. Under *Environment variables* add `NODE_VERSION` = `22`. Optionally also add
   `VITE_GOOGLE_CLIENT_ID` instead of editing `public/config.js`.

No GitHub connection needed? Run `npm run build` and use **Pages → Upload assets** to drag in the
`dist` folder instead; then put the client ID in `public/config.js` before building.
5. Deploy. Your address is like `https://aimscribe-annotator.pages.dev`. Add exactly that origin
   to the OAuth client (step 1.6).

On **Vercel**, import the repository with framework **Vite**; on **Netlify**, build command
`npm run build` and publish directory `dist`.

Hosting the code publicly is safe: it contains no data and no secret (an OAuth client ID is
public by design). The built site carries a strict Content-Security-Policy: it can talk only to
Google sign-in and the Drive API.

## 5. Team workflow

| Who | Does |
| --- | --- |
| Data lead | Adds the set folders under **Folders**, presses **Copy team link** and sends it. The link opens the same folders for a teammate after they sign in |
| Annotator | Opens a file marked **To do**, corrects it segment by segment, ticks each one (**Check & next**), then **Mark as done** |
| Reviewer | Opens a **Done** file, chooses **Review Rahim's annotation**, listens to a sample, then **Accept** or **Return** with a note. The annotator sees the note as a banner when they reopen the file |
| Second annotator (test and development sets) | Opens a file someone has done and chooses **Start your own**: a separate file, so the two versions stay independent. **Hide draft text** keeps only the timings, for the one test file in five transcribed without a draft |

Each person's work is a separate file, so nobody overwrites anyone. If the same file is saved
from two places (a phone and a laptop, or a reviewer and the annotator at once), the app notices
and asks which version to keep.

**Team progress** on the files screen adds up, per annotator, files done, speech hours done, time
worked and **hours per speech hour**: the *r* in the schedule formula of
docs/02 (annotation and data use plan, in the main Aimscribe repository). Time counts only while a file is open,
visible and touched in the last minute.

## 6. Annotating

**On a computer** the transcript is in the middle (speaker on the left, start and end times above
and below each line), the selected segment's properties on the right, and the speaker-lane
timeline along the bottom.

**On a phone** times run down the left edge, a floating player sits at the bottom, and
**Edit segment** opens a sheet with a zoomed waveform and two handles for the start and end.

- Tap a segment to hear it. **Check & next** (the orange button) ticks it and plays the next one.
  The **To check** and **Flagged** filters show unticked segments, or ones with highlights, a
  missing speaker or `[missed speech?]`.
- Drag the orange handles on the timeline (or the trimmer in the properties panel) to move a
  segment's start or end; it plays that edge so a clipped word is heard at once. Tap to jump,
  drag to pan, pinch or scroll to zoom.
- **Insert** adds `[অস্পষ্ট]`, `<নাম>…</নাম>` and `<ওষুধ=Drug-list name>…</ওষুধ>`. Split, merge,
  add and delete are in the same panel. Each speaker's role is set once under **Speakers**.
- **Checks** runs the rules of `import_corrected.py`: Latin letters, digits, `[missed speech?]`
  left in, empty, unassigned or over-long segments, a speaker overlapping themself, and drug tags
  with Latin inside.
- Undo and redo cover every change. Saving is automatic: to the device at once, to Drive a few
  seconds after you stop. If the connection or the one-hour Google session drops, edits stay on
  the device and upload when you reconnect or reopen the file.
- Keyboard: Ctrl+Space play/pause, Esc replay, Ctrl+Enter check and next, Ctrl+↑/↓ previous and
  next, Alt+1…9 speaker, Alt+[ and Alt+] start or end at the playhead. All of them are under
  **⋯ → Keyboard shortcuts**.

## Output

`corrected/G01__rahim.json`:

```json
{
 "schema": "aimscribe-annotation/1",
 "audio": "G01", "audio_file": "G01.wav", "source": "annotation/G01.json", "start_mode": "draft",
 "annotator": {"email": "rahim@…", "name": "Rahim"},
 "status": "done",
 "review": {"by": "…", "name": "…", "at": "2026-11-27T10:12:00Z", "note": "…"},
 "duration": 912.4,
 "speakers": {"S1": {"role": "ডাক্তার"}, "S2": {"role": "রোগী"}},
 "notes": "", "time_spent_sec": 3720, "review_time_sec": 0,
 "segments": [
  {"start": 3.6, "end": 8.9, "speaker": "S2", "text": "…", "overlap": false, "checked": true, "draft": "…"}
 ]
}
```

`status` is `in_progress`, `done`, `returned` or `reviewed`. `draft` keeps the machine text each
segment started from, so draft and corrected pairs can be compared later. The file list reads a
summary from each file's Drive properties, so it loads without opening every file.

Check a file and collect its drug names, from the main Aimscribe repository:

```powershell
python scripts/annotation/import_corrected.py corrected/G01__rahim.json out/G01.json data/lexicon/drug_spoken.csv
```

## Privacy and limits

- Audio is downloaded into the browser's memory for playback and never written to the device.
  Unsaved edits are kept in the browser's storage until they reach Drive, then removed.
- The Google token is held in memory only and lasts an hour; the app then asks for one tap to
  reconnect. Nothing is sent anywhere except Google.
- Anyone a folder is shared with can still download it from Drive itself. The app does not change
  that; the confidentiality agreement in docs/02 does.
- The whole recording downloads before playback: about 2 MB per minute of 16 kHz audio, so a
  15-minute file is about 29 MB. Use Wi-Fi on a phone when you can.
- Needs a current browser (Chrome, Edge, Firefox, or Safari 16 and later). Light and dark follow
  the device setting.

## Code

| Path | Does |
| --- | --- |
| [src/screens/](src/screens/) | Sign-in, files, editor layouts (desktop and phone) |
| [src/editor/](src/editor/) | Transcript rows, properties panel, timeline and trimmer canvases, player, dialogs |
| [src/state/](src/state/) | Session (sign-in, folders, file list) and editor (segments, undo, saving) stores |
| [src/components/ui/](src/components/ui/) | shadcn/ui components, restyled: pill buttons, an `ink` variant |
| [src/lib/](src/lib/) | Plain JS, also used by the tests: Drive calls, folder matching, draft formats, checks, audio, demo data |
| [src/index.css](src/index.css) | Design tokens: warm paper, charcoal ink, one orange accent, mono for times |

Tests for the folder matching, the draft readers and the checks:

```powershell
npm test
```
