import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const RESEARCH: TrainingCourse = {
  level: 'Beginner friendly · no prior experience',
  summary:
    'Find a fact, verify it against a primary source, and record it so another person can follow your work. Learn source hierarchy, deep links, conflict resolution, and honest “cannot verify” outcomes.',
  objectives: [
    'Turn a research request into a focused query and a verification plan.',
    'Rank sources by authority and find the exact page that supports a fact.',
    'Record deep links, dates, and confidence notes another person can audit.',
    'Resolve conflicts and handle missing or outdated information without inventing data.',
  ],
  heroImage: '/training/research-overview.svg',
  heroAlt:
    'A search query flowing into primary, cross-check, and non-primary source cards, then into a record with the exact URL and date checked.',
  heroCaption:
    'A fact is usable when a second person can follow your URL and see the same thing.',
  modules: [
    lesson(
      'What verified research means',
      6,
      `
### The deliverable is not a fact

It is a fact plus the evidence that supports it. “The company has 40 employees” is a claim. “The company's About page, checked 12 May 2026, says 40 employees” is research. The difference is the trail.

### Three questions for every field

1. **What exactly is being asked?** A headquarters address, a registration number, a contact email, and a revenue figure are different facts with different sources.
2. **Who is allowed to answer it?** Prefer the organisation itself, a regulator, or a public registry. A directory can help you find the primary source; it is not the primary source.
3. **Can I show where I saw it?** Record the exact URL, the date, and the words on the page. A homepage is not a citation.

### What “cannot verify” is for

Some facts are not public, the site is down, or two official sources disagree. “Cannot verify” is a legitimate, useful result when it includes what you checked. It is not a failure, and it is much better than a confident guess.

**No source, no entry.**
`,
      {
        check: {
          question: 'Which result is the strongest research output?',
          options: [
            '“40 employees” with no source',
            '“About 40 employees, I think”',
            '“40 employees — company About page, exact URL, checked 12 May 2026”',
            '“40 employees — a blog post from 2019”',
          ],
          correctIndex: 2,
          explanation:
            'Research includes the fact, the exact source, and the date checked. A number without a trail cannot be audited.',
        },
      },
    ),
    lesson(
      'The research workflow: query, primary, cross-check, record',
      8,
      `
### 1. Sharpen the query

Use the organisation name plus the field: “Acme Kenya registered address”, “Acme Kenya privacy contact”, “Acme Kenya annual report 2025”. Add the site or registry name when you know it. Avoid broad queries that return directories and social posts first.

### 2. Open the primary source

Go to the organisation's own site, its contact or legal page, or the relevant public registry. Read the page, not the search snippet. The snippet can be stale or assembled from a different page.

### 3. Cross-check when the fact matters

A second independent source reduces the chance of a typo or an outdated page. Use a regulator, a public registry, or a reputable directory. If two sources disagree, the more authoritative and more recent source wins, and the conflict goes in your note.

### 4. Capture the evidence

Record the exact page URL, the date you checked it, the value you saw, and any caveat. Use the deep link, not the homepage. If the page is dynamic, note the navigation path.

### 5. Mark confidence honestly

- **Verified:** primary source, current, unambiguous.
- **Cross-checked:** primary plus a second source, or a reputable secondary source with no primary available.
- **Cannot verify:** no reliable source, or the sources conflict beyond resolution.

### 6. Stop at the brief

Do not keep researching a field after you have a verified answer. Do not add extra personal data because it was easy to find. The brief defines the scope.
`,
      {
        check: {
          question: 'What is the best URL to record for a fact found on a company’s website?',
          options: [
            'The homepage',
            'The search engine results page',
            'The exact page that shows the fact',
            'The company’s social media profile',
          ],
          correctIndex: 2,
          explanation:
            'A deep link lets a reviewer see the same fact without hunting. The homepage may change and does not support the specific claim.',
        },
      },
    ),
    lesson(
      'Source hierarchy and conflict resolution',
      8,
      `
### The hierarchy

1. **Official website or public registry.** The organisation's own legal, contact, or About page; a government company registry; a regulator's licence list.
2. **Regulator or authoritative public body.** A ministry, tax authority, or professional regulator.
3. **Reputable directory or established publication.** Useful for a cross-check, not as the only source for a legal fact.
4. **Blog, social post, screenshot, or user comment.** Not primary. Use only as a lead, never as the sole source for a factual field.

### When sources disagree

- Prefer the more authoritative source over the more recent one, unless the older one is clearly outdated.
- Prefer the specific page over a general page.
- Prefer the value that is dated and attributable.
- Record the conflict in the note: “Registry says 2019; company site updated 2025 says 2021. Used company site; registry appears stale.”
- If you cannot resolve it, mark “cannot verify” and explain what you checked.

### Dates and staleness

A page with no date is not automatically current. Check the footer, the last-updated line, and the surrounding content. A 2019 directory listing may be the only result, but it is not proof of a 2026 address.

### Domains and lookalikes

Check the domain carefully. A convincing “official” site can be a lookalike. Prefer the domain linked from a regulator or a known source. Do not enter personal data into a site you cannot verify.

### Common source decisions

- **Wikipedia** is a lead, not a primary source for a business fact. Follow its citations to the official page or registry.
- **Paid databases and paywalls** are not bypassed. Record the barrier and mark the field accordingly unless the brief provides approved access.
- **CEO and leadership** facts come from the official leadership or About page, not a random blog or an old article.
- **Multiple branches** use the headquarters or the specific branch the brief names, not the one closest to you.
- **Competitor pricing** is recorded exactly as shown on each named site; do not average or pick the lowest unless the brief says so.
`,
      {
        image: '/training/research-sources.svg',
        imageAlt:
          'A four-level source hierarchy: official website and registry, regulator, reputable directory, and blog or social post, with checks to perform before submitting.',
        imageCaption: 'When sources disagree, the official primary source is the tie-breaker.',
        check: {
          question:
            'A blog post from 2019 and the company’s current About page give different addresses. Which should you use?',
          options: [
            'The blog post, because it is more detailed',
            'The current official About page, with the conflict noted if relevant',
            'The average of the two addresses',
            'Neither; leave the field blank without a note',
          ],
          correctIndex: 1,
          explanation:
            'The official, current page outranks an old secondary post. Note the conflict so a reviewer understands the decision.',
        },
      },
    ),
    lesson(
      'Edge cases: dead links, duplicates, and private data',
      8,
      `
### The site is down

Try the organisation's other official pages, a cached copy if the brief allows it, and the relevant registry. Record what you checked and when. Do not replace the fact with a guess from a directory. If the source cannot be reached, “cannot verify” plus the attempted URLs is the right output.

### The same organisation appears twice

Check the registration number, address, and domain. A subsidiary, a franchise, and a similarly named company are not the same entity. Do not merge records because the names look alike.

### The fact is personal data

Collect only the field the brief asks for. Do not add a personal phone number, a home address, or a family member because it was visible. If the brief does not authorise the collection, do not collect it.

### The source is a PDF

Open the PDF and find the exact page. Record the page number and the PDF URL, not only the landing page. Check whether the PDF is current; a superseded annual report may still rank well.

### The source is a search snippet

Do not cite the snippet. Open the page and confirm the words are there. Search engines can assemble a snippet from multiple pages or show an outdated cache.

### The source asks for payment or login

Do not create an account, pay, or bypass a paywall. Record the barrier and mark the field accordingly. If the brief provides credentials, use only those and keep them inside the approved tool.
`,
    ),
    lesson(
      'Practice: verify a business address',
      7,
      `
### The request

Find the registered address and official contact email for “Hillside Supplies” in Nyeri, Kenya.

### A strong research note

- **Registered address:** [value from the official page or registry], source: exact URL, checked 2026-05-12.
- **Contact email:** [value from the official contact page], source: exact URL, checked 2026-05-12.
- **Cross-check:** regulator or registry listing agrees / disagrees, with the difference noted.
- **Confidence:** verified, cross-checked, or cannot verify.
- **Caveat:** “The directory listing is from 2021 and the company site was updated in 2026; used the company site.”

### A weak note

“Address: Nyeri. Email: info@hillsidesupplies.co.ke. Source: Google.”

The weak note has no exact page, no date, and no distinction between a search result and a source. A reviewer cannot reproduce it.

### Self-check

- Is the URL the exact page, not the homepage?
- Did you record the date you checked it?
- Did you cross-check a fact that matters?
- Did you note a conflict instead of hiding it?
- Did you collect only the fields the brief asked for?
`,
      {
        check: {
          question: 'What should a “cannot verify” entry include?',
          options: [
            'A blank field with no explanation',
            'A guess marked as likely',
            'The field, the sources you checked, and what was missing or conflicting',
            'A link to the first search result',
          ],
          correctIndex: 2,
          explanation:
            'An honest negative result is useful when it records the search. A blank or a guess leaves the next person with no trail.',
        },
      },
    ),
    lesson(
      'Submission checklist and the assessment',
      5,
      `
### Before you submit

- [ ] Every field has an exact source URL or a clear “cannot verify” note.
- [ ] The date checked is recorded.
- [ ] Primary sources were preferred over directories and social posts.
- [ ] Important facts were cross-checked.
- [ ] Conflicts and stale sources are noted.
- [ ] Only the requested personal data was collected.
- [ ] The value on the page matches the value in your record.
- [ ] The note can be followed by someone who has never seen the task.

### The assessment

Expect scenarios about source choice, deep links, conflicting pages, dead links, and personal data. Two-thirds correct is a pass. The explanations model the judgement a reviewer will expect on a real batch.

### On the job

Research a small set of fields first, then review the trail before scaling up. If you find one stale source or one broken link, check whether the same pattern affects the rest of the batch. A clean trail is the product.
`,
    ),
  ],
}
