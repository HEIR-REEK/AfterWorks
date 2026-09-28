import { NextRequest } from 'next/server'
import { json, requireUser, routeError } from '@/lib/guards'
import { dbOrNull } from '@/lib/firestore-admin'

const requiredFields = ['name', 'phone', 'location', 'bio', 'skills', 'languages'] as const
function completion(data: Record<string, unknown>) {
  const checks = requiredFields.map((key) => {
    const value = data[key]
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0
  })
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

/** Credit the one-time welcome reward only after the server confirms a fully filled profile. */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response
  try {
    const db = dbOrNull()
    if (!db) return json({ ok: false, error: 'Wallet service unavailable.' }, { status: 503 })
    const userRef = db.collection('users').doc(guard.value.uid)
    const ledgerRef = db.collection('wallet_ledger').doc(`signup_bonus_${guard.value.uid}`)
    const result = await db.runTransaction(async (tx) => {
      const [user, ledger] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)])
      if (!user.exists) return { granted: false, completion: 0 }
      const data = user.data() as Record<string, unknown>
      const percent = completion(data)
      if (percent < 100 || ledger.exists || data.signupBonusGranted === true) return { granted: false, completion: percent }
      const wallet = (data.wallet ?? {}) as Record<string, unknown>
      const availableUsd = Math.round(((Number(wallet.availableUsd) || 0) + 5) * 100) / 100
      tx.set(userRef, { wallet: { ...wallet, availableUsd }, signupBonusGranted: true }, { merge: true })
      tx.create(ledgerRef, { uid: guard.value.uid, kind: 'signup_bonus', status: 'cleared', amountUsd: 5, description: 'Complete profile welcome reward', createdAt: new Date().toISOString() })
      return { granted: true, completion: percent }
    })
    return json({ ok: true, ...result })
  } catch (err) {
    return routeError('wallet:welcome-bonus', err)
  }
}
