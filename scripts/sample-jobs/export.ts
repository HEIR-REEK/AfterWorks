/**
 * Write the dataset out in the formats an importing team actually needs.
 *
 *   npx tsx scripts/sample-jobs/export.ts
 *
 * Produces, in `data/sample-job-listings/`:
 *   • `sample-jobs.json`  — one array, ready to seed Firestore or any API;
 *   • `sample-jobs.sql`   — MySQL DDL + INSERTs;
 *   • `sample-jobs.js`    — an ES module for a plain JavaScript front end;
 *   • `SAMPLE_JOB_LISTINGS.md` — every record, human-readable, grouped by region.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SAMPLE_JOBS, SAMPLE_JOBS_BY_REGION, SAMPLE_JOBS_DISCLOSURE } from '@/lib/sample-jobs'
import { validateSampleJobs } from '@/lib/sample-jobs/validate'
import type { SampleJob, SampleRegion } from '@/lib/sample-jobs/types'

const OUT = resolve(process.cwd(), 'data/sample-job-listings')

function escapeSql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

function toSql(jobs: SampleJob[]): string {
  const rows = jobs
    .map(
      (job) =>
        `('${escapeSql(job.referenceId)}', '${escapeSql(job.title)}', '${escapeSql(job.company)}', '${escapeSql(job.country)}', '${escapeSql(job.city)}', '${job.region}', '${escapeSql(job.description)}', ${job.salary.amount}, '${job.salary.currency}', '${job.salary.frequency}', ${job.salaryUsd}, '${job.employmentType}', '${job.workArrangement}', '${job.experienceLevel}', '${escapeSql(job.requiredSkills.join(', '))}', '${escapeSql(job.education)}', '${job.applicationDeadline}', ${job.applicants}, '${escapeSql(job.applicationRequirements.join('; '))}', ${job.isSample ? 1 : 0})`,
    )
    .join(',\n')

  return `-- Sample job listings for the AfterWorks marketplace.
-- ${SAMPLE_JOBS_DISCLOSURE}
-- Generated from scripts/sample-jobs/*.ts — edit the source, not this file.

CREATE TABLE IF NOT EXISTS sample_job_listings (
  reference_id        VARCHAR(32)  NOT NULL PRIMARY KEY,
  title               VARCHAR(160) NOT NULL,
  company             VARCHAR(160) NOT NULL,
  country             VARCHAR(80)  NOT NULL,
  city                VARCHAR(80)  NOT NULL,
  region              ENUM('Europe','Africa','Asia','Americas') NOT NULL,
  description         TEXT         NOT NULL,
  salary_amount       DECIMAL(12,2) NOT NULL,
  salary_currency     CHAR(3)      NOT NULL,
  salary_frequency    ENUM('hourly','weekly','monthly') NOT NULL,
  salary_usd          DECIMAL(12,2) NOT NULL,
  employment_type     ENUM('Full-time','Part-time','Contract','Internship') NOT NULL,
  work_arrangement    ENUM('Remote','Hybrid','Onsite') NOT NULL,
  experience_level    ENUM('Entry-level','Intermediate','Experienced') NOT NULL,
  required_skills     VARCHAR(400) NOT NULL,
  education           VARCHAR(300) NOT NULL,
  application_deadline DATE        NOT NULL,
  applicants          INT UNSIGNED NOT NULL,
  application_requirements VARCHAR(600) NOT NULL,
  is_sample           TINYINT(1)   NOT NULL DEFAULT 1,
  INDEX idx_region (region),
  INDEX idx_country (country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sample_job_listings
  (reference_id, title, company, country, city, region, description, salary_amount, salary_currency,
   salary_frequency, salary_usd, employment_type, work_arrangement, experience_level, required_skills,
   education, application_deadline, applicants, application_requirements, is_sample)
VALUES
${rows};
`
}

function toMarkdown(): string {
  const parts: string[] = [
    '# 100 Sample Job Listings',
    '',
    `> **Demo content.** ${SAMPLE_JOBS_DISCLOSURE}`,
    '',
    '25 listings per region, generated as importable data. The machine-readable versions of this',
    'document are `sample-jobs.json`, `sample-jobs.sql` and `sample-jobs.js` in the same folder.',
    '',
    '## How the records were built',
    '',
    '| Rule | How it is met |',
    '|---|---|',
    '| 25 per region | Asserted by `validateSampleJobs()`; the build fails otherwise |',
    '| No repeated title within a region | Checked per region |',
    '| Several countries per region | Europe 11, Africa 11, Asia 11, Americas 9 |',
    '| Local currencies | Each listing quotes the currency of its own country (EUR for six eurozone states, GBP/SEK/PLN/CHF, KES/NGN/ZAR/GHS/…, INR/PHP/SGD/…, USD/CAD/BRL/MXN/…) |',
    '| Beginner and experienced roles | Every region has Entry-level, Intermediate and Experienced listings |',
    '| Remote, hybrid and onsite | Every region has all three arrangements |',
    '| Sample-marked | `isSample: true` on all 100, plus the disclosure above |',
    '| Illustrative pay | Rates are plausible for each market, not sourced vacancies |',
    '',
    '`salaryUsd` is the same amount converted once, at the rate noted in the column header below, so',
    'a board that prices in USD can sort and filter without a live FX call. Re-run the conversion at',
    'import time if your platform needs today\'s rate.',
    '',
    'Approximate rates used: EUR 1.082, GBP 1.256, CHF 1.122, SEK 0.0946, PLN 0.25,',
    'KES 0.0077, NGN 0.00064, ZAR 0.0546, GHS 0.0868, UGX 0.00027, TZS 0.000385, RWF 0.000723,',
    'EGP 0.02, MAD 0.1, ETB 0.0068, BWP 0.073, INR 0.012, PHP 0.0172, SGD 0.767, MYR 0.224,',
    'JPY 0.0067, IDR 0.000064, THB 0.0289, KRW 0.000707, VND 0.0000395, PKR 0.0036,',
    'BDT 0.0081, CAD 0.729, BRL 0.185, MXN 0.055, ARS 0.00085, COP 0.00026, CLP 0.00106,',
    'PEN 0.266, CRC 0.0019.',
    '',
  ]

  for (const region of Object.keys(SAMPLE_JOBS_BY_REGION) as SampleRegion[]) {
    parts.push(`## ${region.toUpperCase()} — 25 JOBS`, '')
    for (const [index, job] of SAMPLE_JOBS_BY_REGION[region].entries()) {
      parts.push(
        `### ${index + 1}. ${job.title}`,
        '',
        `| Field | Value |`,
        `|---|---|`,
        `| Reference ID | \`${job.referenceId}\` |`,
        `| Company (fictional) | ${job.company} |`,
        `| Location | ${job.city}, ${job.country} |`,
        `| Region | ${job.region} |`,
        `| Salary | ${job.salary.amount.toLocaleString('en-US')} ${job.salary.currency} ${job.salary.frequency} (≈ $${job.salaryUsd.toLocaleString('en-US')}) |`,
        `| Employment type | ${job.employmentType} |`,
        `| Work arrangement | ${job.workArrangement} |`,
        `| Experience level | ${job.experienceLevel} |`,
        `| Education | ${job.education} |`,
        `| Application deadline | ${job.applicationDeadline} |`,
        `| Applicants so far | ${job.applicants} |`,
        '',
        job.description,
        '',
        `**Required skills:** ${job.requiredSkills.join(' · ')}`,
        '',
        `**Application requirements:** ${job.applicationRequirements.map((line) => line).join(' · ')}`,
        '',
      )
    }
  }
  return parts.join('\n')
}

function main(): void {
  const problems = validateSampleJobs()
  if (problems.length > 0) {
    console.error(`Refusing to export: ${problems.length} problem(s).`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, 'sample-jobs.json'), JSON.stringify(SAMPLE_JOBS, null, 2) + '\n')
  writeFileSync(resolve(OUT, 'sample-jobs.sql'), toSql(SAMPLE_JOBS))
  writeFileSync(
    resolve(OUT, 'sample-jobs.js'),
    `// ${SAMPLE_JOBS_DISCLOSURE}\nexport const SAMPLE_JOBS = ${JSON.stringify(SAMPLE_JOBS, null, 2)}\nexport default SAMPLE_JOBS\n`,
  )
  writeFileSync(resolve(OUT, 'SAMPLE_JOB_LISTINGS.md'), toMarkdown())
  console.log(`Wrote 4 files to ${OUT} (${SAMPLE_JOBS.length} listings).`)
}

main()
