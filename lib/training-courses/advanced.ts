import type { JobCategory, TrainingKeyTerm, TrainingSection } from '@/lib/afterworks-data'
import { lesson } from '@/lib/training-course-model'

/**
 * The advanced half of every built-in coursebook.
 *
 * The original six lessons teach the craft. These six turn it into a professional routine:
 * setting up a workspace, reading a brief like an acceptance test, using AI without handing over
 * judgement, learning from QA feedback, completing a capstone lab, and proving readiness.
 *
 * The lessons are generated from one pedagogical structure with category-specific examples, in the
 * same way a Cisco Academy course uses a shared learning model but subject-specific labs. Every
 * lesson carries a unit, a lesson type (concept, scenario, lab, checkpoint), a measurable objective,
 * a figure and a knowledge check.
 */

type CourseContext = {
  category: JobCategory
  role: string
  artifact: string
  sources: string
  deliverable: string
  qualityRule: string
  aiAllowed: string
  aiForbidden: string
  workspaceTools: string
  briefRisk: string
  capstoneTitle: string
  capstoneScenario: string
  capstoneSteps: string[]
  capstoneRubric: string[]
  capstoneImage: string
  capstoneAlt: string
  glossary: TrainingKeyTerm[]
}

const CONTEXT: Record<JobCategory, CourseContext> = {
  Transcription: {
    category: 'Transcription',
    role: 'transcription specialist',
    artifact: 'transcript',
    sources: 'recorded calls, interviews and short lectures',
    deliverable: 'a speaker-labelled, timestamped transcript in the client’s exact format',
    qualityRule:
      'every audible word is accounted for, and every uncertain word is tagged rather than guessed',
    aiAllowed:
      'checking the spelling of a name you have already heard, or organising your own revision notes',
    aiForbidden:
      'uploading client audio, inventing missing dialogue, or rewriting a speaker’s meaning',
    workspaceTools:
      'a reliable audio player, a foot pedal or keyboard shortcuts, the client style guide, and a scratch file for names and numbers',
    briefRisk:
      'the brief says “clean verbatim” but never defines whether filler words and false starts should stay',
    capstoneTitle: 'A 12-minute client call with three speakers',
    capstoneScenario:
      'You receive a 12-minute customer-discovery call, a one-page style guide, and a list of four product names. The audio has two clear speakers, one quiet participant who joins twice, a phone notification at 04:18, and one section where a name is genuinely unclear.',
    capstoneSteps: [
      'Listen once and write down the speaker map, product names and the difficult timestamps before you type a single line.',
      'Draft in five-minute blocks, marking uncertain words with a placeholder instead of stopping.',
      'Use the style guide to decide how to label the quiet participant, format timestamps and handle filler words.',
      'Run a verification pass for every name, number, date and speaker change; replace placeholders with the approved tags.',
      'Submit the clean transcript plus a short note listing the timestamp you tagged and why.',
    ],
    capstoneRubric: [
      'Every speaker change starts a new line with a consistent label.',
      'The two difficult names are either verified or honestly tagged.',
      'Timestamps follow the brief and point to real moments in the audio.',
      'No sentence contains invented dialogue.',
    ],
    capstoneImage: '/training/transcription-capstone.svg',
    capstoneAlt:
      'A three-lane speaker map beside a transcript page, with timestamp flags, a product-name checklist and one honest inaudible tag.',
    glossary: [
      { term: 'Verbatim', definition: 'A transcript that preserves the speaker’s exact words, including false starts and filler when the brief requires it.' },
      { term: 'Clean verbatim', definition: 'A transcript that removes filler sounds and false starts while preserving every idea and every speaker turn.' },
      { term: 'Speaker turn', definition: 'One continuous contribution by one speaker; a new turn normally starts a new line.' },
      { term: 'Crosstalk', definition: 'Speech from two or more people at the same time, marked with the brief’s convention rather than merged into one line.' },
      { term: 'Timecode', definition: 'A timestamp that lets a reviewer jump to the exact moment in the recording.' },
      { term: 'Tagging', definition: 'Marking uncertain or non-speech audio with an approved label such as [inaudible] instead of guessing.' },
    ],
  },
  'Data Entry': {
    category: 'Data Entry',
    role: 'data-entry specialist',
    artifact: 'structured row',
    sources: 'invoices, receipts, handwritten forms and PDF brochures',
    deliverable: 'a complete row or batch that can be traced back to its source document',
    qualityRule:
      'the source is the authority: copy, do not correct; flag, do not guess; leave a blank blank',
    aiAllowed:
      'reading a printed word you can already see, or checking a unit conversion against a written rule',
    aiForbidden:
      'pasting a client document into a public chatbot, guessing an illegible digit, or “fixing” a total that disagrees with the source',
    workspaceTools:
      'a zoomable source viewer, the column dictionary, a sample row, a duplicate-check view, and a separate field for exception notes',
    briefRisk:
      'the brief asks for a date in one format, but the source document mixes day-first and month-first dates',
    capstoneTitle: 'A mixed batch of 40 receipts and invoices',
    capstoneScenario:
      'A client sends 40 scanned documents: 30 receipts, eight invoices and two handwritten forms. The column dictionary asks for date, merchant, total, tax, currency and a source reference. Three documents are rotated, one has a handwritten total that disagrees with the printed total, and one page is missing.',
    capstoneSteps: [
      'Read the column dictionary and sample row, then map each source type before entering any data.',
      'Enter the first ten rows and verify them against the source before continuing the batch.',
      'Apply the duplicate rule to two receipts with the same merchant and amount.',
      'Record the printed total on the contradictory receipt and add the required exception note.',
      'Report the missing page instead of inferring its rows, then submit the batch with a short exception summary.',
    ],
    capstoneRubric: [
      'Every entered value can be pointed to a specific source field.',
      'Blanks and illegible values use the approved exception status, not a guess.',
      'The batch contains no duplicate rows unless the brief allows them.',
      'The exception summary names the documents that need a human decision.',
    ],
    capstoneImage: '/training/data-entry-capstone.svg',
    capstoneAlt:
      'Three source documents flowing into a row template, with a validation gate that sends ambiguous fields to an exception queue.',
    glossary: [
      { term: 'Source of truth', definition: 'The document or field the brief says wins when values disagree.' },
      { term: 'Mapping', definition: 'The documented link between a source field and a destination column.' },
      { term: 'Validation', definition: 'A separate pass that checks a finished row against the source and the field rules.' },
      { term: 'Exception status', definition: 'An approved value or note that records why a field could not be completed faithfully.' },
      { term: 'Batch', definition: 'A group of source documents processed under one brief and one set of rules.' },
      { term: 'Traceability', definition: 'The ability to connect every row back to the document and page it came from.' },
    ],
  },
  'Image Labeling': {
    category: 'Image Labeling',
    role: 'image-annotation specialist',
    artifact: 'annotation set',
    sources: 'images, video frames and a label taxonomy',
    deliverable: 'boxes or classifications that follow the taxonomy consistently',
    qualityRule: 'the box is a promise about exactly which pixels belong to the class',
    aiAllowed:
      'using a pre-label as a first draft when the client permits it, then checking every box against the taxonomy',
    aiForbidden:
      'letting a model submission through unchecked, inventing pixels that are hidden, or deciding a class by personal taste',
    workspaceTools:
      'the annotation tool, the taxonomy with visual examples, a zoom control, the edge-case gallery, and a review queue',
    briefRisk:
      'two classes look similar and the taxonomy’s written definition does not cover the example in front of you',
    capstoneTitle: 'A street-scene batch with occlusion and tiny objects',
    capstoneScenario:
      'You receive 30 street-scene images and a taxonomy for vehicle, pedestrian and road sign. Several objects are cut off by the frame, one pedestrian is behind a delivery van, and two signs are too small to classify with confidence.',
    capstoneSteps: [
      'Read the taxonomy and open the edge-case gallery before drawing the first box.',
      'Annotate five images, then compare your boxes with the worked examples in the gallery.',
      'Apply the occlusion rule to the pedestrian behind the van and the truncation rule to the cut-off vehicles.',
      'Send the two unreadable signs to the “unsure” path rather than forcing a class.',
      'Run a duplicate and missed-object pass, then submit the batch with a short note on the ambiguous cases.',
    ],
    capstoneRubric: [
      'Boxes are tight to the visible object, not loose around the scene.',
      'Occluded and truncated objects follow the taxonomy’s visible-pixel rule.',
      'Every class comes from the approved list; uncertainty is recorded, not guessed.',
      'The batch is internally consistent from the first image to the last.',
    ],
    capstoneImage: '/training/labeling-capstone.svg',
    capstoneAlt:
      'A taxonomy tree with vehicle, pedestrian and sign branches, beside three example images showing tight, occluded and unsure labels.',
    glossary: [
      { term: 'Bounding box', definition: 'A rectangle that tightly encloses the visible pixels of one object.' },
      { term: 'Taxonomy', definition: 'The approved class list and the rules for deciding which class an object belongs to.' },
      { term: 'Occlusion', definition: 'A situation where another object hides part of the target; annotate only the visible pixels.' },
      { term: 'Truncation', definition: 'A target cut off by the image edge; follow the brief’s rule for partially visible objects.' },
      { term: 'Inter-annotator agreement', definition: 'How often independent annotators make the same decision; low agreement points to an unclear rule.' },
      { term: 'Edge case', definition: 'A real example that the simple class definition does not cover cleanly.' },
    ],
  },
  'Content Review': {
    category: 'Content Review',
    role: 'content reviewer',
    artifact: 'moderation decision',
    sources: 'posts, listings, comments and ad creatives',
    deliverable: 'a policy decision plus a note a second reviewer can defend',
    qualityRule: 'apply the published policy, not personal taste, and record the evidence',
    aiAllowed:
      'using an approved classifier as a triage signal, then reviewing the content and policy yourself',
    aiForbidden:
      'sending private user content to a public tool, enforcing a personal belief that is not in policy, or deleting evidence',
    workspaceTools:
      'the policy handbook, the severity matrix, the context pane, the escalation button, and a decision-note template',
    briefRisk:
      'a post is offensive but does not meet any listed violation, and the brief does not explain what to do with borderline content',
    capstoneTitle: 'Five borderline decisions in one queue',
    capstoneScenario:
      'Your queue contains a sarcastic threat between friends, a medical claim that could cause harm, a reclaimed slur used inside its community, a copyright complaint without a formal notice, and a coordinated harassment campaign.',
    capstoneSteps: [
      'Read each item with its full context and identify the policy category before deciding.',
      'Apply the severity matrix to the threat and the medical claim instead of treating both as “bad content”',
      'Use the context rule for the reclaimed slur and explain why the same word can land differently.',
      'Route the copyright complaint through the formal process rather than making a proactive legal call.',
      'Escalate the coordinated campaign with evidence, then write a short defensible note for each decision.',
    ],
    capstoneRubric: [
      'Every decision cites a policy category, not a personal opinion.',
      'Severity and context are explained in the note.',
      'No evidence is deleted or altered.',
      'The escalation path is used for coordinated or high-risk content.',
    ],
    capstoneImage: '/training/review-capstone.svg',
    capstoneAlt:
      'A severity ladder from allow to escalate, with five example cards mapped to policy categories and decision notes.',
    glossary: [
      { term: 'Policy', definition: 'The published rule set a reviewer applies, including definitions and examples.' },
      { term: 'Severity', definition: 'How much harm a violation can cause, which determines the response and escalation path.' },
      { term: 'Context', definition: 'The surrounding conversation, identity and intent that can change how a rule applies.' },
      { term: 'Borderline', definition: 'Content that approaches a policy line but does not clearly cross it; it still needs a documented decision.' },
      { term: 'Escalation', definition: 'Sending a case to a specialist or higher authority when policy, risk or evidence is unclear.' },
      { term: 'Audit trail', definition: 'The record of what was reviewed, decided and why, so another person can reconstruct the decision.' },
    ],
  },
  Translation: {
    category: 'Translation',
    role: 'translator',
    artifact: 'target-language text',
    sources: 'product copy, legal notices, support messages and UI strings',
    deliverable: 'a faithful, natural translation that preserves format and terminology',
    qualityRule: 'carry meaning and tone, not word shapes',
    aiAllowed:
      'drafting a first pass on non-confidential text when the client permits it, then editing every sentence',
    aiForbidden:
      'sending confidential or personal text to a public model, inventing a legal term, or leaving a literal phrase that changes the meaning',
    workspaceTools:
      'the source file, the glossary, the style guide, a terminology memory, and a review copy with tracked changes',
    briefRisk:
      'the source uses a cultural reference with no direct equivalent, and the brief does not say whether to localise it',
    capstoneTitle: 'A product launch message for two audiences',
    capstoneScenario:
      'You receive a 250-word launch message, a brand glossary, and two target audiences: a formal bank partnership and a younger consumer audience. The source contains an English idiom, a date, a currency amount, a product name and a legal disclaimer.',
    capstoneSteps: [
      'Read the whole source and mark the idiom, the legal disclaimer, the brand terms and the units that need localisation.',
      'Draft the formal version first, keeping the disclaimer precise and the product name unchanged.',
      'Create the consumer version by changing register, not facts; localise the idiom and the date format.',
      'Check the glossary, formatting tags and numbers against the source.',
      'Submit both versions with a short note explaining the register choice and the one ambiguity you resolved.',
    ],
    capstoneRubric: [
      'The meaning and legal effect of the disclaimer are preserved.',
      'Brand names and glossary terms are consistent.',
      'The two versions differ in tone, not in facts.',
      'Formatting tags and numbers survive the translation.',
    ],
    capstoneImage: '/training/translation-capstone.svg',
    capstoneAlt:
      'One source message branching into a formal and a conversational target version, with glossary and disclaimer callouts.',
    glossary: [
      { term: 'Source text', definition: 'The original text being translated.' },
      { term: 'Target text', definition: 'The translated text produced for the target locale.' },
      { term: 'Register', definition: 'The level of formality and tone appropriate to an audience and situation.' },
      { term: 'Glossary', definition: 'The approved terms and their required translations, kept consistent across a project.' },
      { term: 'Transcreation', definition: 'Rewriting a message to preserve its intent and impact for another culture, rather than translating word for word.' },
      { term: 'MTPE', definition: 'Machine-translation post-editing: reviewing and correcting a machine draft to professional quality.' },
    ],
  },
  Research: {
    category: 'Research',
    role: 'research specialist',
    artifact: 'verified record',
    sources: 'public websites, registries, maps and official pages',
    deliverable: 'a sourced record with a URL that proves each fact',
    qualityRule: 'a fact without a traceable source is not a fact',
    aiAllowed:
      'using a search assistant to find candidate pages, then opening and verifying every source yourself',
    aiForbidden:
      'citing a source you did not open, accepting a generated answer as evidence, or recording private data that the task does not need',
    workspaceTools:
      'the task template, a source log, the official-registry links, a date stamp, and a “cannot verify” status',
    briefRisk:
      'the brief asks for the “main” branch but the business has three locations and no headquarters listed',
    capstoneTitle: 'Verify a business across three conflicting sources',
    capstoneScenario:
      'A business appears on its own website, a map listing and a government registry. The phone numbers differ, the address has two suite numbers, the website lists a closed location, and the registry was updated eight months ago.',
    capstoneSteps: [
      'Identify the primary source for each field before collecting values.',
      'Record the exact page URL and the date you accessed it for every fact.',
      'Cross-check the address and phone number across the sources and apply the brief’s priority rule.',
      'Mark the closed location as closed rather than deleting it, and flag the conflicting phone number.',
      'Submit the record with a source log and a short confidence note for each uncertain field.',
    ],
    capstoneRubric: [
      'Every fact has a specific, openable source URL.',
      'The source hierarchy is applied and explained.',
      'Conflicts are flagged instead of silently resolved.',
      'Private or unnecessary data is not collected.',
    ],
    capstoneImage: '/training/research-capstone.svg',
    capstoneAlt:
      'Three conflicting source cards feeding a verified record, with a source hierarchy, access date and confidence flag.',
    glossary: [
      { term: 'Primary source', definition: 'The original, authoritative record for a fact, such as an official registry or the company’s own site.' },
      { term: 'Secondary source', definition: 'A source that reports or summarises another source, such as a directory or news article.' },
      { term: 'Cross-check', definition: 'Comparing independent sources before accepting a fact.' },
      { term: 'Evidence trail', definition: 'The exact URLs, dates and notes that let a reviewer reproduce your research.' },
      { term: 'Confidence', definition: 'A clear statement of how strongly the available sources support a recorded value.' },
      { term: 'Cannot verify', definition: 'The correct status when no credible public source supports a requested fact.' },
    ],
  },
}

function setupLesson(ctx: CourseContext): TrainingSection {
  return lesson(
    'Set up a professional workspace',
    7,
    `
### Before the first task, not after

A professional ${ctx.role} does not start by opening the work and hoping. You start by arranging the things that prevent avoidable mistakes: the source, the brief, the quality rules, and a way to capture exceptions.

Your standard kit for ${ctx.artifact} work is:

- The source material — ${ctx.sources}.
- The brief and the client’s format rules.
- **${ctx.workspaceTools}**
- A scratch log for names, numbers, decisions and anything you had to ask about.

### The three-file rule

Keep three things separate:

1. **The source.** Never edit, rename or overwrite the client’s original. If the platform gives you a copy, work from the copy.
2. **Your working draft.** This is where placeholders, notes and half-finished judgements live.
3. **The deliverable.** One clean file that follows the brief. A reviewer should not have to guess which file is final.

Name the deliverable so a stranger can identify it without opening it: job ID, source name, your initials if the brief requires them, and a version or date. “final-final-2” is not a filename; it is a warning.

### Keep client material inside the approved boundary

Treat every source as confidential until the brief says otherwise. Do not move it to a personal drive, a public chat, a screenshot folder or a free AI tool. Do not forward it to another worker. If you need help, use the project’s support channel and share the minimum necessary.

> **Professional habit:** before you submit, ask “could a reviewer reproduce my work from the files I am handing over?” If the answer is no, the workspace is not finished.

### Your first fifteen minutes

- Read the brief end to end before touching the source.
- Confirm the deliverable format and the acceptance criteria.
- Open the source at the highest available quality.
- Write down the ambiguous points and resolve them before a long batch, not after.
`,
    {
      unit: 'Unit 4 · Professional setup',
      kind: 'concept',
      objective: `Arrange a ${ctx.category.toLowerCase()} workspace that keeps the source safe, the deliverable obvious and exceptions visible.`,
      image: '/training/workspace-setup.svg',
      imageAlt:
        'A three-panel workspace diagram: source material, a working draft with an exception log, and one clean deliverable file.',
      imageCaption: 'Separate the source, the draft and the deliverable. Confusion usually starts when they mix.',
      check: {
        question: `You are halfway through a ${ctx.artifact} task and realise the source file is still on your personal desktop. What is the best correction?`,
        options: [
          'Finish the task first, then move it before submitting',
          'Move the source into the approved workspace now, remove the personal copy, and note the exposure if the brief requires it',
          'Rename the personal copy so it looks like project work',
          'Share it with a colleague so someone else has a backup',
        ],
        correctIndex: 1,
        explanation:
          'Confidential material belongs inside the approved boundary for the whole task. Fix the exposure immediately and follow the project’s incident process rather than hiding it.',
      },
    },
  )
}

function briefLesson(ctx: CourseContext): TrainingSection {
  return lesson(
    'Read the brief like an acceptance test',
    8,
    `
### A brief is not background reading

The brief tells you what “done” means. Read it as a checklist that your deliverable must pass, not as a description you can skim. The most expensive mistake in ${ctx.category.toLowerCase()} work is producing something excellent that the client did not ask for.

### The six parts every brief should answer

1. **Deliverable.** Exactly what you hand over: ${ctx.deliverable}.
2. **Scope.** Which source files, rows, images or segments are included — and which are explicitly out.
3. **Format.** Naming, file type, fields, labels, timestamps or layout.
4. **Quality rule.** The standard that matters most: ${ctx.qualityRule}.
5. **Exceptions.** What to do with missing, illegible, conflicting or ambiguous material.
6. **Deadline and handoff.** When it is due and where it goes.

If one of these is missing, do not invent it silently. Ask a short, specific question. “Should the two rotated receipts be included, and should the date use the invoice date or the payment date?” is a good question. “Any tips?” is not.

### A worked example

The brief says: “${ctx.briefRisk}”.

A weak worker guesses and keeps going. A professional:

- Checks the sample or worked example for the intended convention.
- Writes down the exact ambiguity: which field, which source, which two possible readings.
- Applies the brief’s stated priority rule if one exists.
- Records the choice in the exception log or asks before a large batch.

### Turn the brief into your own checklist

Before starting, write five lines in your working notes:

- The deliverable is…
- The source of truth is…
- The format rule I must not break is…
- The exception status I will use is…
- The question I still need answered is…

That five-line contract is what you check before submission. It also makes a reviewer’s feedback easier to act on, because you can see which rule you misunderstood.

> **Academy habit:** the brief is the rubric. If you cannot explain how your deliverable meets each line, you are not ready to submit.
`,
    {
      unit: 'Unit 4 · Professional setup',
      kind: 'concept',
      objective: `Turn a client brief for ${ctx.artifact} work into a five-line acceptance checklist before starting.`,
      image: '/training/brief-anatomy.svg',
      imageAlt:
        'An annotated client brief with six labelled parts: deliverable, scope, format, standard, exceptions and handoff.',
      imageCaption: 'Six questions turn a paragraph into an acceptance test.',
      check: {
        question: `The brief says “${ctx.briefRisk}”. What should you do before processing the batch?`,
        options: [
          'Pick the reading that feels most common and continue',
          'Ask a specific question or apply the documented priority rule, and record the decision',
          'Ignore the conflict and hope QA does not notice',
          'Stop work permanently and close the task',
        ],
        correctIndex: 1,
        explanation:
          'An ambiguity is resolved with evidence or a targeted question, then recorded. Guessing hides a decision that the client may need to make.',
      },
    },
  )
}

function aiLesson(ctx: CourseContext): TrainingSection {
  return lesson(
    'Use AI without surrendering judgement',
    8,
    `
### The tool is an assistant, not the worker

AI can speed up the mechanical parts of ${ctx.category.toLowerCase()} work: finding a candidate spelling, converting a unit, drafting a first pass, or suggesting a checklist. It cannot take responsibility for the deliverable. You still own every word, box, row or decision that leaves your desk.

### The green / amber / red rule

**Green — safe by default:**

- ${ctx.aiAllowed}.
- Brainstorming questions to ask about an ambiguous brief.
- Explaining a general concept you will verify against the client’s rules.

**Amber — only when the client permits it and you verify every output:**

- Drafting non-confidential text or a first-pass classification.
- Summarising a long public document.
- Translating a phrase whose meaning you can independently check.

**Red — never:**

- ${ctx.aiForbidden}.
- Pasting client source material into a public tool without written permission.
- Using a generated answer as a source in place of the actual page.
- Allowing a model to choose a policy decision, a legal term, a medical detail or a label you cannot defend.

### A scenario worth remembering

A worker is behind schedule. They paste a confusing passage into a public chatbot and ask it to “clean it up”. The output reads beautifully. Two days later, the client asks why a number changed. The worker cannot reconstruct where the new number came from.

The problem was not the chatbot. The problem was that the worker outsourced a judgement without a source check. The professional version is slower by thirty seconds and safer by a mile: use the tool on a de-identified excerpt, ask for options rather than an answer, then verify against the source and record what you changed.

> **Non-negotiable:** if the source is confidential, the tool is not approved until the client says it is. “It was only a small file” is not a permission model.

### A five-second disclosure check

Before using any AI output, answer:

1. Did the client permit this use?
2. Did I remove private or confidential material?
3. Can I verify every fact against an approved source?
4. Would I be comfortable explaining this step to a reviewer?
5. Am I still making the final decision?

If any answer is no, do not use the output.
`,
    {
      unit: 'Unit 5 · Safe & quality practice',
      kind: 'scenario',
      objective: 'Decide when an AI tool is allowed, when it is a risk, and how to verify its output.',
      image: '/training/ai-safety.svg',
      imageAlt:
        'A green, amber and red decision board for AI use, with examples of safe assistance, permitted drafting and forbidden client-data uploads.',
      imageCaption: 'The tool changes speed. It does not change who is accountable.',
      check: {
        question: `You are stuck on a difficult ${ctx.artifact} detail. Which use of an AI tool is safest?`,
        options: [
          'Paste the full client source into a public chatbot and ask it to solve the problem',
          'Ask a general question without client data, then verify the answer against the source and brief',
          'Accept the first answer because it sounds confident',
          'Ask the tool to invent a plausible value and mark it as final',
        ],
        correctIndex: 1,
        explanation:
          'A general, de-identified question can be useful. The output is still a lead, not evidence; verify it against the approved source before it affects the deliverable.',
        image: '/training/ai-safety.svg',
        imageAlt: 'The three-zone AI safety board: green general help, amber permitted drafting, red client data uploads.',
      },
    },
  )
}

function qualityLesson(ctx: CourseContext): TrainingSection {
  return lesson(
    'The quality loop: measure, learn, improve',
    8,
    `
### Quality is a loop, not a final inspection

A beginner treats QA as the last step: submit, wait, hope. A professional treats QA as feedback that changes the next attempt. The goal is not “no feedback” — it is **the same feedback never twice**.

### The four error families

When a reviewer returns work, classify the problem before fixing it:

1. **Accuracy** — a wrong word, number, label, box or fact.
2. **Structure** — the right information in the wrong field, file or format.
3. **Compliance** — a rule from the brief, policy or confidentiality boundary was missed.
4. **Judgement** — the rule was followed, but the edge case needed escalation or a different interpretation.

The category matters because the fix is different. An accuracy error may need a verification pass. A structure error needs a mapping change. A compliance error needs a process change. A judgement error needs a clearer rule or a second opinion.

### Turn feedback into a prevention rule

For each returned item, write three lines:

- **What happened:** “I merged two speaker turns on page 3.”
- **Why it happened:** “I drafted faster than I checked the speaker labels.”
- **What changes next time:** “I will scan every new line for a label before starting the next block.”

A correction without a prevention rule is just a repair. The next file will find the same hole.

### Track your own signal

You do not need a dashboard to improve. Keep a simple tally for one week:

- Which error family appears most often?
- Which source type causes the most exceptions?
- Which part of the workflow do you rush?
- Which question do you keep having to ask?

The pattern is your training plan. If most errors are accuracy, slow the verification pass. If most are structure, fix your mapping or template. If most are compliance, re-read the boundary rules before the next task.

> **Academy standard:** a professional can explain both the correction and the system change that prevents it.
`,
    {
      unit: 'Unit 5 · Safe & quality practice',
      kind: 'concept',
      objective: 'Classify QA feedback, find the root cause, and turn it into a prevention rule.',
      image: '/training/quality-loop.svg',
      imageAlt:
        'A four-step quality loop: plan the check, inspect the work, classify the error, and change the next attempt.',
      imageCaption: 'Fix the work, then fix the reason the work needed fixing.',
      check: {
        question: `A reviewer returns the same ${ctx.artifact} mistake for the second time. What is the strongest response?`,
        options: [
          'Correct the file and move on quickly',
          'Correct it, identify which error family it belongs to, and add a prevention step to the workflow',
          'Ask the reviewer to fix it for you',
          'Ignore it because the first correction was already made',
        ],
        correctIndex: 1,
        explanation:
          'A repeated error is a system signal. Correct the deliverable and change the step that allowed the error to survive your own review.',
      },
    },
  )
}

function capstoneLesson(ctx: CourseContext): TrainingSection {
  const steps = ctx.capstoneSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')
  const rubric = ctx.capstoneRubric.map((line) => `- [ ] ${line}`).join('\n')
  return lesson(
    `Capstone lab: ${ctx.capstoneTitle}`,
    18,
    `
### The brief

${ctx.capstoneScenario}

This is a lab, not a reading exercise. Work through it on paper or in a scratch file. You do not need to submit it to anyone; you need to practise the sequence before a live card.

### Your lab

${steps}

### What good looks like

${rubric}

### The review conversation

When you finish, explain your work in four sentences:

1. What was the source of truth?
2. Which decision was hardest, and what evidence did you use?
3. What did you tag, flag or escalate instead of guessing?
4. What would you check first if a reviewer returned the file?

If you cannot answer one of those, revisit the unit that covers it. That is what the coursebook is for.

> **Lab rule:** a deliverable you cannot explain is not finished. The explanation is part of the skill.
`,
    {
      unit: 'Unit 6 · Capstone lab',
      kind: 'lab',
      objective: `Complete an end-to-end ${ctx.category.toLowerCase()} task using the brief, the quality rule and an exception log.`,
      image: ctx.capstoneImage,
      imageAlt: ctx.capstoneAlt,
      imageCaption: 'The capstone combines the brief, the source, the exception log and the final review.',
      check: {
        question: `In the capstone, which step should happen before you process the full batch?`,
        options: [
          'Submit the first draft and wait for QA',
          'Map the source and brief, then test the workflow on a small sample',
          'Delete the exception log to keep the deliverable clean',
          'Start with the most difficult item and skip the easy ones',
        ],
        correctIndex: 1,
        explanation:
          'A small sample exposes mapping and format errors while they are cheap. Submitting first turns one misunderstanding into a whole batch of corrections.',
        image: ctx.capstoneImage,
        imageAlt: ctx.capstoneAlt,
      },
    },
  )
}

function checkpointLesson(ctx: CourseContext): TrainingSection {
  return lesson(
    'Checkpoint: prove you are ready',
    7,
    `
### The four stations

The assessment asks you to make decisions, not recite definitions. Before you begin, check that you can pass these four stations without notes.

**Station 1 — The brief.** Can you name the deliverable, source of truth, format rule, exception path and deadline? If any answer is vague, reread “Read the brief like an acceptance test”.

**Station 2 — The quality rule.** The standard for this work is: *${ctx.qualityRule}*. Can you give one example of following it and one example of breaking it?

**Station 3 — Risk.** What would you refuse to do, and what would you escalate? Think about confidentiality, ${ctx.role} boundaries, and the instruction not to invent data.

**Station 4 — Handoff.** Can a reviewer reproduce your work from the files and notes you leave behind? Can you explain a difficult decision in one sentence?

### A five-minute readiness drill

Set a timer. Without looking at the course:

- Write the six parts of a complete brief.
- Name the four error families.
- Give one green, one amber and one red use of AI.
- Describe the difference between a guess and an exception tag.
- Write the first three steps you would take on a new ${ctx.category.toLowerCase()} card.

Then open the course and check. Any gap is today’s revision, not a character flaw. The assessment exists to find gaps before a client does.

### How the assessment is scored

The built-in bank has 20 applied questions and you need 16 correct (80%). The questions mix definitions, short scenarios and visual judgements. You can retake it after reading the explanations. A pass is recorded on the server and unlocks the application for this card; it does not replace the job’s own review.

> **Last habit:** read every question twice. The difference between “what should you do first” and “what should you do next” is often the whole question.
`,
    {
      unit: 'Unit 7 · Assessment readiness',
      kind: 'checkpoint',
      objective: 'Run a final self-audit across the brief, quality rule, risk boundaries and handoff.',
      image: '/training/assessment-readiness.svg',
      imageAlt:
        'A four-station readiness scorecard covering the brief, quality rule, risk and handoff, with a 16-of-20 pass target.',
      imageCaption: 'Readiness is four explainable decisions, not a lucky score.',
      check: {
        question: 'What is the best use of the five minutes before starting the assessment?',
        options: [
          'Memorise the exact wording of every lesson',
          'Review the four stations and the quality rule, then read each question carefully',
          'Ask another worker to send you the answers',
          'Start immediately to save time',
        ],
        correctIndex: 1,
        explanation:
          'The assessment tests applied judgement. A short structured review and careful reading beat memorisation and rushing.',
      },
    },
  )
}

function advancedFor(ctx: CourseContext): TrainingSection[] {
  return [
    setupLesson(ctx),
    briefLesson(ctx),
    aiLesson(ctx),
    qualityLesson(ctx),
    capstoneLesson(ctx),
    checkpointLesson(ctx),
  ]
}

export const ADVANCED_MODULES = Object.fromEntries(
  (Object.keys(CONTEXT) as JobCategory[]).map((category) => [
    category,
    advancedFor(CONTEXT[category]),
  ]),
) as Record<JobCategory, TrainingSection[]>

export const COURSE_GLOSSARY = Object.fromEntries(
  (Object.keys(CONTEXT) as JobCategory[]).map((category) => [category, CONTEXT[category].glossary]),
) as Record<JobCategory, TrainingKeyTerm[]>
