# IronPulse — Gym Management SaaS (India)

IronPulse is a responsive, multi-gym workspace for Indian gym owners. Each owner registers a gym and gets a separate workspace for members, memberships, payments, attendance, trials, trainers, equipment, classes and operating expenses.

**This is a deployable development build, not a production-certified service.** Real WhatsApp delivery and online payments need each gym's own provider credentials and approved templates. The application code includes those provider adapters, payment verification and scheduled reminders, but credentials cannot be supplied by the project itself.

## Main features

- **Gym owner accounts:** gym workspace registration, owner login, update gym name/email/mobile, change password and logout.
- **Member directory:** member code, contact information, membership plan, start/end dates, total paid, pending amount, freeze/activate, renew/assign plan, payment history and attendance history. Record and update explicit WhatsApp consent for each member.
- **Payment history:** view a member's payment history, record cash/UPI/card/bank-transfer receipts and track pending/paid invoices.
- **Attendance:** front-desk check-in by member code/phone/email, check-out, daily attendance list and member-specific attendance history.
- **Member QR check-in:** the owner displays a gym-specific QR. The member scans it, enters their registered mobile number, verifies a one-time code and gets attendance marked. In local development only, the OTP is returned on-screen; production requires WhatsApp Cloud API configuration.
- **Membership reminders:** the scheduler checks expiry dates and sends the configured WhatsApp template the selected number of days before expiry (default: one day). If Razorpay is connected and online payments are enabled, it creates a payment link and includes it in the message.
- **Trial visitors:** register a visitor, select an interested plan, set a trial duration and record/update explicit WhatsApp consent. After the trial expires, the scheduler sends a follow-up template. If a plan and Razorpay are configured, it includes a payment link. A verified successful payment webhook converts the trial visitor into a member and starts the selected membership.
- **Online payment links:** Razorpay Payment Links API, server-side credentials, webhook HMAC verification and payment reconciliation. UPI/card methods and promotional offers depend on the methods/offers enabled in the gym's Razorpay merchant account.
- **Finance:** record rent, electricity, trainer salaries, equipment, maintenance, cleaning, marketing and miscellaneous expenses. Dashboard shows monthly revenue, expenses and net after expenses.
- **Optional modules:** owner can enable/disable modules from Settings. The API checks module flags; disabling a module hides the navigation and blocks its tenant API.
- **Backup/reset:** owner-only JSON backup download (password hashes and provider secrets are excluded) and a confirmation-phrase reset of operational data. Import/restore is not implemented in this build.
- **Provider credentials:** WhatsApp and Razorpay secrets are encrypted using AES-256-GCM before storage. Keep `ENCRYPTION_KEY` stable; changing it makes previously stored provider credentials undecryptable.

## Technology

- Frontend: React 18, Vite, React Router, Tailwind CSS, Lucide icons, `qrcode.react`.
- Backend: Node.js 20+, Express, PostgreSQL, Zod validation, bcrypt password hashing, JWT, Helmet and CORS.
- Payment provider: Razorpay Payment Links API and signed webhooks.
- Messaging: Meta WhatsApp Business Cloud API templates.

## Run locally

Requirements: Node.js 20+, npm and PostgreSQL 14+.

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env`. Set a database password, a random `JWT_SECRET` (32+ characters) and a separate random `ENCRYPTION_KEY` (32+ characters).
3. Install dependencies:

   ```bash
   npm run install:all
   ```

4. Apply migrations:

   ```bash
   npm run db:migrate
   ```

5. Start the API and frontend in separate terminals:

   ```bash
   npm run dev:backend
   npm run dev:frontend
   ```

6. Open `http://localhost:5173`, create a gym account and sign in.

The old single-gym demo seed accounts have been disabled. Register a new owner account instead.

## Run with Docker Compose

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD`, `JWT_SECRET` and `ENCRYPTION_KEY` with strong random values. The application refuses placeholder secrets in production mode.
3. Start the stack:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost:3000` and create a gym account.

The frontend uses same-origin `/api` routing through Vite in development and Nginx in Docker, so gym tablets and members scanning the QR use the same host URL rather than a hard-coded `localhost` API address. Set `VITE_API_URL` only if your backend is hosted on a separate origin.

The consolidated `database/schema.sql` initializes a **new empty** Docker database volume. If you already have an older PostgreSQL volume, back it up and run the migrations deliberately; Docker initialization scripts do not run again on an existing volume. Do not use `docker compose down -v` unless you intend to permanently delete the database volume.

## WhatsApp Business setup

Each gym owner must have a Meta WhatsApp Business Cloud API sender and a long-lived access token. In IronPulse Settings, configure:

- Phone Number ID
- Access token
- Graph API version and template language
- Approved template names for renewal, trial follow-up, OTP and payment-link messages

Template body placeholders must match the order of the values sent by the application:

| Template | Body variables |
|---|---|
| Membership renewal | `{{1}}` member name, `{{2}}` plan name, `{{3}}` expiry date, `{{4}}` payment link or instruction |
| Trial follow-up | `{{1}}` visitor name, `{{2}}` gym name, `{{3}}` interested plan, `{{4}}` payment link or instruction |
| OTP | `{{1}}` six-digit code |
| Payment link | `{{1}}` member name, `{{2}}` payment URL, `{{3}}` amount |

Create and get the templates approved in Meta before enabling the WhatsApp module. Meta's current message pricing, template rules, opt-in requirements and quality limits apply. Renewal and trial automation only messages records with WhatsApp consent enabled. Members and trial visitors can be opted out in their management screens. The QR check-in OTP is sent in response to the member actively requesting a code.

## Razorpay setup

Each gym must connect its own Razorpay merchant account in Settings. Enter the Key ID, Key Secret and webhook signing secret. Enable the online-payments module after saving the credentials.

Configure a webhook for:

```text
POST https://YOUR_DOMAIN/api/saas/payments/razorpay-webhook?gym=YOUR_GYM_UUID
```

Subscribe to `payment_link.paid`. Use the exact webhook secret stored in Settings. The server verifies `X-Razorpay-Signature` against the raw request body before marking a payment paid. Trial payments are reconciled into a member and membership only after the verified payment webhook.

Gateway processing fees, settlement timing, supported UPI/card methods and card/UPI offers are controlled by Razorpay and the merchant account. There is no production payment gateway that can be promised as universally free.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret; 32+ random characters |
| `ENCRYPTION_KEY` | Separate 32+ character secret for encrypted integration credentials |
| `JWT_EXPIRES_IN` | Session duration, default `7d` |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma-separated |
| `DB_TIMEZONE` | Database session timezone; defaults to `Asia/Kolkata` |
| `VITE_API_URL` | Frontend API base URL |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Docker PostgreSQL configuration |

Never commit `.env` files, access tokens, Razorpay secrets or webhook secrets.

## API overview

All application endpoints are under `/api/saas`.

- `POST /register`, `POST /login`, `GET /me`
- `GET /dashboard/stats`
- `GET/POST /members`, `PATCH /members/:id`, `POST /members/:id/subscriptions`
- `GET /members/:id/attendance`, `GET /members/:id/payments`
- `GET/POST/PATCH /plans`
- `GET/POST /attendance`, `POST /attendance/check-in`, `PATCH /attendance/:id/check-out`
- `GET/POST /payments`, `POST /payments/link`, `PATCH /payments/:id/mark-paid`
- `POST /payments/razorpay-webhook`
- `GET/POST /trials`, `GET/POST /finance/expenses`
- `GET/POST /trainers`, `GET/POST /classes`, class booking routes
- `GET/POST/PATCH /equipment`
- `GET/PATCH /modules`, `PATCH /settings`, `PUT /integrations/:provider`
- `GET /backup`, `POST /reset`
- `POST /public/:slug/otp`, `POST /public/:slug/verify-checkin`

## Security and production checklist

- All tenant business queries in the SaaS API explicitly scope reads/writes by the authenticated `gym_id`. Legacy single-tenant routers are not mounted. PostgreSQL Row-Level Security (RLS) is **not yet enabled**; add and test RLS policies as a required production hardening step.
- Use HTTPS, strong separate secrets, secure database backups, access logging, monitoring and dependency scanning.
- The included login/registration/OTP rate limiter is in-memory and per process. Use a shared store such as Redis when horizontally scaling.
- Add a formal consent-history/audit trail and WhatsApp delivery-status webhooks before commercial rollout; the current build stores opt-in state and opt-in timestamp and supports opt-out toggles.
- Add staff accounts/permissions, member self-service login, branch-level permissions, backup restore, audit-log UI and a formal retention/deletion workflow before broad customer launch.
- Run database-backed integration tests with at least two gyms and prove that one gym cannot read or change another gym's members, subscriptions, payments, attendance, trials, expenses or integrations.

## Project structure

```text
gym-management-website/
  backend/src/routes/saas.routes.js   Tenant-scoped SaaS API
  backend/src/jobs/reminders.js       Scheduled WhatsApp renewal/trial reminders
  backend/src/lib/security.js         AES-GCM encryption and OTP hashing
  database/migrations/                Ordered PostgreSQL migrations
  database/schema.sql                 Consolidated fresh-install schema
  frontend/src/pages/                 Owner dashboard and management pages
  docker-compose.yml                  Local Docker stack
  .env.example                        Safe environment template
```
