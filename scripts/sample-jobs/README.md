# Sample job listings — 100 records, 25 per region

**Demo content.** The employers are fictional, the salaries are illustrative, and none of these
records is a verified vacancy. Every record carries `isSample: true` and any surface showing them
must carry `SAMPLE_JOBS_DISCLOSURE`.

## Files

| Path | What it is |
|---|---|
| `scripts/sample-jobs/types.ts` | The record shape |
| `scripts/sample-jobs/europe.ts` … `americas.ts` | The 25 listings for each region |
| `scripts/sample-jobs/index.ts` | The combined 100, plus the disclosure string |
| `scripts/sample-jobs/validate.ts` | The constraint checks (25/region, no repeated titles, local currency, spread, sample flag…) |
| `scripts/sample-jobs/export.ts` | Writes the four output files |
| `data/sample-job-listings/sample-jobs.json` | Array — seed Firestore, an API or any importer |
| `data/sample-job-listings/sample-jobs.sql` | MySQL `CREATE TABLE` + 100 `INSERT`s |
| `data/sample-job-listings/sample-jobs.js` | ES module for a plain JavaScript front end |
| `data/sample-job-listings/SAMPLE_JOB_LISTINGS.md` | The same 100 records, human-readable, grouped by region |

## Regenerate after editing

```bash
npm run sample:jobs
```

The exporter refuses to write anything if `validateSampleJobs()` finds a problem, so a typo cannot
half-publish a batch. `tests/sample-jobs.test.ts` asserts the committed exports match the source, so
CI fails if someone edits the data and forgets to regenerate.

## Fields

`referenceId, title, company, country, city, region, description, salary{amount, currency,
frequency}, salaryUsd, employmentType, workArrangement, experienceLevel, requiredSkills,
education, applicationDeadline, applicants, applicationRequirements, isSample`

`salaryUsd` is the employer's amount converted once at a fixed rate (documented in the markdown) so
the board can sort and filter in one currency without a live FX call. If your platform converts at
import time instead, ignore it and use `salary`.

## How this differs from the region boards

The platform's own regional catalogue (`lib/regional-jobs.ts`) is **micro-work**: task cards with
a training briefing and a 20-question assessment, which is what the assessment and application APIs
expect. These 100 listings are **employment marketplace** records — employers, salaries, experience
levels — and they are not wired into that flow.

Choose one of these before publishing them on the site:

1. **A separate listings surface** (recommended). A `/jobs/global` or employer-listing page backed by
   its own table/collection, showing the sample banner. No assessment, no training fee.
2. **Into the existing board** — only if each listing is given a category, an assessment and a
   training decision, because the board's apply flow refuses a card with no assessment. Importing
   them as-is would create cards that no member can apply for.

Nothing in this folder writes to Firestore on its own.
