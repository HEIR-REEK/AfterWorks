import type { Metadata } from 'next'
import { AuthForm } from '@/components/auth-form'

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to AfterWorks to view available microwork tasks, submit work, and manage your mobile money payouts.',
  alternates: {
    canonical: '/sign-in',
  },
}

export default function SignInPage() {
  return <AuthForm mode="sign-in" />
}
