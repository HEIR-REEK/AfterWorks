/**
 * 100 sample job listings — 25 per region — as one importable dataset.
 *
 * Everything here is **demo content**: the employers are fictional, the salaries are illustrative
 * and every record carries `isSample: true`. Nothing in this file is a verified vacancy, and no
 * surface should present it as one. See `scripts/sample-jobs/README.md` for how to convert it.
 */

import type { SampleJob, SampleRegion } from './types'
import { EUROPE_JOBS } from './europe'
import { AFRICA_JOBS } from './africa'
import { ASIA_JOBS } from './asia'
import { AMERICAS_JOBS } from './americas'

export type { SampleJob, SampleRegion } from './types'

export const SAMPLE_JOBS_BY_REGION: Record<SampleRegion, SampleJob[]> = {
  Europe: EUROPE_JOBS,
  Africa: AFRICA_JOBS,
  Asia: ASIA_JOBS,
  Americas: AMERICAS_JOBS,
}

/** All 100, in region order. */
export const SAMPLE_JOBS: SampleJob[] = [
  ...EUROPE_JOBS,
  ...AFRICA_JOBS,
  ...ASIA_JOBS,
  ...AMERICAS_JOBS,
]

/** The demo banner every surface showing these records must carry. */
export const SAMPLE_JOBS_DISCLOSURE =
  'Sample listings: employers are fictional, salaries are illustrative and these are not verified vacancies.'
