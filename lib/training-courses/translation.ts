import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const TRANSLATION: TrainingCourse = {
  level: 'Beginner friendly · no prior experience',
  summary:
    'Carry meaning, tone, and intent from one language to another without translating word for word. Learn the meaning-first workflow, glossary discipline, and the review pass that catches unnatural output.',
  objectives: [
    'Read for meaning and register before drafting a translation.',
    'Preserve names, numbers, formatting, and glossary terms exactly.',
    'Handle idioms, ambiguity, and cultural references without inventing meaning.',
    'Review the target text for fluency and fidelity before submitting.',
  ],
  heroImage: '/training/translation-overview.svg',
  heroAlt:
    'A source sentence in English flowing through a meaning-and-tone stage into a natural Swahili translation, with steps for reading, preserving meaning, and matching register.',
  heroCaption: 'A faithful translation sounds natural in the target language.',
  modules: [
    lesson(
      'Meaning first, words second',
      6,
      `
### What a translation is

A translation is not a word-for-word copy. It is the same message, delivered in a way a reader of the target language would naturally understand. The source gives you the meaning, the tone, and the constraints. The target language gives you the grammar, the rhythm, and the idioms.

### Three things to preserve

1. **Meaning.** The facts, the request, the warning, the promise.
2. **Tone.** A polite customer email should not become a legal notice. A joke should still feel like a joke, if the target culture allows it.
3. **Format.** Headings, bullet lists, names, numbers, units, and links stay where the brief puts them.

### One thing you may change

The word order. Different languages organize information differently. A natural translation often moves the verb, splits a long sentence, or merges two short ones. That is not a loss of fidelity; it is the job.

### The beginner trap

Translating each word and then repairing the grammar. The result is usually grammatically possible and completely unnatural. Read the whole source paragraph first, hold the meaning in your head, then write the target paragraph without looking back at every word.

**If a native reader has to decode your sentence, it is not finished.**
`,
      {
        check: {
          question: 'What is the primary goal of a translation?',
          options: [
            'Match the source word order exactly',
            'Carry the meaning, tone, and intent into natural target language',
            'Use the longest possible words',
            'Translate only the nouns',
          ],
          correctIndex: 1,
          explanation:
            'Fidelity is about meaning and effect, not word order. Natural target-language grammar is part of a good translation.',
        },
      },
    ),
    lesson(
      'The translation workflow: read, draft, review',
      8,
      `
### 1. Read the whole text

Read the source once without translating. Identify the purpose, the audience, the register, and the key terms. A product description, a legal notice, and a friendly message need different voices even when they share vocabulary.

### 2. Build a mini glossary

List names, product terms, recurring phrases, and units. If the brief provides a glossary, use it exactly; do not improve it. If a term is missing, choose one translation and use it consistently across the whole file.

### 3. Draft for meaning

Translate paragraph by paragraph. Keep the source meaning in mind, then write the target sentence as if you were writing it originally. Do not leave a sentence half-source and half-target. If you cannot resolve a phrase, mark it and continue; return with the full context.

### 4. Review for fidelity

Compare the target to the source for facts, numbers, names, negation, and scope. A missing “not” changes everything. Check that every requirement in the source is still a requirement, and every optional item is still optional.

### 5. Review for fluency

Read the target aloud. Look for calques, repeated sentence openings, unnatural pronouns, and register shifts. If a sentence is grammatically correct but no native speaker would say it, rewrite it.

### 6. Final format pass

Check headings, lists, punctuation style, date and number formats, and placeholders. Do not translate variable names, codes, or URLs unless the brief says to.
`,
      {
        check: {
          question: 'When should you build the glossary for a translation?',
          options: [
            'After submitting, if the client asks',
            'Before drafting, using the brief and the source terms',
            'Only for legal documents',
            'Never; every sentence can use a different term',
          ],
          correctIndex: 1,
          explanation:
            'A glossary chosen before drafting keeps terminology consistent across the whole file and prevents mid-file style shifts.',
        },
      },
    ),
    lesson(
      'Fidelity, fluency, and the glossary',
      8,
      `
### Fidelity checks

- **Negation.** Did “not required” become “required”?
- **Scope.** Does “all staff in Nairobi” still mean Nairobi only?
- **Numbers and units.** Are 5 km, $50, and 12 May still the same values?
- **Names.** Did you translate a person's name, a brand, or a legal entity that should stay in the source form?
- **Placeholders.** Are {name}, %s, and the link still intact?

### Fluency checks

- Read the target aloud. If you run out of breath, the sentence may be too long for the target language.
- Look for source-language word order. A sentence can be correct and still sound translated.
- Check pronoun and honorific choices. The wrong level of formality can change the relationship.
- Avoid synonym churn. If you called a term “savings account” on page one, do not call it “deposit account” on page two without a reason.

### Glossary discipline

Use the client's term even if you prefer another one. The glossary exists so that every translator, reviewer, and future file uses the same vocabulary. If a glossary term is genuinely wrong or ambiguous, flag it; do not silently replace it.

### What to do with an untranslatable term

Keep the source term and add a short explanation only if the brief allows notes. Do not invent a local equivalent that changes the meaning. For a product name, usually keep it. For a legal concept, use the established term in the target jurisdiction, not a literal coinage.
`,
      {
        image: '/training/translation-idiom.svg',
        imageAlt:
          'A literal translation of “it is raining cats and dogs” marked wrong beside the natural Swahili equivalent “Mvua inanyesha sana”.',
        imageCaption:
          'Translate the meaning, not the words. A literal idiom is the clearest sign of a weak translation.',
        check: {
          question:
            'The source contains an idiom with no equivalent in the target language. What is the best approach?',
          options: [
            'Translate it word for word so the reader can see the original',
            'Replace it with an unrelated local idiom',
            'Translate the plain meaning naturally, or keep the source idiom with a brief explanation if allowed',
            'Delete the sentence',
          ],
          correctIndex: 2,
          explanation:
            'The meaning is the message. A literal idiom is confusing, and an unrelated local idiom changes the image and tone.',
        },
      },
    ),
    lesson(
      'Edge cases: ambiguity, culture, and incomplete source',
      8,
      `
### Ambiguous source text

A pronoun with two possible referents, a missing subject, or a term with two meanings can change the whole sentence. Read the surrounding paragraph and the brief. If the ambiguity remains and affects the meaning, flag it with a specific question rather than choosing silently.

### Cultural references

A reference that is obvious to the source audience may mean nothing to the target audience. Decide according to the brief: preserve it with a short explanation, replace it with a local equivalent that carries the same function, or translate the plain meaning. Never replace it with a stereotype or an unrelated local reference.

### Register and politeness

Some languages require a formality choice that the source does not make explicit. Use the audience and the relationship in the brief. A customer-service reply to a new user is usually more formal than a message between colleagues.

### Names, brands, and legal terms

Keep official names unless the brief provides an approved translation. Use the established legal term in the target jurisdiction for contracts and policies; a literal translation can be legally meaningless.

### Incomplete or inconsistent source

If a sentence is cut off, do not invent the ending. Translate what is there and flag the gap. If the source uses two different terms for the same thing, check the glossary before “fixing” it; the difference may be intentional.

### Dates, measurements, and legal terms

Convert a date or a measurement only when the brief asks for localization. “5 miles” may need to stay 5 miles in a source-faithful contract, while a consumer listing may need kilometres. For legal text, use the established term in the target jurisdiction and keep defined terms consistent.

### Notes and explanations

Do not add explanatory notes by default; the translation should stand alone. If the brief allows notes, keep them short and separate from the translated text. A note is not a place to justify a guess.

### Machine translation post-editing

If you are editing machine output, treat the machine draft as a first pass, not an authority. Check meaning, negation, names, and terminology against the source, then rewrite for natural target-language flow.

### Confidential content

Translations often include personal or commercial information. Keep the file in the approved tool, do not paste it into a public machine-translation site, and do not share excerpts in a portfolio without permission.
`,
    ),
    lesson(
      'Practice: translate a short business message',
      7,
      `
### Source (English)

“Hi Amina, the deadline is tight, but we can still deliver on Friday. Please confirm the final numbers by noon.”

### A strong Swahili translation

“Habari Amina, muda ni mfupi, lakini tunaweza kuwasilisha Ijumaa. Tafadhali thibitisha namba za mwisho kabla ya saa sita mchana.”

Why it works:

- It keeps the name and the deadline.
- “Muda ni mfupi” carries the pressure without translating “tight” literally.
- “Tunaweza kuwasilisha” keeps the promise.
- “Tafadhali thibitisha” matches the polite request.
- “Kabla ya saa sita mchana” expresses noon in a natural local time reference; if the brief requires a 24-hour format, use 12:00 instead.

### A weak translation

“Habari Amina, tarehe ya mwisho ni nyembamba, lakini tunaweza bado kutoa siku ya Ijumaa. Tafadhali hakikisha namba za mwisho kwa mchana.”

It is understandable, but “tarehe ya mwisho ni nyembamba” is a literal calque, “tunaweza bado kutoa” has source word order, and the request is less natural. The reader has to work.

### Self-check

- Does the target keep every fact and every request?
- Does it sound like something a native speaker would write?
- Are names, numbers, and formatting unchanged?
- Did you use the glossary consistently?
`,
      {
        check: {
          question:
            'Which is the strongest reason to rewrite a grammatically correct target sentence?',
          options: [
            'It is shorter than the source',
            'It sounds like a word-for-word calque and a native reader would stumble',
            'It uses a term the translator personally dislikes',
            'It contains a name',
          ],
          correctIndex: 1,
          explanation:
            'Fluency is part of fidelity. A sentence that forces the reader to decode source-language structure is not finished.',
        },
      },
    ),
    lesson(
      'Submission checklist and the assessment',
      5,
      `
### Before you submit

- [ ] Every fact, number, name, and requirement is still present.
- [ ] Negation and scope have been checked.
- [ ] Glossary terms are used consistently.
- [ ] The target reads naturally aloud.
- [ ] Register and politeness match the audience.
- [ ] Headings, lists, placeholders, and links are intact.
- [ ] Ambiguities are flagged, not silently resolved.
- [ ] Confidential content stayed inside the approved tool.

### The assessment

Expect short translation scenarios: an idiom, an ambiguous pronoun, a glossary conflict, a register choice. Two-thirds correct is a pass. The explanations show how fidelity and fluency interact; read them even when you answer correctly.

### On the job

Translate a short passage first and read it aloud before expanding. Keep a personal glossary for recurring client terms, but always let the client's glossary win. A natural, faithful translation is the product.
`,
    ),
  ],
}
