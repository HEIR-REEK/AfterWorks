/**
 * GET /api/jobs — job listings for the worker app.
 *
 * Reads the Firestore `jobs` collection (managed from the admin panel).
 * When the collection is empty or Firebase is not configured, falls back to
 * the bundled seed jobs so the site always works.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getAdminFirestore, firebaseAdminConfigured } from '@/lib/firestore-admin'
import { seedJobs, type Job, type JobCategory, type JobStatus } from '@/lib/afterworks-data'
import { COLLECTIONS } from '@/lib/admin-data'

function normaliseJob(id: string, d: Record<string, unknown>): Job {
  return {
    id,
    title: String(d.title ?? 'Untitled job'),
    category: (d.category as JobCategory) ?? 'Data Entry',
    description: String(d.description ?? ''),
    responsibilities: Array.isArray(d.responsibilities) ? (d.responsibilities as string[]) : [],
    payAmountUsd: Number(d.payAmountUsd ?? 0),
    estimatedMinutes: Number(d.estimatedMinutes ?? 60),
    capacity: Number(d.capacity ?? 0),
    slotsRemaining: Number(d.slotsRemaining ?? 0),
    trainingRequired: Boolean(d.trainingRequired),
    requiresVerified: d.requiresVerified !== false,
    status: (d.status as JobStatus) ?? 'open',
    closesAt: String(d.closesAt ?? new Date(Date.now() + 30 * 864e5).toISOString()),
    postedAgo: String(d.postedAgo ?? ''),
  }
}

export async function GET() {
  if (firebaseAdminConfigured()) {
    try {
      const db = getAdminFirestore()
      if (db) {
        const snap = await db.collection(COLLECTIONS.jobs).get()
        if (!snap.empty) {
          const jobs = snap.docs
            .map((doc) => normaliseJob(doc.id, doc.data() as Record<string, unknown>))
            .sort((a, b) => b.postedAgo.localeCompare(a.postedAgo))
          return NextResponse.json({ source: 'firestore', jobs })
        }
      }
    } catch (err) {
      console.warn('[Jobs] Firestore read failed, falling back to seed jobs:', err)
    }
  }

  return NextResponse.json({ source: 'seed', jobs: seedJobs() })
}
