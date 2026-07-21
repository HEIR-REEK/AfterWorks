import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) {
      return NextResponse.json(
        { error: 'Paystack secret key not configured' },
        { status: 500 },
      )
    }

    const signature = req.headers.get('x-paystack-signature')
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing x-paystack-signature header' },
        { status: 400 },
      )
    }

    const bodyText = await req.text()
    const hash = crypto
      .createHmac('sha512', secretKey)
      .update(bodyText)
      .digest('hex')

    if (hash !== signature) {
      return NextResponse.json(
        { error: 'Invalid Paystack signature' },
        { status: 401 },
      )
    }

    const event = JSON.parse(bodyText)

    if (event.event === 'charge.success') {
      const data = event.data
      console.log('Paystack Webhook: Charge succeeded for ref', data.reference)
      // Successfully processed charge event
    }

    return NextResponse.json({ status: true, message: 'Webhook received' }, { status: 200 })
  } catch (err) {
    console.error('Paystack webhook error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
