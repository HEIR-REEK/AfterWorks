/**
 * Structural checks for the 100 sample listings.
 *
 * Deliberately a plain function rather than a test-only helper: it is what a CI run asserts, and
 * what an operator can call before importing the batch. It checks the rules the dataset claims to
 * obey — 25 per region, no repeated title within a region, real country spread, a currency that
 * matches the country, and every required field present and non-empty.
 */

import { SAMPLE_JOBS, SAMPLE_JOBS_BY_REGION } from './index'
import type { SampleJob, SampleRegion } from './types'

export const REGION_TOTALS: Record<SampleRegion, number> = { Europe: 25, Africa: 25, Asia: 25, Americas: 25 }

/** Countries each board is meant to cover, from the brief. At least this many must appear. */
const MIN_COUNTRIES: Record<SampleRegion, number> = { Europe: 8, Africa: 8, Asia: 8, Americas: 7 }

/** The currency each country's listings must quote, given the brief's "local currencies" rule. */
const COUNTRY_CURRENCY: Record<string, string> = {
  Germany: 'EUR', France: 'EUR', Netherlands: 'EUR', Ireland: 'EUR', Spain: 'EUR', Italy: 'EUR', Belgium: 'EUR',
  'United Kingdom': 'GBP', Sweden: 'SEK', Poland: 'PLN', Switzerland: 'CHF',
  Kenya: 'KES', Nigeria: 'NGN', 'South Africa': 'ZAR', Ghana: 'GHS', Uganda: 'UGX', Tanzania: 'TZS',
  Rwanda: 'RWF', Egypt: 'EGP', Morocco: 'MAD', Ethiopia: 'ETB', Botswana: 'BWP',
  India: 'INR', Philippines: 'PHP', Singapore: 'SGD', Malaysia: 'MYR', Japan: 'JPY', Indonesia: 'IDR',
  Thailand: 'THB', 'South Korea': 'KRW', Vietnam: 'VND', Pakistan: 'PKR', Bangladesh: 'BDT',
  'United States': 'USD', Canada: 'CAD', Brazil: 'BRL', Mexico: 'MXN', Argentina: 'ARS',
  Colombia: 'COP', Chile: 'CLP', Peru: 'PEN', 'Costa Rica': 'CRC',
}

export function validateSampleJobs(jobs: SampleJob[] = SAMPLE_JOBS): string[] {
  const problems: string[] = []

  for (const region of Object.keys(REGION_TOTALS) as SampleRegion[]) {
    const mine = jobs.filter((job) => job.region === region)
    if (mine.length !== REGION_TOTALS[region]) {
      problems.push(`${region}: expected ${REGION_TOTALS[region]} listings, found ${mine.length}`)
    }
    const titles = new Set(mine.map((job) => job.title.toLowerCase()))
    if (titles.size !== mine.length) problems.push(`${region}: a job title is repeated`)

    const countries = new Set(mine.map((job) => job.country))
    if (countries.size < MIN_COUNTRIES[region]) {
      problems.push(`${region}: only ${countries.size} countries represented, want at least ${MIN_COUNTRIES[region]}`)
    }

    const levels = new Set(mine.map((job) => job.experienceLevel))
    for (const expected of ['Entry-level', 'Intermediate', 'Experienced'] as const) {
      if (!levels.has(expected)) problems.push(`${region}: no ${expected} opportunity`)
    }
    const arrangements = new Set(mine.map((job) => job.workArrangement))
    for (const expected of ['Remote', 'Hybrid', 'Onsite'] as const) {
      if (!arrangements.has(expected)) problems.push(`${region}: no ${expected} opportunity`)
    }
    const types = new Set(mine.map((job) => job.employmentType))
    for (const expected of ['Full-time', 'Part-time', 'Contract', 'Internship'] as const) {
      if (!types.has(expected)) problems.push(`${region}: no ${expected} opportunity`)
    }
  }

  const ids = new Set<string>()
  for (const job of jobs) {
    if (ids.has(job.referenceId)) problems.push(`${job.referenceId}: duplicate reference id`)
    ids.add(job.referenceId)

    if (job.isSample !== true) problems.push(`${job.referenceId}: not marked as a sample`)
    if (!job.referenceId.startsWith(`SAMPLE-${job.region.slice(0, 2).toUpperCase()}-`)) {
      problems.push(`${job.referenceId}: id does not match its region`)
    }
    for (const [field, value] of Object.entries({
      title: job.title, company: job.company, country: job.country, city: job.city,
      description: job.description, education: job.education, applicationDeadline: job.applicationDeadline,
    })) {
      if (typeof value !== 'string' || value.trim().length === 0) problems.push(`${job.referenceId}: ${field} is empty`)
    }
    const sentences = job.description.split(/[.!?]+\s/).filter(Boolean).length
    if (sentences < 2 || sentences > 4) problems.push(`${job.referenceId}: description is ${sentences} sentences, want 2–4`)
    if (job.requiredSkills.length < 3) problems.push(`${job.referenceId}: fewer than three skills`)
    if (job.applicationRequirements.length < 2) problems.push(`${job.referenceId}: fewer than two application requirements`)
    if (!Number.isFinite(job.applicants) || job.applicants < 1) problems.push(`${job.referenceId}: bad applicant count`)
    if (!Number.isFinite(job.salary.amount) || job.salary.amount <= 0) problems.push(`${job.referenceId}: bad salary`)
    if (!Number.isFinite(job.salaryUsd) || job.salaryUsd <= 0) problems.push(`${job.referenceId}: bad USD salary`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(job.applicationDeadline)) problems.push(`${job.referenceId}: deadline is not an ISO date`)

    const expectedCurrency = COUNTRY_CURRENCY[job.country]
    if (!expectedCurrency) problems.push(`${job.referenceId}: unknown country ${job.country}`)
    else if (job.salary.currency !== expectedCurrency) {
      problems.push(`${job.referenceId}: quotes ${job.salary.currency} for ${job.country}, want ${expectedCurrency}`)
    }
  }

  const counted = Object.values(SAMPLE_JOBS_BY_REGION).flat().length
  if (counted !== jobs.length) problems.push(`by-region grouping has ${counted} listings, dataset has ${jobs.length}`)

  return problems
}
