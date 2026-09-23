import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth-form'

export const metadata: Metadata = {
  title: 'Create an Account',
  description: 'Join AfterWorks for free to access verified microwork opportunities — transcription, labeling, data entry, and fast mobile money payouts.',
  alternates: {
    canonical: '/sign-up',
  },
}

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />
}
