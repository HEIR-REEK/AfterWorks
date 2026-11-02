import {
  type Job,
  type JobCategory,
  safeImageSrc,
} from '@/lib/afterworks-data'
import type { TrainingCourse } from '@/lib/training-course-model'
import { TRANSCRIPTION } from '@/lib/training-courses/transcription'
import { DATA_ENTRY } from '@/lib/training-courses/data-entry'
import { IMAGE_LABELING } from '@/lib/training-courses/image-labeling'
import { CONTENT_REVIEW } from '@/lib/training-courses/content-review'
import { TRANSLATION } from '@/lib/training-courses/translation'
import { RESEARCH } from '@/lib/training-courses/research'
import { GENERIC } from '@/lib/training-courses/generic'

const COURSES: Record<JobCategory, TrainingCourse> = {
  Transcription: TRANSCRIPTION,
  'Data Entry': DATA_ENTRY,
  'Image Labeling': IMAGE_LABELING,
  'Content Review': CONTENT_REVIEW,
  Translation: TRANSLATION,
  Research: RESEARCH,
}

/** The full built-in course for a category. */
export function getBuiltInTrainingCourse(category: JobCategory): TrainingCourse {
  return COURSES[category] ?? GENERIC
}

/** Total estimated reading time across the lessons. */
export function trainingCourseMinutes(course: TrainingCourse): number {
  return course.modules.reduce((total, module) => total + (module.durationMinutes ?? 5), 0)
}

/**
 * The course a job page should render.
 *
 * A full authored course (five or more lessons) replaces the category course. A short set of
 * hand-written notes is treated as a job-specific briefing and *prepended* to the category course,
 * so a card never falls back to two paragraphs with no figures. Authored lessons get an estimated
 * duration and are sanitised through the same image allow-list as the reader.
 */
export function getJobTrainingCourse(job: Job): TrainingCourse {
  const authored = Array.isArray(job.trainingNotes) ? job.trainingNotes : []
  const builtIn = getBuiltInTrainingCourse(job.category)
  if (authored.length === 0) return builtIn

  const authoredModules = authored.map((section) => {
    const image = safeImageSrc(section.image)
    return {
      ...section,
      ...(image ? { image } : {}),
      durationMinutes:
        section.durationMinutes ??
        Math.max(3, Math.min(20, Math.ceil(section.content.trim().length / 900))),
    }
  })

  if (authoredModules.length >= 5) {
    return {
      level: `${job.category} · job-specific`,
      summary:
        job.description.trim() ||
        'A job-specific course written for this card. Read each lesson, then pass the assessment to apply.',
      objectives: authoredModules
        .slice(0, 4)
        .map((section) => `Work confidently through ${section.title || 'each section'}`),
      modules: authoredModules,
    }
  }

  return {
    ...builtIn,
    level: `${job.category} · job-specific brief`,
    summary:
      job.description.trim() ||
      builtIn.summary,
    objectives: [
      ...authoredModules.slice(0, 2).map((section) => `Apply the brief: ${section.title}`),
      ...builtIn.objectives,
    ].slice(0, 4),
    modules: [...authoredModules, ...builtIn.modules],
  }
}
