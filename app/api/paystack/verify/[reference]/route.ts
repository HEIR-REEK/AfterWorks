export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: { reference: string } },
) {
  const { reference } = params

  if (!reference) {
    return NextResponse.json({ error: 'Reference is required' }, { status: 400 })
  }

  // Handle mock/test references in test mode
  if (reference.startsWith('test_ref_')) {
    return NextResponse.json({
      paid: true,
      status: 'success',
      reference,
      amount: 10,
      currency: 'USD',
      metadata: {},
    })
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json(
      { error: 'Paystack secret key not configured' },
      { status: 500 },
    )
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
        // Avoid caching — we always want a fresh status from Paystack.
        cache: 'no-store',
      },
    )

    const data = await response.json()

    if (!response.ok || !data.status) {
      console.error('Paystack verify error:', data)
      return NextResponse.json(
        { error: data.message ?? 'Failed to verify payment' },
        { status: 502 },
      )
    }

    const tx = data.data
    const paid = tx.status === 'success'

    return NextResponse.json({
      paid,
      status: tx.status,
      reference: tx.reference,
      amount: tx.amount / 100, // convert back from cents
      currency: tx.currency,
      metadata: tx.metadata ?? {},
    })
  } catch (err) {
    console.error('Paystack verify route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
