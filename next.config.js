/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Expose only the public key to the browser bundle.
    // The secret key (PAYSTACK_SECRET_KEY) must NEVER be prefixed NEXT_PUBLIC_
    // and is only used in server-side API routes.
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
  },
  experimental: {
    serverComponentsExternalPackages: ['firebase-admin'],
  },
}

module.exports = nextConfig
