# AIMScribe Annotator

A web app for correcting machine drafts of the consultation recordings by listening, on a phone or
a computer, with an admin dashboard for assigning work and following progress.

- **Annotators** sign in with Google for their email only. They never get a Drive permission
  screen, never paste a link, and see only the files assigned to them.
- **The admin** (you) connects their Google Drive once. Audio, drafts and every annotation stay
  in that Drive; nobody else gets access to it.
- **Anyone can sign up.** A newcomer waits on a "you're on the list" screen and sees no patient
  audio until the admin approves them or assigns them files.

```
 annotator's browser ─┐                       ┌─ your Google Drive
                      ├─▶ Cloudflare Worker ──┤   audio16k/, drafts, corrected/<ID>__<name>.json
 admin's browser ─────┘   (this repo)         └─ aimscribe-annotator-state.json (people, roles, assignments)
```

The Worker serves the site and a small API. It holds your Drive key as a Cloudflare secret, checks
every file request against the assignments, streams audio from Drive, and saves annotations into
Drive. The list of people and assignments is a JSON file in your Drive too, so nothing about the
project is stored on Cloudflare. Built with React, TypeScript, Tailwind and shadcn/ui; free on
Cloudflare Workers.

## Setup (once, about 15 minutes)

### 1. Google Cloud (your OAuth client)

In [console.cloud.google.com](https://console.cloud.google.com) → **Google Auth Platform**:

1. **Clients → your web client → Client secrets: Add secret**, and delete any secret that was ever
   shared or pasted anywhere. Keep the new one for step 2.
2. Same client → **Authorized redirect URIs → Add**:
   `https://aimscribe-annotator.sahilfarib320.workers.dev/api/admin/drive/callback`
   (Authorized JavaScript origins keep `https://aimscribe-annotator.sahilfarib320.workers.dev`.)
3. **Audience → Publish app** (status *In production*). Teammates only share their email with the
   app, so Google needs no review for them, and the test-user list no longer limits who can join.
   You, as the owner, will see an "unverified app" warning once when you connect Drive: choose
   **Advanced → Go to AIMScribe Annotator**.

### 2. Cloudflare secrets

Cloudflare → **Workers & Pages → aimscribe-annotator → Settings → Variables and Secrets → Add**,
type **Secret**:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_SECRET` | the new client secret from step 1.1 |
| `ADMIN_EMAILS` | your Google email (several: comma-separated) |

`GOOGLE_CLIENT_ID` is public and already in `wrangler.jsonc` and `public/config.js`.

### 3. Deploy

Cloudflare builds and deploys every push to `main` (`wrangler.jsonc` runs the site build, then
deploys the Worker). In the project's **Settings → Build**, the deploy command is
`npx wrangler deploy`; add `NODE_VERSION` = `22` as a build variable if the build complains about
Node.

### 4. Connect your Drive (in the app)

1. Open the site and sign in with the email in `ADMIN_EMAILS`. You land on the dashboard.
2. **Settings → Connect Drive**, choose your account, tick **Google Drive**.
3. The next page shows a key. Add it as one more Cloudflare **Secret** named
   `DRIVE_REFRESH_TOKEN`, then press **I've saved it: check again** in Settings.
4. **Settings → Set folders**: paste the links of `test_set`, `dev_set` and `train_set`.

### 5. Assign work

1. **People → Copy invite link** and send it to anyone. When they sign in they appear under
   *Waiting for access*. You can also add people by email in advance.
2. **Tasks**: pick a set, tick files (or **Next 10 unassigned**), choose a person, choose
   **Annotate** or **Review**, press **Assign**. Assigning work also approves the person.
3. **Overview** shows files finished, audio left, an estimate of working hours left at the team's
   pace (hours per speech hour, the *r* in docs/02), who is doing what, the review queue and the
   latest saves. **Block** or **Remove** a person in People and they lose access at once; their
   saved work stays in your Drive.

## Who can see what

Checked by the Worker on every request, not just hidden in the page:

| Person | Can open |
| --- | --- |
| Not yet approved | Nothing |
| Annotator | Audio and drafts of files assigned to them, and their own annotation of each. Not other people's annotations of the same file, so double annotation stays independent |
| Reviewer | Files assigned to them for review, including every annotation of those files; their edits go into the annotator's file and are marked as theirs |
| Admin | Everything, plus the dashboard |

`PRIVATE_*` files are never listed or served, even to admins. Audio is streamed into the browser's
memory and never saved on the device; unsaved edits are kept on the device until they reach Drive.

## The data in your Drive

```
test_set/                     a set folder you add in Settings
  audio16k/G01.wav            audio
  annotation/G01.json|srt     pre-cleaned draft (preclean_drafts.py), used first
  drafts_scribe/G01.json|srt  machine draft
  corrected/G01__rahim.json   one file per annotator, written by the app
aimscribe-annotator-state.json   in My Drive: people, roles, assignments, set folders
```

Drafts it reads: the pre-clean JSON, the Scribe draft JSON, SRT and VTT (`[S1] [overlap] text`),
the scripts' timed TXT, and plain untimed text. An annotation file:

```json
{
 "schema": "aimscribe-annotation/1", "audio": "G01", "source": "annotation/G01.json",
 "annotator": {"email": "rahim@…", "name": "Rahim"}, "status": "done",
 "review": {"by": "…", "name": "…", "at": "…", "note": "…"},
 "speakers": {"S1": {"role": "ডাক্তার"}}, "time_spent_sec": 3720,
 "segments": [{"start": 3.6, "end": 8.9, "speaker": "S2", "text": "…", "overlap": false, "checked": true, "draft": "…"}]
}
```

Check a file and collect its drug names, from the main Aimscribe repository:

```powershell
python scripts/annotation/import_corrected.py corrected/G01__rahim.json out/G01.json
```

## Annotating

On a computer: transcript in the middle (speaker left, times above and below each line), the
segment's properties on the right, speaker-lane timeline at the bottom. On a phone: times down the
left edge, a floating player, and **Edit segment** for a sheet with a zoomed waveform and two
handles. Tap a segment to hear it; the orange **Check & next** ticks it and plays the next one;
**Mark as done** sends it for review. Keyboard shortcuts are under **⋯ → Keyboard shortcuts**.

## Run it on your computer

Needs Node.js 20 or later.

```powershell
npm install
```

```powershell
npm run dev:api
```

Then open http://localhost:8787. With the file `.dev.vars` containing `DEMO=1` (not committed),
this uses a made-up in-memory Drive, and the sign-in screen lets you sign in as any email:
`admin@demo.test` is the admin. Never set `DEMO` in Cloudflare.

`npm test` runs the tests for folder matching, draft readers and checks. `npm run build` type-checks
and builds.

## Limits of the free plan

Cloudflare Workers Free allows 100,000 requests a day and 10 ms of CPU per request. The app's
requests are small; audio is streamed, not processed. If the dashboard ever fails with a CPU limit
error on very large folders, the Workers Paid plan (5 USD a month) removes it.

## Code

| Path | Does |
| --- | --- |
| [worker/](worker/) | Backend: sign-in, access rules, Drive as the owner, the state file, a fake Drive for local tests |
| [src/screens/](src/screens/) | Sign-in, waiting, my tasks, admin dashboard, editor |
| [src/admin/](src/admin/) | Dashboard tabs: overview, tasks, people, settings |
| [src/editor/](src/editor/) | Transcript rows, properties panel, timeline, player |
| [src/state/](src/state/) | Session and editor stores (saving, undo, conflicts) |
| [src/lib/](src/lib/) | API client, folder matching, draft formats, checks, audio, demo data |
| [wrangler.jsonc](wrangler.jsonc) | Cloudflare Worker settings (no secrets) |
