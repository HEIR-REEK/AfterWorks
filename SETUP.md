# AfterWorks System Setup Guide

Complete step-by-step instructions for setting up the AfterWorks backend prototype.

## Prerequisites

Before you start, ensure you have installed:
- **Node.js** 16+ (18+ recommended): https://nodejs.org/
- **PostgreSQL** 12+ (or use SQLite for development): https://www.postgresql.org/
- **Git** (optional, for version control)
- **A text editor:** VS Code, WebStorm, or similar

## Step 1: Clone/Extract Project

```bash
# If using Git:
git clone <your-repo-url>
cd AfterWorks

# OR extract the project folder directly
```

## Step 2: Install Node.js Dependencies

```bash
npm install
```

**Expected output:** ~112 packages installed (some moderate vulnerabilities are expected for prototype; add security hardening before production).

## Step 3: Create Environment File (`.env`)

```bash
# Copy template
cp .env.example .env

# Edit .env with your configuration (see Step 5 for detailed setup)
```

## Step 4: Database Setup

Choose one:

### Option A: PostgreSQL (Production)

```bash
# Create database
createdb afterworks

# Update DATABASE_URL in .env
DATABASE_URL="postgresql://user:password@localhost:5432/afterworks"
```

### Option B: SQLite (Local Development) — No Installation Needed

```bash
# Update DATABASE_URL in .env
DATABASE_URL="file:./dev.db"
```

## Step 5: Configure Environment Variables (`.env`)

Edit the `.env` file with the following:

### 5.1 Database Connection (Already Selected in Step 4)

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/afterworks"  # PostgreSQL
# OR
DATABASE_URL="file:./dev.db"  # SQLite
```

### 5.2 Firebase Setup

**Step A: Create Firebase Project**
1. Go to https://console.firebase.google.com
2. Click **"Create a project"**
3. Name it **"AfterWorks"** (or your preferred name)
4. Wait for project to initialize

**Step B: Generate Service Account JSON**
1. In Firebase Console, go to **Project Settings** (⚙️ icon, top-right)
2. Click **"Service Accounts"** tab
3. Click **"Generate New Private Key"** (blue button)
4. A JSON file downloads automatically
5. Save it to your project root as `serviceAccountKey.json`
6. Update `.env`:

```dotenv
FIREBASE_SERVICE_ACCOUNT_PATH="./serviceAccountKey.json"
```

### 5.3 Paystack Setup

**Step A: Create Paystack Account**
1. Go to https://paystack.co
2. Sign up for free account
3. Verify email

**Step B: Get API Keys**
1. In Paystack Dashboard, go to **Settings** → **API Keys & Webhooks**
2. You should see **Test Keys** and **Live Keys**
3. Copy the secret key (starts with `sk_test_` for testing)
4. Update `.env`:

```dotenv
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
```

**Step C: Configure Webhook (Optional for Testing)**
1. In Paystack Dashboard → **API Keys & Webhooks** tab
2. **Webhook URL:** Set to `https://your-domain.com/training/webhook`
   - For local testing, skip this (use ngrok to expose localhost, or test manually)
3. Paystack will auto-add `x-paystack-signature` header to all webhook calls

### 5.4 Server Configuration

```dotenv
PORT=4000                  # Express server port
NODE_ENV=development       # development | production
```

### 5.5 Complete `.env` Example

```dotenv
# Database (choose one)
DATABASE_URL="file:./dev.db"

# Firebase
FIREBASE_SERVICE_ACCOUNT_PATH="./serviceAccountKey.json"

# Paystack (test keys)
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxx
PAYSTACK_TRAINING_AMOUNT=1000
PAYSTACK_BASE_URL=https://api.paystack.co

# Server
PORT=4000
NODE_ENV=development
```

## Step 6: Initialize Database Schema

```bash
# Generate Prisma Client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) Launch Prisma Studio for visual DB browser
npx prisma studio
```

## Step 7: Start Development Server

```bash
npm run dev
```

**Expected output:**
```
> npm run dev

> afterworks@1.0.0 dev
> node src/index.js

Server running on http://localhost:4000
AfterWorks prototype listening on 4000
```

## Step 8: Health Check

Verify server is running:

```bash
curl http://localhost:4000/health
```

**Expected response:**
```json
{"ok":true}
```

---

## Testing the System

### Test 1: Authentication

```bash
# You need a Firebase ID token to test. Use Firebase SDK on your frontend first.
# For testing purposes, you can generate tokens using:
# https://firebase.google.com/docs/auth/admin/custom-claims

# Example API call with token:
curl -X GET http://localhost:4000/auth/me \
  -H "Authorization: Bearer <YOUR_FIREBASE_ID_TOKEN>"
```

### Test 2: Create Job (Admin)

```bash
curl -X POST http://localhost:4000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Data Entry Task",
    "description": "Enter CSV data into spreadsheet",
    "amount": 5000,
    "currency": "USD",
    "capacity": 10,
    "trainingRequired": false,
    "expiresAt": "2025-12-31T23:59:59Z"
  }'
```

### Test 3: List Jobs

```bash
curl -X GET http://localhost:4000/jobs \
  -H "Authorization: Bearer <YOUR_FIREBASE_ID_TOKEN>"
```

---

## Troubleshooting

### "Cannot find module 'firebase-admin'"

**Solution:**
```bash
npm install
# If still failing, clear node_modules:
rm -rf node_modules
npm install
```

### "DATABASE_URL is not set"

**Solution:**
1. Ensure `.env` file exists in project root
2. Ensure `DATABASE_URL` is set
3. Save `.env` file (Ctrl+S)
4. Restart server

### "Cannot connect to PostgreSQL"

**Solution:**
1. Verify PostgreSQL is running: `psql --version`
2. Create database: `createdb afterworks`
3. Check connection string in `.env`
4. Test connection: `psql "postgresql://user:password@localhost:5432/afterworks"`

### "Prisma client not generated"

**Solution:**
```bash
npx prisma generate
npx prisma db push
```

### Firebase Auth Token Errors

**Solution:**
1. Ensure `serviceAccountKey.json` exists in project root
2. Verify `FIREBASE_SERVICE_ACCOUNT_PATH` is correct in `.env`
3. Check Firebase project is active (no billing issues)
4. Test token generation on frontend with Firebase SDK

### Paystack Webhook Signature Errors

**Solution:**
1. Verify `PAYSTACK_SECRET_KEY` matches your Paystack account
2. Ensure webhook uses `x-paystack-signature` header
3. Test webhook signature generation:

```bash
# Example signature generation for testing
PAYLOAD='{"event":"charge.success",...}'
SECRET="sk_test_xxxxx"
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha512 -hmac "$SECRET" -hex | cut -d' ' -f2)
echo $SIG
```

---

## Next Steps After Setup

1. **Build Frontend:**
   - Create React/Vue.js app
   - Integrate Firebase SDK for user authentication
   - Build job browsing + application flow UI
   - Build wallet UI with withdraw functionality

2. **Deploy Backend:**
   - Push code to hosting (Heroku, Railway, Render, AWS)
   - Configure production database (PostgreSQL on AWS RDS, Cloud SQL, etc.)
   - Set up HTTPS (required for Firebase + Paystack)
   - Configure Paystack webhook URL to production domain

3. **Integrate Real Services:**
   - Replace Digital KYC stub with real provider (BioID, Vouched, Jumio)
   - Replace OTP stub with SMS provider (Twilio, AWS SNS, etc.)
   - Set up error tracking (Sentry, DataDog)
   - Add request logging (Winston, Pino)

4. **Security Hardening:**
   - Add rate limiting (`express-rate-limit`)
   - Add input validation (`express-validator`)
   - Enable CORS properly
   - Add request signing
   - Set up HTTPS + SSL certificates
   - Store secrets in environment manager (AWS Secrets, HashiCorp Vault)

5. **Testing & QA:**
   - Write integration tests (Jest, Mocha)
   - Load testing (k6, Apache JMeter)
   - Security audit (OWASP Top 10)
   - Penetration testing

6. **Admin Dashboard:**
   - Build React admin UI for manual approvals
   - KYC approval/rejection
   - Payment holds/releases
   - User suspension/banning
   - Job management
   - Audit log viewer

---

## File Structure

```
AfterWorks/
├── src/
│   ├── services/          # Business logic (Firebase, Paystack, KYC, etc.)
│   │   ├── firebase.js
│   │   ├── paystack.js
│   │   ├── digitKyc.js
│   │   ├── fingerprint.js
│   │   ├── currency.js
│   │   └── clearing.js
│   ├── routes/            # Express route handlers
│   │   ├── auth.js
│   │   ├── jobs.js
│   │   ├── applications.js
│   │   ├── training.js
│   │   ├── training-admin.js
│   │   ├── wallet.js
│   │   ├── withdrawals-admin.js
│   │   ├── referrals.js
│   │   ├── qa.js
│   │   └── admin.js
│   └── index.js           # Express server setup + route mounting
├── prisma/
│   ├── schema.prisma      # Database schema (15 models)
│   └── migrations/        # Database migrations
├── node_modules/          # Dependencies (created by npm install)
├── .env                   # Environment variables (create from .env.example)
├── .env.example           # Environment template
├── package.json           # Project metadata + dependencies
├── package-lock.json      # Locked dependency versions
├── README.md              # Project overview + API reference
├── SETUP.md               # This file
└── serviceAccountKey.json # Firebase credentials (download from Firebase Console)
```

---

## Support & Resources

- **Firebase Docs:** https://firebase.google.com/docs/admin/setup
- **Paystack Docs:** https://paystack.com/docs/api/
- **Prisma Docs:** https://www.prisma.io/docs/
- **Express Docs:** https://expressjs.com/
- **Node.js Best Practices:** https://nodejs.org/en/docs/guides/

---

## Production Deployment Checklist

- [ ] Set all environment variables securely (use secrets manager)
- [ ] Enable HTTPS with SSL certificate
- [ ] Configure PostgreSQL production database (with backups)
- [ ] Set up error tracking (Sentry, Rollbar, DataDog)
- [ ] Enable structured logging (Winston, Pino, CloudWatch)
- [ ] Add rate limiting middleware
- [ ] Add input validation
- [ ] Test Paystack webhooks thoroughly
- [ ] Test clearing window background jobs under load
- [ ] Set up monitoring & alerting
- [ ] Configure CORS headers properly
- [ ] Add request/response compression
- [ ] Set up database backups + restore testing
- [ ] Add CI/CD pipeline (GitHub Actions, GitLab CI)
- [ ] Perform security audit (OWASP)
- [ ] Load test with realistic traffic
- [ ] Document API for team & partners
- [ ] Plan disaster recovery procedures

Happy coding! 🚀
