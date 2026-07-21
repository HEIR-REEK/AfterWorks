export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, amount, metadata } = await req.json()
    const cleanEmail = email ? String(email).trim() : ''

    if (!cleanEmail || !amount) {
      return NextResponse.json(
        { error: 'A valid email and payment amount are required.' },
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

    // Convert amount in USD (e.g. $10) to smallest subunit (1000 cents)
    const amountInSmallestUnit =
      process.env.PAYSTACK_TRAINING_AMOUNT && Number(process.env.PAYSTACK_TRAINING_AMOUNT) >= 1000
        ? Number(process.env.PAYSTACK_TRAINING_AMOUNT)
        : Math.round(Number(amount) * 100)

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
        currency: 'USD',
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

    return NextResponse.json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    })
  } catch (err) {
    console.error('Paystack initialize route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
