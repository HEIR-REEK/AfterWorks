# AfterWorks Deployment Guide

Production deployment instructions for the AfterWorks backend.

## Pre-Deployment Checklist

### Security
- [ ] All API keys in environment variables (never in code)
- [ ] Firebase service account JSON file not in git repo
- [ ] Database credentials in secrets manager
- [ ] Paystack keys rotated and validated
- [ ] HTTPS/SSL certificate obtained
- [ ] CORS headers configured correctly
- [ ] API endpoint protection (rate limiting + auth)
- [ ] Admin endpoints secured with role-based access control
- [ ] Request/response logging enabled
- [ ] Error tracking configured (Sentry, DataDog)

### Database
- [ ] Production PostgreSQL database created
- [ ] Database backups automated
- [ ] Backup restoration tested
- [ ] Database encryption enabled
- [ ] Read replicas configured (if scaling)
- [ ] Connection pooling set up (PgBouncer or similar)

### Integrations
- [ ] Firebase active and tested
- [ ] Paystack live keys obtained
- [ ] Webhook URL configured in Paystack (HTTPS required)
- [ ] Digital KYC provider integrated (replace stub)
- [ ] SMS provider configured (replace OTP stub)
- [ ] Exchange rate API monitored

### Monitoring
- [ ] Error tracking dashboard live
- [ ] Application monitoring enabled (APM)
- [ ] Database query monitoring active
- [ ] Webhook delivery monitoring configured
- [ ] Alert rules defined (high error rate, downtime, etc.)
- [ ] Logging aggregation set up (ELK, CloudWatch, etc.)

### Testing
- [ ] Full integration test suite running
- [ ] Load testing completed (target: 1000 req/sec minimum)
- [ ] Security audit completed
- [ ] Penetration testing completed (optional but recommended)
- [ ] Clearing window job tested under load
- [ ] Paystack webhook retry loops tested
- [ ] Failover tested (database down, API down, etc.)

---

## Deployment Steps

### 1. Prepare Production Environment Variables

Create `.env` on production server:

```bash
# Database
DATABASE_URL="postgresql://user:password@prod-db.example.com:5432/afterworks"

# Firebase
FIREBASE_SERVICE_ACCOUNT_PATH="/app/serviceAccountKey.json"

# Paystack (LIVE keys)
PAYSTACK_SECRET_KEY=sk_live_xxxxx
PAYSTACK_PUBLIC_KEY=pk_live_xxxxx
PAYSTACK_TRAINING_AMOUNT=1000

# Server
PORT=4000
NODE_ENV=production

# Monitoring
SENTRY_DSN=https://key@sentry.io/project-id
LOG_LEVEL=info
```

**Important:** Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, Vercel Secrets, etc.) instead of `.env` files in production.

### 2. Upload Firebase Service Account

```bash
# Securely copy Firebase credentials to server
scp serviceAccountKey.json server:/app/serviceAccountKey.json
chmod 600 /app/serviceAccountKey.json
```

**Alternative:** Store JSON content in secrets manager, write at runtime:

```javascript
// src/services/firebase.js (modified for production)
const serviceAccountJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountJson)
});
```

### 3. Install Dependencies & Build

```bash
# SSH into production server
ssh user@your-production-server.com

# Clone repository
git clone <your-repo-url> /app/afterworks
cd /app/afterworks

# Install dependencies
npm install --production

# Generate Prisma client
npx prisma generate

# Note: Do NOT run prisma db push here yet (see next step)
```

### 4. Initialize/Migrate Database

**First-time deployment:**

```bash
npx prisma db push
```

**Subsequent deployments:**

```bash
# If schema changed
npx prisma migrate deploy
```

**To safely roll back (if needed):**

```bash
npx prisma migrate resolve --rolled-back <migration_name>
```

### 5. Enable HTTPS

**Option A: Using Let's Encrypt (Recommended)**

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate (replace domain.com)
sudo certbot certonly --standalone -d domain.com -d www.domain.com

# Configure Express to use certificate
# Update src/index.js:
const https = require('https');
const fs = require('fs');

const key = fs.readFileSync('/etc/letsencrypt/live/domain.com/privkey.pem');
const cert = fs.readFileSync('/etc/letsencrypt/live/domain.com/fullchain.pem');

https.createServer({ key, cert }, app).listen(443);
```

**Option B: Using Nginx as Reverse Proxy**

```nginx
# /etc/nginx/sites-available/afterworks
upstream afterworks {
    server localhost:4000;
}

server {
    listen 80;
    server_name domain.com www.domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name domain.com www.domain.com;

    ssl_certificate /etc/letsencrypt/live/domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/domain.com/privkey.pem;
    
    location / {
        proxy_pass http://afterworks;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Option C: Cloud Platform (Heroku, Railway, Render, AWS ECS)**

Most cloud platforms provide automatic HTTPS. Configure in platform dashboard.

### 6. Start Application Server

**Option A: Using PM2 (Recommended for VPS):**

```bash
npm install -g pm2

# Start server
pm2 start src/index.js --name affiliates

# Setup auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 logs affiliates
```

**Option B: Using systemd (For Linux servers):**

Create `/etc/systemd/system/afterworks.service`:

```ini
[Unit]
Description=AfterWorks Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/app/afterworks
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10

Environment="NODE_ENV=production"
Environment="PORT=4000"

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable afterworks
sudo systemctl start afterworks
sudo systemctl status afterworks
```

**Option C: Docker Container:**

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY prisma ./prisma

RUN npx prisma generate

CMD ["node", "src/index.js"]
```

Build & push:

```bash
docker build -t afterworks:latest .
docker run -p 4000:4000 -e DATABASE_URL=... afterworks:latest
```

### 7. Configure Webhooks

**Paystack Webhook URL:**

1. Go to Paystack Dashboard → Settings → API Keys & Webhooks
2. Set **Webhook URL:** `https://your-domain.com/training/webhook`
3. Make sure `x-paystack-signature` header is enabled (default)
4. Test webhook delivery (Paystack dashboard has test button)

### 8. Set Up Monitoring & Logging

**Option A: Sentry (Error Tracking)**

```bash
npm install @sentry/node @sentry/tracing
```

Add to `src/index.js`:

```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

**Option B: Winston Logging**

```bash
npm install winston
```

Create `src/logger.js`:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

module.exports = logger;
```

### 9. Database Backups

**Automated backup with AWS RDS:**
- Go to RDS Console → Automated Backups
- Set retention period: 30 days minimum
- Enable Multi-AZ for high availability

**Manual backup (PostgreSQL):**

```bash
# Full database backup
pg_dump -U user -h localhost afterworks > backup_$(date +%Y%m%d).sql

# Upload to S3
aws s3 cp backup_20240315.sql s3://your-backup-bucket/

# Download & restore if needed
psql -U user -h localhost afterworks < backup_20240315.sql
```

### 10. Configure Rate Limiting

Add to `src/index.js`:

```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

// Apply to all requests
app.use(limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 requests per 15 min
});

app.use('/auth/', authLimiter);
```

### 11. Monitor Background Jobs

**Verify clearing window job is running:**

```bash
# Check server logs
pm2 logs afterworks | grep "Clearing window"
```

**Verify stale app expiry job is running:**

```bash
pm2 logs afterworks | grep "Stale application"
```

**If jobs aren't running:**
1. Check server console output
2. Verify database connections
3. Verify timers haven't crashed

---

## Post-Deployment

### 1. Health Check

```bash
curl https://your-domain.com/health
# Expected: {"ok":true}
```

### 2. Test Critical Paths

```bash
# Test auth flow
curl -X GET https://your-domain.com/auth/me \
  -H "Authorization: Bearer <test_token>"

# Test job listing
curl -X GET https://your-domain.com/jobs \
  -H "Authorization: Bearer <test_token>"

# Test Paystack webhook
curl -X POST https://your-domain.com/training/webhook \
  -H "x-paystack-signature: <test_sig>" \
  -H "Content-Type: application/json" \
  -d '{"event":"charge.success","data":{"reference":"test"}}'
```

### 3. Monitor for Errors

Watch error logs in real-time:

```bash
pm2 logs afterworks --err
```

Monitor on Sentry dashboard for spikes.

### 4. Verify Database Backups

Test backup restoration on staging server:

```bash
pg_restore -U user -h staging-db.example.com -d afterworks_test backup.sql
```

### 5. Document Deployment

Record deployment info:
- Deployment date/time
- Git commit hash
- Database schema version
- Any breaking changes

---

## Scaling Guide

### Horizontal Scaling (Multiple Servers)

**Load Balancer Setup (Nginx):**

```nginx
upstream afterworks_backend {
    server backend1.example.com:4000;
    server backend2.example.com:4000;
    server backend3.example.com:4000;
}

server {
    listen 443 ssl http2;
    server_name api.afterworks.com;
    
    location / {
        proxy_pass http://afterworks_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Redis for Distributed Sessions

```bash
npm install redis
```

```javascript
// src/index.js
const redis = require('redis');
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: 6379,
});

// Store session data in Redis instead of in-memory
```

### Background Job Queue

For high-volume deployments, move background jobs to separate worker process:

```bash
npm install bull
```

Replace `setInterval()` background jobs with Bull queues:

```javascript
const Queue = require('bull');

const clearingQueue = new Queue('clearing-window', {
  redis: { host: process.env.REDIS_HOST }
});

clearingQueue.process(async () => {
  await processClearingWindow();
});

// Trigger every 60 min
const job = await clearingQueue.add({}, { repeat: { cron: '0 * * * *' } });
```

### Database Connection Pooling

```bash
npm install pg-pool
```

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // max concurrent connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

---

## Rollback Procedure

If deployment causes issues:

```bash
# Using Git
git revert <commit_hash>
git push origin main

# Restart server
pm2 restart afterworks

# OR restore from backup
# 1. Stop server
pm2 stop afterworks

# 2. Restore database
psql -U user afterworks < backup.sql

# 3. Restart
pm2 start afterworks
```

---

## Security Hardening (Post-Deployment)

### 1. Enable CORS Properly

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://app.afterworks.com',
  credentials: true,
}));
```

### 2. Add Security Headers

```bash
npm install helmet
```

```javascript
const helmet = require('helmet');
app.use(helmet());
```

### 3. Add Request Validation

```bash
npm install express-validator
```

```javascript
const { body, validationResult } = require('express-validator');

app.post('/auth/profile', [
  body('name').isLength({ min: 2 }).trim().escape(),
  body('dob').isISO8601(),
  body('phone').isMobilePhone(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  // ... proceed
});
```

### 4. Disable HTTP Strict Transport Security

```javascript
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

### 5. Restrict Admin Endpoints

Add authentication check to all `/admin/*` routes:

```javascript
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

app.use('/admin', requireAdmin);
```

---

## Disaster Recovery Plan

### 1. Database Failure

**Recovery:**
1. Restore from latest backup
2. Replay transaction logs (if available)
3. Manually verify critical data (users, jobs, payments)
4. Notify affected users

### 2. API Server Downtime

**Recovery:**
1. Check error logs (Sentry)
2. Restart server (`pm2 restart afterworks`)
3. If restart fails, restore from git backup
4. Verify webhooks during downtime can be re-processed

### 3. Payment Gateway Failure (Paystack)

**Workaround:**
1. Accept wallet-only training payments
2. Queue Paystack payments for batch retry
3. Email users with payment failure details
4. Auto-retry webhooks after 24h

### 4. Complete Service Failure

**Recovery:**
1. Restore database to secondary region
2. Deploy to backup infrastructure
3. Update DNS to point to backup
4. Notify users of incident
5. Post-incident review

---

## Monitoring Dashboard

Set up monitoring dashboard with:

1. **Server Health:** CPU, RAM, disk usage, network
2. **Application Health:** Request rate, error rate, response time
3. **Database Health:** Query performance, connection count, index usage
4. **Business Metrics:** Daily users, jobs posted, applications, payments processed
5. **Alerts:** Configured for error spikes, downtime, high latency

**Recommended Tools:**
- **Monitoring:** Datadog, New Relic, CloudWatch
- **Logging:** ELK Stack, Splunk, CloudWatch Logs
- **Error Tracking:** Sentry, Rollbar
- **Uptime Monitoring:** StatusPage, Pingdom, Better Uptime

---

## Support & Runbooks

Create runbooks for common operations:

1. **Deploy new feature:** [Steps to deploy + rollback]
2. **Handle payment failure:** [Steps to retry/refund]
3. **Ban malicious user:** [Steps + audit logging]
4. **Debug clearing window failure:** [Troubleshooting steps]
5. **Respond to security incident:** [Incident response plan]

Keep runbooks updated as system evolves.

---

Good luck with your production deployment! 🚀
