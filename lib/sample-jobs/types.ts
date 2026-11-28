/**
 * The shape of one sample job listing.
 *
 * These 100 listings are **demo content**: fictional employers, illustrative pay. They are written
 * to be converted — the dataset is plain JSON, so it maps to Firestore documents, MySQL rows or a
 * JavaScript array without further work. See `sample-jobs/README.md`.
 *
 * The currency fields are kept in the listing's own currency rather than being flattened to USD,
 * because an international marketplace that pays a Berlin role in USD and a Lagos role in NGN has
 * to show each in the currency the employer actually quoted.
 */

export type SampleRegion = 'Europe' | 'Africa' | 'Asia' | 'Americas'

export type PaymentFrequency = 'hourly' | 'weekly' | 'monthly'
export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract' | 'Internship'
export type WorkArrangement = 'Remote' | 'Hybrid' | 'Onsite'
export type ExperienceLevel = 'Entry-level' | 'Intermediate' | 'Experienced'

export type SampleJob = {
  /** Stable id, region-prefixed so two boards can never collide. */
  referenceId: string
  title: string
  company: string
  country: string
  city: string
  region: SampleRegion
  description: string
  salary: { amount: number; currency: string; frequency: PaymentFrequency }
  /** The same amount in USD, at the rate noted in the README. Illustrative, for board pricing. */
  salaryUsd: number
  employmentType: EmploymentType
  workArrangement: WorkArrangement
  experienceLevel: ExperienceLevel
  requiredSkills: string[]
  education: string
  applicationDeadline: string
  applicants: number
  applicationRequirements: string[]
  /** True on every record: these are fictional vacancies, never verified ones. */
  isSample: true
}
