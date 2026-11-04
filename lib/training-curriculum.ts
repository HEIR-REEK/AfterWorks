import {
  type Job,
  type JobCategory,
  type TrainingLessonKind,
  safeImageSrc,
} from '@/lib/afterworks-data'
import type { TrainingCourse } from '@/lib/training-course-model'
import { ADVANCED_MODULES, COURSE_GLOSSARY } from '@/lib/training-courses/advanced'
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

/**
 * The unit plan shared by every built-in course. The first five entries describe the original
 * craft lessons; the next six are the advanced modules; the final entry is the submission
 * checklist. A lesson can override its own unit, kind and objective — the advanced lessons do.
 */
const UNIT_PLAN: { unit: string; kind: TrainingLessonKind }[] = [
  { unit: 'Unit 1 · Foundations', kind: 'concept' },
  { unit: 'Unit 1 · Foundations', kind: 'concept' },
  { unit: 'Unit 2 · Method & standards', kind: 'concept' },
  { unit: 'Unit 2 · Method & standards', kind: 'scenario' },
  { unit: 'Unit 3 · Guided practice', kind: 'lab' },
  { unit: 'Unit 4 · Professional setup', kind: 'concept' },
  { unit: 'Unit 4 · Professional setup', kind: 'concept' },
  { unit: 'Unit 5 · Safe & quality practice', kind: 'scenario' },
  { unit: 'Unit 5 · Safe & quality practice', kind: 'concept' },
  { unit: 'Unit 6 · Capstone lab', kind: 'lab' },
  { unit: 'Unit 6 · Capstone lab', kind: 'checkpoint' },
  { unit: 'Unit 7 · Assessment readiness', kind: 'checkpoint' },
]

/**
 * Compose the original coursebook with its advanced half.
 *
 * The final submission checklist stays last; the six advanced modules are inserted before it,
 * which means a learner always ends with the handoff checklist and then the assessment. Units and
 * lesson types are filled in after composition so the original lessons do not need to repeat the
 * same metadata.
 */
function composeCourse(category: JobCategory, base: TrainingCourse): TrainingCourse {
  const last = base.modules[base.modules.length - 1]
  const modules = [
    ...base.modules.slice(0, -1),
    ...(ADVANCED_MODULES[category] ?? []),
    ...(last ? [last] : []),
  ].map((section, index) => ({
    ...section,
    unit: section.unit ?? UNIT_PLAN[index]?.unit ?? 'Unit 7 · Assessment readiness',
    kind: section.kind ?? UNIT_PLAN[index]?.kind ?? 'concept',
  }))

  return {
    ...base,
    modules,
    glossary: base.glossary ?? COURSE_GLOSSARY[category],
  }
}

/** The full built-in course for a category. */
export function getBuiltInTrainingCourse(category: JobCategory): TrainingCourse {
  const base = COURSES[category] ?? GENERIC
  return composeCourse(category, base)
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
  // An assessment-only card has no training, so it has no course — not even the category one. The
  // built-in coursebook is what a *training* card falls back to when the admin wrote no sections,
  // which is what makes "training card" mean "has modules" rather than "the admin wrote some".
  if (job.trainingRequired !== true) {
    return { level: '', summary: '', objectives: [], modules: [] }
  }

  const authored = Array.isArray(job.trainingNotes) ? job.trainingNotes : []
  const builtIn = getBuiltInTrainingCourse(job.category)
  if (authored.length === 0) return builtIn

  const authoredModules = authored.map((section, index) => {
    const image = safeImageSrc(section.image)
    return {
      ...section,
      unit: section.unit ?? (authored.length >= 5 ? `Unit ${Math.floor(index / 3) + 1} · Job-specific course` : 'Job-specific brief'),
      kind: section.kind ?? 'concept',
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
      glossary: builtIn.glossary,
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
