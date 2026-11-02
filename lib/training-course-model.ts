import type { TrainingSection } from '@/lib/afterworks-data'

/**
 * A built-in training course. Every work category gets a complete course rather than a handful of
 * paragraphs: a level, measurable objectives, a hero figure, and six short lessons. The lesson
 * body uses the small markup subset rendered by `TrainingContent` in `training-modules.tsx`.
 */
export type TrainingCourse = {
  level: string
  summary: string
  objectives: string[]
  heroImage?: string
  heroAlt?: string
  heroCaption?: string
  modules: TrainingSection[]
}

export function lesson(
  title: string,
  durationMinutes: number,
  content: string,
  extra: Omit<Partial<TrainingSection>, 'title' | 'content' | 'durationMinutes'> = {},
): TrainingSection {
  return { title, durationMinutes, content: content.trim(), ...extra }
}
