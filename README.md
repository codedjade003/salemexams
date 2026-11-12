# Salem Academy CBT

Computer-based testing for Salem Academy: a student exam portal and an admin dashboard, served by
one Node.js process backed by MongoDB.

- **Students** (`/`): sign up with a username, run through a device check and practice test, take
  timed exams (multiple choice, ordering, flowcharts, debugging, writing Python), see their score
  immediately and corrections with explanations after a release delay, and dispute violations.
- **Admins** (`/admin`): monitor live attempts, review answers and overrule marks, decide disputes,
  print report cards in bulk, manage accounts, build exams and every question type, export results.

## Stack

- Frontend: React 19 + Vite, plain CSS design system (`src/styles`), Inter (bundled), Lucide icons
- Backend: Express 5, Helmet, MongoDB driver 7
- Node.js 20 or newer

## Project layout

```
server/
  index.js          API routes, session logic, server bootstrap
  store.js          exam attempts (sessions), revision-checked writes
  examStore.js      exams (cached)              questionStore.js  question bank (cached)
  userStore.js      student accounts            *TokenStore.js    auth tokens (TTL indexes)
  rateLimit.js      login / sign-up rate limits reportCard.js     downloadable report card HTML
src/
  student/          student portal (StudentApp.jsx holds the exam logic; the rest is UI)
  admin/            admin dashboard (AdminApp.jsx shell + one file per page in pages/)
  components/ui.jsx shared components           styles/           design tokens and CSS
scripts/
  smoke-e2e.mjs     end-to-end test against a temporary database
  audit-sessions.mjs  one-off data audit / repair for old attempt records
  hash-admin-password.mjs
```

## Configuration

Copy `.env.example` to `.env` and fill it in. Required:

| Variable | Purpose |
|---|---|
| `MONGO_URI`, `MONGO_DB_NAME` | Database connection |
| `ADMIN_PASSCODE_HASH` | Admin passcode hash. Generate with `npm run hash:admin -- "your-passcode"` |

Recommended: `NODE_ENV=production` and `APP_TIMEZONE=Africa/Lagos` (dates on report cards).

Optional: `DEFAULT_STUDENT_PASSWORD` (`salem`), `DEFAULT_MAX_ATTEMPTS` (3), `RESULT_RELEASE_DELAY_MS`
(25 min), `SUBMIT_GRACE_MS` (90 s), `CORS_ORIGINS` and `VITE_API_BASE` (only if the frontend is hosted on
a different domain from the API), `VITE_STUDENT_IDLE_TIMEOUT_MS`, `MONGO_DNS_SERVERS`.

## Development

```bash
npm install
npm run dev          # student app http://localhost:5173, admin http://localhost:5173/admin
npm run lint
npm run test:smoke   # needs MONGO_URI; creates and drops a throwaway database
npm run test:load    # 40 simulated students take the exam at once; verifies every stored answer
```

## Deploying on Render

One **Web Service** serves both the API and the built frontend:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Environment | `MONGO_URI`, `MONGO_DB_NAME`, `ADMIN_PASSCODE_HASH`, `NODE_ENV=production`, `APP_TIMEZONE=Africa/Lagos` |

On Render the server detects its public URL, trusts the proxy for rate limiting, and pings itself so a
free instance does not go to sleep during an exam. The build copies the in-browser Python runtime
(Pyodide) into the site and pre-compresses it. On first start the server adds the current exam
("Algorithms, Flowcharts & Python Basics", 40 questions) and marks the old pool as an archived
practice exam; after that everything is edited from the admin dashboard and never overwritten.

For an exam with about 40 students, use at least the Starter instance: the free instance has a
fraction of a CPU, which makes the sign-in rush slow (password hashing is deliberately expensive).

## How exams stay safe

- **Answers.** Each answer is stored in the browser and sent to the server until it is confirmed;
  it survives a dropped connection, a refresh, or being signed out. Submitting carries any
  unconfirmed answers with it, and the server accepts late arrivals for 90 seconds after 00:00.
- **Resuming.** Signing in again (on any computer) reopens a running exam where it stopped. The
  timer keeps running.
- **Supervision.** Leaving the exam counts once per absence, with how long the student was away.
  Focus losses under 2 seconds are logged but cost nothing. Students can dispute a violation after
  submitting; the teacher accepts or rejects it under **Violation disputes**.
- **Python.** Programs run in the student's browser. The coding question is checked there against
  the question's tests; the teacher can overrule any mark when reviewing an attempt.
- **Hints.** Every question can have a hint. An exam sets how many hints a student gets and for
  which classes (none by default).

## Security notes

- Passwords and the admin passcode are hashed with scrypt (run off the main thread).
- Tokens are random, stored server-side with expiry, and revoked on sign-out, password change,
  password reset, and account disable.
- Failed logins are rate limited per account and per network; sign-ups and help requests per
  network. Limits are generous because a school lab shares one public IP.
- Scores are never revealed for an exam in progress. Correct answers stay hidden until the
  release time.
- CSV exports neutralize spreadsheet formulas in student-entered text.

## API

Key endpoints are documented in [docs/openapi.yaml](docs/openapi.yaml).
