# 2v2 Chess (Vite + Supabase + chess.js)

Team A = White (seats 0 and 2), Team B = Black (seats 1 and 3).
Turn order: A1 → B1 → A2 → B2. The active seat is `ply % 4`.

## Setup
1. Create a Supabase project.
2. Authentication → Providers → enable **Anonymous Sign-ins**.
3. SQL Editor → paste and run `supabase-schema.sql`.
4. `cp .env.example .env.local` and fill in your Project URL + anon key (Settings → API).
5. `npm install && npm run dev`
6. Open 4 different browsers / incognito windows. One creates a room, the others join with the code.

## Deploy to Vercel
1. Push to GitHub, then import the repo in Vercel (Vite is auto-detected).
2. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Deploy.

## Notes
- Turn order and stale-move protection are enforced in Postgres (`make_move`).
- Move legality is checked client-side with chess.js. For anti-cheat, validate in a Supabase Edge Function.
- Promotion is automatic to a queen.
