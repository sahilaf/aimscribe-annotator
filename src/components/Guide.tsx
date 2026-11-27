// The annotation guideline as a full page. It opens over whatever is on screen (the file list or an
// open file), so an annotator can look something up without losing their place. The rules follow
// docs/02 (transcription rules) and docs/09 (what the pre-clean marks mean) in the main repository.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { ArrowLeft, BookOpen, Check, Ear, Headphones, Pill, ShieldCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MonoLabel } from "@/components/bits";
import { cn } from "@/lib/utils";

export const GUIDE_VERSION = "Guide 1.0 · drafts pre-cleaned with rules PC-1.1";

export const useGuide = create<{ open: boolean; section: string | null }>(() => ({ open: false, section: null }));
export const openGuide = (section: string | null = null) => useGuide.setState({ open: true, section });
const closeGuide = () => useGuide.setState({ open: false, section: null });

const SECTIONS: [string, string][] = [
  ["start", "Before you start"],
  ["steps", "Annotating a file"],
  ["colours", "What the colours mean"],
  ["text", "Writing the text"],
  ["english", "English words"],
  ["drugs", "Medicine names"],
  ["numbers", "Numbers and doses"],
  ["speakers", "Speakers and segments"],
  ["tags", "Tags"],
  ["handin", "Before you hand in"],
  ["privacy", "Privacy"],
];

/* ---------- small building blocks ---------- */

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={`guide-${id}`} data-guide={id} className="scroll-mt-24 border-t pt-10 pb-2 first:border-t-0 first:pt-2">
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      {lead && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{lead}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Rule rows: what to do, an example, and why. */
function Rules({ rows }: { rows: { rule: ReactNode; ex?: ReactNode; why: ReactNode; topic: string }[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      {rows.map((r, i) => (
        <div key={r.topic} className={cn("grid gap-x-6 gap-y-2 px-4 py-4 sm:grid-cols-[10rem_1fr] sm:px-5", i && "border-t")}>
          <p className="font-medium">{r.topic}</p>
          <div className="space-y-2">
            <p className="text-[15px]">{r.rule}</p>
            {r.ex && <div className="text-[15px]">{r.ex}</div>}
            <p className="text-sm text-muted-foreground">{r.why}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Write this, not that." */
function Ex({ good, bad, note }: { good: ReactNode; bad?: ReactNode; note?: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-2 py-0.5">
        <Check className="size-3.5 text-success" /> <span className="text-foreground">{good}</span>
      </span>
      {bad && <span className="rounded-lg bg-destructive/10 px-2 py-0.5 text-muted-foreground line-through decoration-destructive/60">{bad}</span>}
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
    </span>
  );
}

const Tag = ({ children }: { children: ReactNode }) => <span className="tg font-mono">{children}</span>;

function Steps({ items }: { items: { icon: ReactNode; title: string; body: ReactNode }[] }) {
  return (
    <ol className="grid gap-3">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-4 rounded-2xl border bg-card p-4 sm:p-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{s.icon}</span>
          <div className="min-w-0">
            <p className="font-medium"><span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}</span>{s.title}</p>
            <div className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- the page ---------- */

export function GuidePage() {
  const { open, section } = useGuide();
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState("start");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeGuide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (section) document.getElementById(`guide-${section}`)?.scrollIntoView({ block: "start" });
      else scroller.current?.scrollTo({ top: 0 });
    });
  }, [open, section]);

  // Highlight the section being read in the contents list.
  useEffect(() => {
    if (!open || !scroller.current) return;
    const root = scroller.current;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.guide || "start");
    }, { root, rootMargin: "-15% 0px -70% 0px" });
    root.querySelectorAll("[data-guide]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [open]);

  if (!open) return null;
  const go = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="fixed inset-0 z-50 bg-background" role="dialog" aria-modal="true" aria-label="Annotation guide">
      <div ref={scroller} className="h-full overflow-y-auto">
        <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Button variant="ghost" size="icon" onClick={closeGuide} aria-label="Back"><ArrowLeft /></Button>
            <div className="leading-tight">
              <p className="font-semibold tracking-tight">Annotation guide</p>
              <MonoLabel className="text-[10px]">{GUIDE_VERSION}</MonoLabel>
            </div>
            <div className="flex-1" />
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><Kbd>Esc</Kbd> to close</span>
            <Button variant="ghost" size="icon" onClick={closeGuide} aria-label="Close guide"><X /></Button>
          </div>
          {/* contents as chips on small screens */}
          <nav className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-3 lg:hidden">
            {SECTIONS.map(([id, label]) => (
              <button key={id} onClick={() => go(id)}
                className={cn("h-8 shrink-0 rounded-full border px-3 text-[13px]", active === id ? "border-ink bg-ink text-ink-foreground" : "bg-card")}>{label}</button>
            ))}
          </nav>
        </header>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[13rem_1fr]">
          <nav className="sticky top-24 hidden h-fit pt-10 lg:block" aria-label="Contents">
            <MonoLabel className="mb-2">Contents</MonoLabel>
            {SECTIONS.map(([id, label]) => (
              <button key={id} onClick={() => go(id)}
                className={cn("block w-full rounded-lg px-3 py-1.5 text-left text-sm transition", active === id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </nav>

          <main className="min-w-0 pt-8 lg:pt-10">
            <div className="rounded-3xl border bg-card p-6 shadow-soft sm:p-8">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="size-5" /></span>
              <h1 className="mt-4 text-[28px] font-semibold tracking-tight">Write what was said, in Bangla script</h1>
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                You are correcting a machine draft so it matches the recording exactly. A model learns to hear from what you write, and
                every reported score is checked against your work, so a faithful transcript matters more than a tidy one.
                The draft has already been cleaned by script; the colours show where your ear is needed.
              </p>
            </div>

            <div className="mt-10 space-y-6">
              <Section id="start" title="Before you start" lead="Three things that apply to every file.">
                <ul className="grid gap-3 sm:grid-cols-3">
                  {[
                    [<Headphones key="h" className="size-4" />, "Use headphones", "Patients speak quietly and far from the microphone. Laptop speakers hide words."],
                    [<Ear key="e" className="size-4" />, "Listen, don't guess", "If you cannot make a word out after three listens, tag it [অস্পষ্ট]. A guessed word is a wrong label that looks right."],
                    [<BookOpen key="b" className="size-4" />, "Keep this guide open", "When the rules do not settle something, ask the project lead; the answer is added here."],
                  ].map(([icon, t, b]) => (
                    <li key={String(t)} className="rounded-2xl border bg-card p-4">
                      <span className="grid size-8 place-items-center rounded-lg bg-secondary">{icon}</span>
                      <p className="mt-3 font-medium">{t}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{b}</p>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="steps" title="Annotating a file" lead="Four passes, in this order. Fix the segments first, so the text is corrected inside the right ones.">
                <Steps items={[
                  { icon: <Users className="size-4" />, title: "Speakers and boundaries", body: <>Play the file. Fix who is speaking and where each segment starts and ends. Split, merge, tick overlap, and resolve any <Tag>[missed speech?]</Tag> or red timing segments.</> },
                  { icon: <Ear className="size-4" />, title: "Text", body: <>Go segment by segment. Listen closely at <span className="mk-red">red</span> and <span className="mk-gold">gold</span> words, check <span className="mk-blue">blue</span> ones, and write <span className="mk-orange">orange</span> ones in Bangla. Correct everything else you hear differently: the draft can be confidently wrong. Press <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to tick a segment and move on.</> },
                  { icon: <Users className="size-4" />, title: "Roles", body: <>Open <b>⋯ → Speakers and roles</b> and mark each speaker once: ডাক্তার, রোগী, সঙ্গী or অন্যান্য (staff).</> },
                  { icon: <ShieldCheck className="size-4" />, title: "Check and hand in", body: <>Open <b>⋯ → Checks</b>, fix every error, then <b>Mark as done</b>. A reviewer will accept it or return it with a note.</> },
                ]} />
              </Section>

              <Section id="colours" title="What the colours mean" lead="The marks are hints from the pre-cleaning script. You never delete them: they disappear when the file is saved.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["mk-red", "নাপাকে", "Red: listen here", "The recogniser was unsure, repeated itself, or missed speech. Also used for segments whose times are wrong (flag “timing”): fix the end time by ear."],
                    ["mk-gold", "দুইবার", "Gold: a number or dose", "Always listen, even if it looks right. A wrong dose is the most harmful error in a prescription."],
                    ["mk-blue", "ডায়াবেটিস", "Blue: changed by the script", "An English word or number was rewritten in Bangla, or a spelling was standardised. Check it matches what you hear."],
                    ["mk-orange", "Naposin", "Orange: still English", "The script did not know this word. Write it in Bangla script as it was said; if it is a medicine, tag it."],
                  ].map(([cls, word, title, body]) => (
                    <div key={cls} className="rounded-2xl border bg-card p-4">
                      <p className="text-lg"><span className={cls}>{word}</span></p>
                      <p className="mt-2 font-medium">{title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">Plain text has no mark. Most of it is right, but listen to it all the same.</p>
              </Section>

              <Section id="text" title="Writing the text">
                <Rules rows={[
                  { topic: "Dialect", rule: "Keep the spoken form. Do not convert it to standard Bangla.", ex: <Ex good="হইছিল" bad="হয়েছিল" />, why: "Patients speak dialect. A standard form can be made from it later; the spoken form cannot be recovered once lost." },
                  { topic: "Fillers", rule: "Write short replies and fillers with these spellings. Skip coughs, laughs and breathing.", ex: <span>হুম · হ্যাঁ · আচ্ছা · উম · আ</span>, why: "হুম often means “yes, go on” in a consultation. One spelling per sound keeps the data consistent." },
                  { topic: "False starts", rule: "Write the words that were said; a cut-off word ends with a hyphen.", ex: <Ex good="প্রে- প্রেসার" bad="প্রেসার" />, why: "They are in the audio. Deleting them breaks the match between sound and text." },
                  { topic: "Punctuation", rule: "Use only । ? and the comma.", ex: <Ex good="ওষুধটা খাচ্ছেন?" />, why: "The output needs sentence ends and questions; scoring ignores punctuation." },
                  { topic: "Unclear speech", rule: <>After three listens, tag what you cannot make out as <Tag>[অস্পষ্ট]</Tag> (<Kbd>Alt</Kbd> <Kbd>U</Kbd>). Never guess.</>, why: "Tagged spans are left out of training and scoring. A guess is not." },
                ]} />
              </Section>

              <Section id="english" title="English words" lead="Everything is written in Bangla script, including English words. No English letters at all.">
                <Rules rows={[
                  { topic: "English words", rule: "Write in Bangla script, as said.", ex: <><Ex good="প্রেসার" bad="pressure" /> <Ex good="টেস্টটা" bad="testটা" /></>, why: "The recogniser writes only Bangla, and one script means one spelling per word." },
                  { topic: "Abbreviations", rule: "Spell out the letters as said.", ex: <><Ex good="সিবিসি" bad="CBC" /> <Ex good="ইসিজি" bad="ECG" /></>, why: "That is what was heard." },
                  { topic: "Test names", rule: "Bangla script, like other English words.", ex: <Ex good="কালচার সেন্সিটিভিটি" bad="culture sensitivity" />, why: "Tests are not matched against a list yet." },
                  { topic: "Spelling", rule: "Use the approved spelling the script already wrote (blue). For a word you have not seen, type your best spelling; the project lead reviews new words weekly.", ex: <Ex good="ডায়াবেটিস" bad="ডায়বেটিস" note="one spelling per word" />, why: "Three spellings of one word teach the model three words, and count as errors in scoring." },
                ]} />
              </Section>

              <Section id="drugs" title="Medicine names" lead="Write what was said in Bangla, inside a tag that carries the name as it appears in the drug list.">
                <div className="rounded-2xl border bg-card p-5">
                  <div className="flex items-center gap-2 font-medium"><Pill className="size-4 text-primary" /> The drug tag</div>
                  <p className="mt-3 text-lg"><Tag>&lt;ওষুধ=Napa Extra&gt;</Tag>নাপা এক্সট্রা<Tag>&lt;/ওষুধ&gt;</Tag> দিনে দুইবার</p>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <p><b>After the = sign:</b> the drug-list name, in English, spelled exactly as in the list. This decides which medicine it is, so it is checked most strictly.</p>
                    <p><b>Inside the tag:</b> what was said, in Bangla script, with any ending: নাপায়, নাপার, নাপাটা.</p>
                  </div>
                </div>
                <div className="mt-4">
                  <Rules rows={[
                    { topic: "Already tagged", rule: "Check the name after = matches what was said. Fix the Bangla inside if needed.", ex: <span><span className="mk-blue"><Tag>&lt;ওষুধ=Napa&gt;</Tag>নাপায়<Tag>&lt;/ওষুধ&gt;</Tag></span></span>, why: "The script tags names it recognises; it can still mishear." },
                    { topic: "Not tagged", rule: "Add the tag yourself when you hear a medicine the script missed.", ex: <Ex good={<><Tag>&lt;ওষুধ=Seclo&gt;</Tag>সেকলো<Tag>&lt;/ওষুধ&gt;</Tag></>} bad="সেকলো" />, why: "Untagged medicines cannot be matched to a prescription." },
                    { topic: "Not sure which drug", rule: <>Write the Bangla you hear, tag it with your best guess, and add a note. Or tag the word <Tag>[অস্পষ্ট]</Tag> if you cannot hear it.</>, why: "A doctor checks every medicine in the test set; your note tells them where to look." },
                    { topic: "Misspelt in the draft", rule: "Orange drug-like words (flazil, elatrol) are the recogniser's spelling. Listen, then tag the real name (Flagyl, Alatrol).", why: "The script does not guess drug names." },
                  ]} />
                </div>
              </Section>

              <Section id="numbers" title="Numbers and doses" lead="The words where a mistake does the most harm. Gold marks every one.">
                <Rules rows={[
                  { topic: "Numbers", rule: "Write as spoken words, never digits.", ex: <><Ex good="একশো সত্তর" bad="170" /> <Ex good="দেড়টা" bad="1.5" /></>, why: "Digits hide how a number was said. Scripts flag any digit left in." },
                  { topic: "English numbers", rule: "In Bangla script, as said.", ex: <Ex good="সেভেন পয়েন্ট থার্টি" bad="7.30" />, why: "Doctors often read lab values in English." },
                  { topic: "Doses", rule: "Write the dose exactly as the doctor says it. Do not convert it to a pattern.", ex: <Ex good="একটা করে দিনে দুইবার" bad="1+0+1" />, why: "Turning a dose into a pattern is the prescription system's job; a wrong conversion here would be invisible." },
                  { topic: "Units", rule: "As said.", ex: <><Ex good="বিশ এমজি" /> <Ex good="হাফ চামচ" /></>, why: "Same reason: write what was heard." },
                ]} />
              </Section>

              <Section id="speakers" title="Speakers and segments">
                <Rules rows={[
                  { topic: "New segment", rule: "At every change of speaker, and at pauses longer than about one second. No segment over 30 seconds.", why: "The recogniser reads at most 30 s at a time. The checks flag longer segments." },
                  { topic: "Boundaries", rule: "Leave about 0.2 s before and after; never cut into a word. Drag the orange handles on the waveform.", why: "Clipped word starts are a known cause of missing first words." },
                  { topic: "Speaker IDs", rule: "S1, S2, S3 in order of first speech, one ID per person for the whole file.", why: "Lets speaker separation be scored." },
                  { topic: "Roles", rule: "Once per file: ডাক্তার, রোগী, সঙ্গী or অন্যান্য (staff).", why: "The product must say who said what." },
                  { topic: "Overlap", rule: <>When two people speak at once, give each their own segment with its true times and tick overlap (<Kbd>Alt</Kbd> <Kbd>O</Kbd>).</>, why: "Overlap is where recognisers fail most; flagged overlap can be scored separately." },
                  { topic: "Background voices", rule: <>People in the room who are not part of the consultation get the speaker <b>পটভূমি</b> (<Kbd>Alt</Kbd> <Kbd>0</Kbd>) and no text.</>, why: "The model should learn to ignore them." },
                  { topic: "Missed speech", rule: <><Tag>[missed speech?]</Tag> means the draft skipped audio where someone may be speaking. Transcribe it and give it a speaker, mark it পটভূমি, or delete the segment if there is no speech.</>, why: "The recogniser sometimes drops whole stretches." },
                  { topic: "Timing (red segment)", rule: "A whole segment in red with the flag “timing” is one the recogniser stretched over silence. Move its end to where the speech stops.", why: "Its times are wrong; the words are usually right." },
                ]} />
              </Section>

              <Section id="tags" title="Tags" lead="Only these. Anything else is plain text.">
                <div className="overflow-hidden rounded-2xl border bg-card">
                  {[
                    [<Tag key="1">&lt;ওষুধ=Name&gt;…&lt;/ওষুধ&gt;</Tag>, "A medicine: Bangla as said, drug-list name after =."],
                    [<Tag key="2">&lt;নাম&gt;…&lt;/নাম&gt;</Tag>, "A person's name or other personal detail (address, phone number), written as said. Masked automatically before anything is shared."],
                    [<Tag key="3">[অস্পষ্ট]</Tag>, "Speech you cannot make out after three listens."],
                    [<Tag key="4">[missed speech?]</Tag>, "Added by the script; resolve it, never leave it in."],
                  ].map(([t, d], i) => (
                    <div key={i} className={cn("grid gap-2 px-4 py-3.5 sm:grid-cols-[16rem_1fr] sm:px-5", i && "border-t")}>
                      <span>{t}</span><span className="text-sm text-muted-foreground">{d}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">Every tag you open must be closed. The checks flag unclosed tags.</p>
              </Section>

              <Section id="handin" title="Before you hand in">
                <ul className="grid gap-2">
                  {[
                    "Every segment ticked, and ⋯ → Checks shows no errors",
                    "No English letters and no digits left anywhere",
                    "No [missed speech?] left; every red “timing” segment fixed",
                    "Every medicine tagged, with a drug-list name after =",
                    "Every name tagged <নাম>",
                    "Each speaker has a role; background voices are পটভূমি with no text",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-[15px]">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Check className="size-3.5" /></span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="privacy" title="Privacy" lead="These are real patients.">
                <ul className="grid gap-2 text-[15px]">
                  {[
                    "Work only in this app. Do not download audio or transcripts, record your screen, or copy text elsewhere.",
                    "Do not discuss what you hear outside the project.",
                    "Files are named G01, D03, T117 on purpose. Never try to find out who a patient is.",
                    "Tag every name and personal detail with <নাম> so it can be removed before anything is shared.",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><span>{t}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
