import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const TRANSCRIPTION: TrainingCourse = {
  level: 'Beginner friendly · no prior experience',
  summary:
    'Turn recorded speech into a transcript a QA reviewer can trust: correct speakers, useful timestamps, faithful words, and honest tags for audio you cannot hear.',
  objectives: [
    'Build a transcript with the speaker, timestamp, and formatting rules QA checks first.',
    'Use a four-pass workflow so speed never costs accuracy on names and numbers.',
    'Handle crosstalk, noise, accents, and unclear audio without guessing.',
    'Know when a file needs escalation instead of a creative interpretation.',
  ],
  heroImage: '/training/transcription-overview.svg',
  heroAlt:
    'An audio waveform beside four transcription steps: listen once, draft in passes, verify names and timestamps, then submit.',
  heroCaption: 'The four-pass workflow you will use on every file.',
  modules: [
    lesson(
      'What transcription work actually is',
      6,
      `
### The deliverable

A transcript is a faithful written record of what was said, in the order it was said, with enough structure that another person can follow the conversation without hearing it. It is not a summary, a cleaned-up article, or your interpretation of what the speaker probably meant.

You are producing four things at once:

- **Words.** The speaker's meaning, including false starts and unfinished sentences when the brief asks for verbatim.
- **Structure.** A new line for each speaker change, with a consistent speaker label.
- **Navigation.** Timestamps at the start and at meaningful points so a reviewer can jump back to the audio.
- **Honesty.** A clear tag when the audio is unclear, rather than a confident guess.

### What lands in your queue

Most beginner work is short-form: customer calls, interviews, short lectures, and internal meetings. Files may have two speakers or six, clear studio audio or a phone call from a moving car. You will not get to choose the easy ones forever, so the workflow has to work when the audio does not.

### The standard you are aiming for

A reviewer should be able to open your transcript, compare it with the audio, and find no place where you invented a word. Small punctuation choices are normal. Invented names, swapped numbers, and missing speaker changes are not.

**Your job is faithful, readable, and traceable — in that order.**
`,
      {
        check: {
          question: 'Which sentence best describes a transcript?',
          options: [
            'A cleaned-up summary of the main points',
            'A faithful record of what was said, with speaker structure and timestamps',
            'A word-for-word copy with no formatting',
            'Your best guess at unclear words so the text reads smoothly',
          ],
          correctIndex: 1,
          explanation:
            'A transcript is a faithful, structured record. Summarising changes the meaning, and guessing hides uncertainty from the reviewer.',
        },
      },
    ),
    lesson(
      'The four-pass workflow',
      8,
      `
### Pass 1 — listen before you type

Play the whole file once at normal speed before touching the keyboard. You are listening for the shape of the conversation: who is speaking, what they are trying to do, and where the difficult audio is. This pass feels slow. It saves far more time than it costs.

Write down the speaker names or roles you can identify, plus any proper nouns you will need to check.

### Pass 2 — draft in passes

Type the words in chunks. Do not stop for every unclear syllable. Mark the spot with a placeholder and keep moving; you will return with context. Short files can be drafted in one pass. Longer files are easier in 5–10 minute sections.

Use a consistent speaker label from the first line. If you discover a third speaker later, go back and correct the label rather than inventing a new style halfway through.

### Pass 3 — verify

This is the pass QA actually notices.

- Check every name, company, place, and number against the audio.
- Check that every speaker change starts a new line.
- Check that timestamps exist where the speaker changes or the topic moves.
- Replace placeholders with the right tag: [inaudible], [crosstalk], or [silence].
- Read the transcript aloud once. Your ear catches missing words your eye skips.

### Pass 4 — format and submit

Apply the brief's formatting rules: file type, heading, timestamp interval, spelling convention, and whether filler words are kept. Remove your scratch notes. Submit one clean file, not a folder of drafts.
`,
      {
        check: {
          question: 'What is the main purpose of the first listening pass?',
          options: [
            'To type as fast as possible',
            'To understand the conversation and identify difficult audio before drafting',
            'To check the final formatting',
            'To replace unclear words with guesses',
          ],
          correctIndex: 1,
          explanation:
            'Listening first gives you context. That context is what lets you draft quickly and resolve unclear audio in the verify pass.',
        },
      },
    ),
    lesson(
      'What a QA-ready transcript looks like',
      8,
      `
### The three checks a reviewer makes first

1. **Did the speaker change get a new line?** If two people share a line, the transcript is already hard to use.
2. **Can I jump to the moment?** Put a timestamp at the start and wherever the speaker or topic changes. Use the interval the brief asks for.
3. **Were unclear words tagged instead of guessed?** A confident wrong name is worse than an honest [inaudible].

### A small example

**Pass:**

Speaker 1: We began at 9 a.m. and reviewed the file.
[00:00:14] Speaker 2: Understood. I will send the notes today.
Speaker 1: The total was [inaudible].

**Fix:**

Speaker 1: We began at 9 a.m. Speaker 2: Understood.
The total was unclear.

The second version hides two speaker changes and turns an unclear number into a vague sentence. A reviewer cannot tell what was actually said.

### Verbatim does not mean careless

Keep the speaker's words. Do not upgrade their grammar or remove a meaningful false start. You may apply the brief's rules for filler words and punctuation, but you may not change the meaning. If the brief says "clean verbatim", remove filler sounds and false starts while keeping every idea.

### Numbers, names, and units

Slow down for these. A wrong date, dose, price, or surname can change the entire meaning. If you are unsure between two plausible names, tag the uncertainty or check the brief's instructions; do not silently pick one.

### House style when the brief is silent

- Spell out one through nine; use numerals for 10 and above. Follow the brief first — a client style guide may say the opposite.
- Put a timestamp at the start and at every speaker change. If the brief asks for a fixed interval, 2–5 minutes is the usual range for long recordings.
- Keep filler words in strict verbatim; remove them only when the brief says “clean verbatim”.
- Transcribe profanity exactly unless the brief explicitly asks for censoring.
- Use quotation marks around quoted speech, and keep the quoted words faithful.
`,
      {
        image: '/training/transcription-quality.svg',
        imageAlt:
          'Two transcript panels. The green pass panel shows speaker changes, a timestamp, and an inaudible tag; the red fix panel shows merged speakers and missing timestamps.',
        imageCaption:
          'The difference between a transcript that passes QA and one that gets sent back.',
        check: {
          question: 'The audio is unclear at a client name. What is the best action?',
          options: [
            'Write the most likely name so the sentence reads smoothly',
            'Leave a blank space and continue',
            'Tag the unclear section using the brief’s convention, or ask for guidance',
            'Delete the sentence',
          ],
          correctIndex: 2,
          explanation:
            'Tags preserve the truth and show the reviewer exactly where the problem is. Guessing creates a confident error; deleting removes evidence.',
        },
      },
    ),
    lesson(
      'Edge cases: crosstalk, noise, accents, and silence',
      8,
      `
### Overlapping speech

When two speakers talk over each other, do not merge them into one line. Transcribe what is audible for each speaker and mark the collision with [crosstalk]. If the overlap is long and the brief allows it, note the approximate time range.

### Heavy background noise

Music, traffic, and wind can swallow whole words. Use [inaudible] for the missing word and keep the surrounding sentence. Do not fill the gap from what you think the speaker would have said.

### Strong accents and unfamiliar names

Slow the audio down, replay the segment, and use the rest of the conversation for context. For a name, check the brief or the company website if the task allows it. If you still cannot verify it, tag it rather than choosing a spelling that looks plausible.

### Silence and non-speech sounds

Follow the brief. Most projects want [silence] for long gaps and may want [laughter], [phone ringing], or [background noise] for meaningful sounds. Do not transcribe every cough.

### Confidentiality and safety

Transcripts often contain health, financial, or personal information. Keep files inside the approved tools, never paste client audio into a public AI tool, and never share a transcript on social media. If you hear a credible threat or an imminent risk to someone's safety, stop and escalate through the project channel rather than completing the file.

### When to stop

Stop and ask when the brief is ambiguous about a format, a name, or a confidentiality question. A short clarifying message is cheaper than redoing the file.
`,
    ),
    lesson(
      'Practice: format a short excerpt',
      7,
      `
### Your drill

Read this raw excerpt. Rewrite it as a QA-ready transcript using the rules from the course.

Raw: "speaker one says we need the report by friday speaker two says friday at noon works but i need the final numbers speaker one says i'll send them today"

### A strong answer

Speaker 1: We need the report by Friday.
[00:00:08] Speaker 2: Friday at noon works, but I need the final numbers.
[00:00:16] Speaker 1: I will send them today.

Notice what changed: each speaker owns a line, the speaker change has a timestamp, and the meaning is untouched. The timestamps are illustrative because this drill has no audio; in real work they must match the recording.

### Now try the harder version

Raw: "speaker one says the total is four thousand two fifty or maybe four thousand five hundred speaker two says check the invoice speaker one says okay"

A strong answer does not pick a number. It writes what is audible and tags the uncertainty:

Speaker 1: The total is four thousand two fifty, or maybe [inaudible].
[00:00:11] Speaker 2: Check the invoice.
[00:00:13] Speaker 1: Okay.

### Self-check

- Did every speaker change start a new line?
- Is every uncertain word tagged rather than guessed?
- Did you keep the speaker's meaning, including the unfinished sentence?
- Would a reviewer know where to replay the difficult moment?
`,
      {
        check: {
          question:
            'The speaker says an amount that could be 4,250 or 4,500. What should the transcript show?',
          options: [
            '4,250, because it is the more common amount',
            '4,500, because the speaker probably rounded up',
            'The audible words plus a tag showing the amount is uncertain',
            'A blank line',
          ],
          correctIndex: 2,
          explanation:
            'Preserve what is audible and flag the uncertainty. Choosing a number turns an audio problem into a data error.',
        },
      },
    ),
    lesson(
      'Submission checklist and the assessment',
      5,
      `
### Before you submit

- [ ] Every speaker change starts a new line with a consistent label.
- [ ] Timestamps follow the brief and appear at the start and at changes.
- [ ] Names, numbers, dates, and units have been checked twice.
- [ ] Unclear audio is tagged, not guessed.
- [ ] Formatting, spelling convention, and file name match the brief.
- [ ] Confidential material stayed inside the approved tools.
- [ ] You read the transcript once end to end.

### The assessment

The assessment is not a memory test. It asks you to apply these rules to short situations: a messy speaker change, an unclear name, a noisy recording, a confidentiality question. You need two-thirds of the questions correct to pass.

If you miss a question, read the explanation, then retake the assessment. The goal is the judgement, not a lucky score.

### Your first paid file

Start with a short file. Listen once, draft in passes, verify the details, and submit early enough to fix a problem if the reviewer finds one. Speed comes from the workflow, not from skipping it.
`,
    ),
  ],
}
