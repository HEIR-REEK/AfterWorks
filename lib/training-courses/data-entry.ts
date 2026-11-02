import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const DATA_ENTRY: TrainingCourse = {
  level: 'Beginner friendly · no prior experience',
  summary:
    'Move information from a source document into a structured row without changing it. Learn the field rules, the verification pass, and the difference between a blank and a guess.',
  objectives: [
    'Read a source document and map each field to the correct column.',
    'Apply date, number, and text rules consistently across a batch.',
    'Verify a finished row against the source before submitting.',
    'Handle illegible, missing, or contradictory information without inventing data.',
  ],
  heroImage: '/training/data-entry-overview.svg',
  heroAlt:
    'A source invoice on the left, a structured table in the middle, and a verification check on the right, with a note to copy exactly what is printed.',
  heroCaption: 'The source document is the authority. Your row is a faithful copy of it.',
  modules: [
    lesson(
      'What good data entry protects',
      6,
      `
### The job in one sentence

You take information that is trapped in a document — an invoice, a form, a receipt, a spreadsheet — and put it into the exact fields the client asked for, without improving it.

That sounds simple until the source is blurry, the columns are ambiguous, or a number looks wrong. The skill is not typing speed. It is knowing which value is the source of truth and what to do when the source does not cooperate.

### Why errors are expensive

A wrong digit in an account number can send a payment to the wrong place. A swapped date can make a delivery look late. A guessed phone number can create a customer record that nobody can reconcile. Most data-entry QA is not looking for beautiful formatting; it is looking for **traceability**: can this value be traced back to the source?

### The three rules

1. **Copy, do not correct.** If the source says 12/05/2026 and the field wants a date, convert the format — do not decide the date is probably May 12 when the document is ambiguous.
2. **Blank is a value.** If the source is blank, leave the field blank unless the brief gives a default. Never fill a gap with a guess.
3. **Flag, do not fix.** If two parts of the source disagree, record the value the brief tells you to use and note the discrepancy.

**A row that can be defended is better than a row that looks complete.**
`,
      {
        check: {
          question: 'The source document has a blank phone number. What should you enter?',
          options: [
            'A plausible number from the company website',
            '0000000000 as a placeholder',
            'Leave it blank and follow the brief’s exception process',
            'Delete the whole row',
          ],
          correctIndex: 2,
          explanation:
            'A blank is information. Filling it with a guess invents data, and deleting the row loses the rest of the record.',
        },
      },
    ),
    lesson(
      'The settle-in workflow: open, map, type, verify',
      8,
      `
### 1. Open the source properly

Use the highest-quality copy available. Zoom in. Check whether there are multiple pages, an attachment, or a second side. Read the brief before the first field: it tells you which document wins when there are several.

### 2. Map before you type

Find the column definitions and match them to the source. If the brief has a sample row, read it. Mark the fields that need transformation, such as dates, amounts, or names split into first and last.

Do not start typing until you know where each value belongs. Correcting a mapped column across 200 rows is much slower than checking the map once.

### 3. Type in a steady rhythm

Enter one row at a time and keep the source and the row visible together. Use copy-paste for long identifiers when the tool allows it, but check that you copied the whole value and no trailing spaces. Do not let autocomplete change a name, a code, or a unit.

### 4. Verify before you move on

Verification is a separate pass, not a glance. Compare the source and the row field by field, reading the source first. Check the digits in pairs: 48 50, not 4850. Check dates against the format rule. Check that every blank in the source is blank in the row.

For a batch, verify a sample after the first ten rows. If you find a systematic mapping error, fix the map before entering the rest.
`,
      {
        check: {
          question: 'Why should you map the columns before typing a large batch?',
          options: [
            'It makes the spreadsheet look better',
            'It prevents a repeated mapping error across every row',
            'It removes the need to verify later',
            'It lets you skip the brief',
          ],
          correctIndex: 1,
          explanation:
            'A mapping mistake repeated 200 times is 200 corrections. Mapping first catches the error while it is still cheap.',
        },
      },
    ),
    lesson(
      'Field rules: dates, amounts, names, and blanks',
      8,
      `
### Dates

Follow the required output format exactly. A source written 12/05/2026 may mean 12 May or 5 December depending on the document's origin; use the brief's convention and the surrounding evidence. Do not silently swap day and month. When the source is genuinely ambiguous, flag it instead of choosing.

### Amounts

Record digits in the format the brief asks for. Remove currency symbols and thousands separators only when the column definition says so. Do not round. Do not “fix” a total that disagrees with the line items: copy the printed total and note the discrepancy if the brief asks for a note.

### Names and addresses

Preserve spelling. Do not expand an initial, correct a diacritic, or standardize a company suffix unless the brief says to. Put each address line in the field it belongs to; do not merge a building name into a street line because it reads more naturally.

### Text fields

Copy the source wording. Remove accidental leading or trailing spaces. Keep internal punctuation. If the source uses a character your tool cannot store, use the approved transliteration rather than inventing a new spelling.

### Blanks and defaults

A blank cell is not an invitation to be helpful. Leave it blank unless the brief provides a default. If a required field is blank, mark the row for review using the approved status. Never use a placeholder that looks like real data, such as a fake phone number or a date of 1900-01-01.

### When the source contradicts itself

Use the brief's priority order: usually the printed total beats a calculated total, and the signed document beats a draft. Record the value you were told to use, and note what you saw. The note is part of the deliverable, not an apology.

### House style when the brief is silent

- Enter email addresses in lowercase; case is usually not meaningful, but consistency is.
- Use the phone format in the brief. Do not add a country code that is not in the source unless the brief asks for one.
- For multiple addresses, follow the brief's priority (for example, billing before shipping). Do not merge them.
- Extract only the requested data points. Promotional text, slogans, and discount codes are not part of the row unless the brief says so.
- A signature is not a printed name. Use the brief's [signature] or blank-field rule rather than guessing the signer.
- If the document is in a language you cannot read, flag it as unsupported instead of guessing from the numbers.
`,
      {
        image: '/training/data-entry-receipt.svg',
        imageAlt:
          'A receipt with line items, a printed total, and callouts explaining how to handle the total, the date format, and the amount field.',
        imageCaption:
          'The printed total wins even when the line items do not add up. Flag it; do not fix it.',
        check: {
          question:
            'The printed total is 4,850 but the line items add up to 4,250. What do you enter?',
          options: [
            '4,250, because the maths is wrong',
            '4,850, the printed total, and note the discrepancy if the brief asks',
            'The average of the two numbers',
            'Leave the total blank',
          ],
          correctIndex: 1,
          explanation:
            'The document is the authority. Correcting the source hides the discrepancy from the client; the note preserves it.',
        },
      },
    ),
    lesson(
      'Edge cases: illegible, missing, duplicated, and messy sources',
      8,
      `
### Illegible handwriting or a bad scan

Zoom in, adjust contrast, and compare against other fields on the same document. If a letter could be an l, 1, or I, do not pick the one that makes a nicer word. Use the brief's “cannot read” status or tag. Ask for a better copy when the task allows it.

### Missing pages or fields

Check the attachment list and the page numbers. If page 2 of 3 is missing, do not infer the missing rows from page 3. Report the gap and complete what you can see.

### Duplicate rows

A duplicate may be a genuine second transaction or a copy of the same one. Compare the date, amount, reference, and source page. If the brief has a duplicate rule, follow it; if not, flag it rather than deleting one silently.

### Multi-page and multi-document batches

Keep the source ID on every row. A row without a link back to its document is not traceable. When a batch has different document types, map each type separately instead of forcing everything into one template.

### Confidential information

Some documents contain ID numbers, bank details, or health information. Use only the approved storage location, never a personal cloud drive, and never paste the document into a public chat or AI tool. If you are unsure whether a field should be stored at all, ask before typing it.

### The uncomfortable rule

If you cannot complete a field faithfully, the correct output is an incomplete row with a clear status — not a complete row with a guess.
`,
    ),
    lesson(
      'Practice: turn a receipt into a row',
      7,
      `
### Your drill

Use this source:

- Date: 12/05/2026
- Client: A. Otieno
- Invoice: 0042
- Total: KES 4,850
- Notes: paid in full

The target columns are: date (YYYY-MM-DD), client_name, invoice_no, total_amount (digits only), status.

### A strong row

2026-05-12 | A. Otieno | 0042 | 4850 | paid

Notice the decisions:

- The date was converted to the required format, not rewritten with a different meaning.
- The client's initial was kept; it was not expanded to a guessed first name.
- The currency symbol and comma were removed because the column is digits-only.
- The note was mapped to the status field instead of being dumped into a generic notes column.

### A weak row

12/05/2026 | A. Otieno | Invoice 0042 | KES 4,850 | paid in full

It is readable, but it ignores the column rules. In a database, the date may sort incorrectly, the invoice number may fail to match, and the amount may not calculate.

### Self-check

- Does every value trace back to the source?
- Did you transform only the fields the brief asked you to transform?
- Is every blank still blank?
- Would a second person reading your row make the same decisions?
`,
      {
        check: {
          question: 'Which row follows a digits-only amount column?',
          options: ['KES 4,850', '4850', '4.850,00', 'Four thousand eight hundred fifty'],
          correctIndex: 1,
          explanation:
            'Digits-only means no currency symbol, no thousands separator, and no words. The value is preserved; the presentation changes.',
        },
      },
    ),
    lesson(
      'Submission checklist and the assessment',
      5,
      `
### Before you submit

- [ ] Every row links back to a source document or page.
- [ ] Dates, amounts, and identifiers follow the column rules.
- [ ] Every blank in the source is still blank, unless a briefed default applies.
- [ ] Names and addresses keep their original spelling.
- [ ] Discrepancies are noted, not silently corrected.
- [ ] Duplicates and unreadable fields have the approved status.
- [ ] A separate verification pass compared the source and the row.

### The assessment

Expect short scenarios, not trivia. You will be asked what to enter when a total disagrees with the line items, when a field is blank, when handwriting is ambiguous, and when a row should be flagged instead of completed. Two-thirds correct is a pass.

Read every explanation after you submit. The retake is there to build the judgement, not to punish a first attempt.

### On the job

Work in small batches and verify early. If you find one mapping error, assume there may be more and check the batch before entering the rest. Your reputation is built on rows that survive review.
`,
    ),
  ],
}
