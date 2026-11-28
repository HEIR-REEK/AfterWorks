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

## They are on the board now

`lib/card-from-listing.ts` converts each listing into a board card, and `lib/job-cards.ts` groups
them by board. They are **served, not stored**: `GET /api/jobs/board` returns them after the live
catalogue, the provider's sample fallback includes them, and a deep link to one resolves through
`findListingCard()`.

What that means in practice:

| | Value | Why |
|---|---|---|
| Category | Derived from the title | `categoryForListing()`; drives which built-in assessment bank is served |
| Pay | The advertised salary as an **hourly** USD figure | A monthly salary is divided by 160 hours, a weekly one by 40 (`PAY_BASIS`) |
| Duration | 60 minutes | The pay is hourly, so the task is an hour |
| Training | **Not required** | Demo content should be startable at once; the built-in bank is the assessment |
| Slots | 25 | A constant: no document means no slot counter |
| Close date | From the listing's deadline | `applicationDeadline` |

The assessment is the built-in bank for the category, and **applying works**: `createListingApplication()`
checks identity verification, the assessment pass, the deadline and duplicates, and prices the payout
from the member's verified region — the same guarantees a stored card gets.

If you later publish a listing into Firestore under the same `listing-…` id, the stored document wins
and the generated card is replaced rather than duplicated.

Nothing in this folder writes to Firestore on its own.
