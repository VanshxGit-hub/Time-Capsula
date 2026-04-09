# 🌌 TimeCapsula — Letters to Your Future Self

A beautiful, emotional web app that lets users write letters to their future selves, sealed and delivered by email on the exact date they choose.

---

## 📁 File Structure

```
timecapsula/
├── index.html        # Frontend (dark starfield UI)
├── server.js         # Express backend + cron job
├── package.json
├── .env.example      # Copy to .env and fill in values
└── README.md
```

---

## 🗄️ Supabase Table Schema

Run this SQL in your Supabase project's **SQL Editor**:

```sql
create table letters (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  letter        text not null,
  delivery_date date not null,
  sent          boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Index for the daily cron query (delivery_date + sent)
create index idx_letters_due
  on letters (delivery_date, sent)
  where sent = false;

-- Optional: row-level security (recommended for production)
alter table letters enable row level security;

-- Allow the anon key to INSERT only (no reads from client)
create policy "Allow insert only"
  on letters
  for insert
  to anon
  with check (true);
```

### Column reference

| Column          | Type        | Notes                            |
|-----------------|-------------|----------------------------------|
| `id`            | uuid        | Primary key, auto-generated      |
| `email`         | text        | Recipient email address          |
| `letter`        | text        | The full letter content          |
| `delivery_date` | date        | YYYY-MM-DD, must be future date  |
| `sent`          | boolean     | false until email is dispatched  |
| `created_at`    | timestamptz | Auto-set on insert               |

---

## ⚙️ Setup & Installation

### 1. Clone / download the project

```bash
cd timecapsula
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your real values:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
RESEND_API_KEY=re_your_resend_api_key
PORT=3000
```

**Where to get these:**
- **Supabase**: [supabase.com](https://supabase.com) → Your project → Settings → API
- **Resend**: [resend.com](https://resend.com) → API Keys → Create API Key

### 4. Create the Supabase table

Run the SQL above in your Supabase SQL Editor.

### 5. Verify your sending domain in Resend

In `server.js`, update the `from` field to use your verified domain:
```js
from: "TimeCapsula <letters@yourdomain.com>",
```

### 6. Start the server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Visit `http://localhost:3000` 🌌

---

## ⏰ Cron Job

The cron job runs **every day at 08:00 AM** (server local time).

It:
1. Queries Supabase for rows where `delivery_date = today` AND `sent = false`
2. Sends a beautiful HTML email via Resend for each matching letter
3. Marks the row `sent = true` after successful delivery
4. If sending fails, it leaves `sent = false` so it retries the next run

To change the schedule, edit this line in `server.js`:
```js
cron.schedule("0 8 * * *", sendDueLetters);
//             └─ 8:00 AM daily (cron syntax: minute hour day month weekday)
```

---

## 🚀 Deployment Tips

### Railway / Render / Fly.io
- Set environment variables in the platform's dashboard
- The server serves `index.html` statically — no separate frontend deploy needed

### Keep the cron alive
The cron runs inside the Node process. For reliability:
- Use a platform that keeps your server always-on (not serverless)
- Or replace `node-cron` with a Supabase Edge Function + pg_cron for serverless environments

---

## 🔒 Security Notes

- The Supabase **anon key** is used server-side only — never exposed to the browser
- Row Level Security is enabled: clients can only INSERT, not read letters
- Server validates all input before writing to the database
- Emails are sent server-side via Resend — the API key never touches the frontend
