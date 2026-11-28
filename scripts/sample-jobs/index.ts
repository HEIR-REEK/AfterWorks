/**
 * The 100 demo listings live in `lib/sample-jobs/` so the board can import them without reaching
 * into a script folder. Re-exported here so the export and validation entry points keep one address.
 */
export * from '@/lib/sample-jobs'
export { validateSampleJobs } from '@/lib/sample-jobs/validate'
