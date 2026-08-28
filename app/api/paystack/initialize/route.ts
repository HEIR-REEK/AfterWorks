export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPaystackAmountSubunits } from '@/lib/afterworks-data'
import { recordPaymentTransactionAdmin } from '@/lib/firestore-admin'

export async function POST(req: NextRequest) {
  try {
    const { email, amount, metadata } = await req.json()
    const cleanEmail = email ? String(email).trim() : ''

    if (!cleanEmail) {
      return NextResponse.json(
        { error: 'A valid email is required.' },
        { status: 400 },
      )
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) {
      return NextResponse.json(
        { error: 'Paystack secret key not configured' },
        { status: 500 },
      )
    }

    // Convert amount in KES subunits (cents) for Paystack Mobile Money/Card/Transfer in KES
    const amountInSmallestUnit = amount && Number(amount) > 0
      ? Math.round(Number(amount) * 100)
      : getPaystackAmountSubunits()

    const callbackUrl = `${req.nextUrl.origin}/training/${metadata?.jobId ?? ''}`

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: cleanEmail,
        amount: amountInSmallestUnit,
        currency: 'KES',
        metadata: metadata ?? {},
        callback_url: callbackUrl,
      }),
    })

    const data = await response.json()

    if (!response.ok || !data.status) {
      console.error('Paystack initialize error:', data)
      return NextResponse.json(
        { error: data.message ?? 'Failed to initialize Paystack payment.' },
        { status: response.status || 502 },
      )
    }

    const reference = data.data.reference
    const amountKes = amountInSmallestUnit / 100

    // Log payment transaction in Firestore for real-time admin monitoring
    try {
      await recordPaymentTransactionAdmin({
        reference,
        email: cleanEmail,
        userId: metadata?.userId || metadata?.uid || '',
        amountKes,
        amountUsd: Math.round(amountKes / 130) || 10,
        currency: 'KES',
        status: 'pending',
        jobId: metadata?.jobId || '',
        metadata: metadata ?? {},
      })
    } catch (logErr) {
      console.warn('[PaystackInitialize] Failed to log transaction:', logErr)
    }

    return NextResponse.json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference,
    })
  } catch (err) {
    console.error('Paystack initialize route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
