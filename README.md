# Salem Academy CBT Exam App

React + Vite CBT frontend with an Express + MongoDB backend and an admin dashboard.

## Current Auth Flow

- Student registration: full name, class, email, password
- Student login: email + password only
- Student token + admin token are persisted in MongoDB (survive server restarts)

## Features

- Student dashboard (exam start/resume, previous trials, class + overall leaderboard)
- General dashboard feedback from students
- Timed exam sessions with autosubmit
- Proctoring events + violation penalty model
- Result page with score summary
- Review flow:
  - selected answers shown immediately after submit
  - correct answers shown after release time
- Student and admin report card download (HTML export)
- Admin branding settings (school name + logo URL for report cards)
- Admin management:
  - sessions, users, password resets, exams, questions
  - exports and analytics

## Tech Stack

- Frontend: React + Vite
- Backend: Express + Helmet + CORS
- Database: MongoDB

## Environment

Use `.env.example` as reference.

Required:

- `MONGO_URI`
- `MONGO_DB_NAME`
- `ADMIN_PASSCODE_HASH`

Optional:

- `PORT` (default `4000`)
- `RESULT_RELEASE_DELAY_MS` (default `1500000`, 25 minutes)
- `KEEP_ALIVE_ENABLED`, `KEEP_ALIVE_URL`, `KEEP_ALIVE_INTERVAL_MS`

Generate admin hash:

```bash
npm run hash:admin -- "your-strong-passcode"
```

## Run Locally

Install:

```bash
npm install
```

Development:

```bash
npm run dev
```

- Student app: `http://localhost:5173`
- Admin app: `http://localhost:5173/admin`

Production-style run:

```bash
npm run build
npm run start
```

## Smoke Test

End-to-end smoke test (local server + temporary DB):

```bash
npm run test:smoke
```

The smoke script covers:

- register/login/change-password
- token persistence after restart
- exam flow (start, seen, answer, flag, proctor, submit, feedback)
- student report card endpoint
- admin login + branding + report card
- admin password reset flow

## API (Key Endpoints)

Student auth/profile:

- `POST /api/student/register`
- `POST /api/student/login`
- `GET /api/student/me`
- `POST /api/student/change-password`
- `POST /api/student/password-help`
- `POST /api/student/feedback` (general dashboard feedback)

Student exam:

- `GET /api/exam/meta`
- `POST /api/exam/start`
- `GET /api/exam/:sessionId`
- `POST /api/exam/:sessionId/seen`
- `POST /api/exam/:sessionId/answer`
- `POST /api/exam/:sessionId/flag`
- `POST /api/exam/:sessionId/proctor`
- `POST /api/exam/:sessionId/submit`
- `POST /api/exam/:sessionId/feedback`
- `GET /api/student/trials/:sessionId/report-card`

Admin:

- `POST /api/admin/login`
- `GET /api/admin/overview`
- `GET /api/admin/sessions`
- `GET /api/admin/sessions/:sessionId`
- `GET /api/admin/sessions/:sessionId/report-card`
- `PATCH /api/admin/sessions/:sessionId/violations/waive`
- `GET /api/admin/settings/branding`
- `PATCH /api/admin/settings/branding`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `POST /api/admin/users/:userId/password`

## OpenAPI/Swagger Spec

- OpenAPI file: [docs/openapi.yaml](docs/openapi.yaml)

If you want Swagger UI wired directly into the app, add a Swagger UI middleware route and serve this spec.
