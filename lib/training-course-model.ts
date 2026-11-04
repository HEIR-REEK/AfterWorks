import type { TrainingKeyTerm, TrainingSection } from '@/lib/afterworks-data'

/**
 * A built-in training course. Every work category gets a complete coursebook rather than a handful
 * of paragraphs: a level, measurable objectives, a hero figure, a sequence of concept/scenario/lab
 * lessons grouped into units, and a glossary. The lesson body uses the small markup subset rendered
 * by `TrainingContent` in `training-modules.tsx`.
 */
export type TrainingCourse = {
  level: string
  summary: string
  objectives: string[]
  heroImage?: string
  heroAlt?: string
  heroCaption?: string
  modules: TrainingSection[]
  /** Reference terms shown after the final lesson. */
  glossary?: TrainingKeyTerm[]
}

export function lesson(
  title: string,
  durationMinutes: number,
  content: string,
  extra: Omit<Partial<TrainingSection>, 'title' | 'content' | 'durationMinutes'> = {},
): TrainingSection {
  return { title, durationMinutes, content: content.trim(), ...extra }
}
