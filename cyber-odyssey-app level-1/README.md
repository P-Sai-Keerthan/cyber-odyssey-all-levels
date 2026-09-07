# Cyber Odyssey — Level 1

A 45-minute, team-based cybersecurity qualifier: investigate an email security threat artifact (Track A · Scam Bazaar), analyze and exploit application session vulnerabilities (Track B · Session Hijack), and reconstruct the forensic digital evidence chain (Track C · Forensic Incident Hub) to reach Ithaca.

## Architecture

- **Web Application**: Next.js 14 Pages router application.
- **Database**: Standard PostgreSQL using the `pg` driver with connection pooling.
- **Authentication**:
  - Participants: Team Name + Team Password, signed session cookies (`sb_team`, HMAC-SHA256).
  - Admin: Separate Level 1 Admin (`/admin`), password protected (`sb_admin`).

## Setup & Configuration

### 1. Environment Variables

Create `.env` based on `.env.example`:

```bash
cp .env.example .env
```

Configure:
- `DATABASE_URL`: Standard PostgreSQL connection string, e.g.:
  `postgresql://postgres:postgres@localhost:5432/cyber_odyssey`
- `SESSION_SECRET`: Secret key used for signing cookies (e.g. `openssl rand -hex 32`).
- `ADMIN_PASSWORD`: Level 1 Admin dashboard password. Generate one, do not invent it by hand:
  `openssl rand -base64 18`. Never commit the real value — `.env` is git-ignored for this reason.

### 2. Database Initialization & Seeding

Initialize the database schema and seed teams:

```bash
# Apply table schema to PostgreSQL
npm run db:init

# Generate teams, hashed credentials, and default configuration
TEAM_COUNT=60 npm run db:seed
```

This writes `team-codes.csv` containing:
`id,code,name,password`

Distribute the Team Name and Password to each participating crew.

### 3. Running Locally

```bash
npm install
npm run dev
```

Visit:
- Participant Login: `http://localhost:3001`
- Level 1 Admin: `http://localhost:3001/admin`

### 4. Admin Management

Level 1 Admin dashboard provides:
- Lifecycle controls: **Open/Start**, **Pause**, **Resume**, **End**, and duration configuration.
- Real-time deterministic leaderboard with search and individual team reset.
- Danger zone for resetting all teams between dry runs.
