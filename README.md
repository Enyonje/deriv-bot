# Deriv Bot: deployment notes

## Layout (drop into your existing Next.js + Tailwind project, `src/` layout)
Copy `src/`, `next.config.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/`, `.env.example`.

## How onboarding works
1. The user enters App ID, PAT, Account ID and market symbol in the page.
2. `POST /api/deriv/onboard` verifies them against Deriv, then stores them AES-256-GCM encrypted in an
   `httpOnly`, `SameSite=Strict` cookie scoped to `/api/deriv`. The token is never returned to the browser.
3. `POST /api/deriv/session` reads the cookie, requests a fresh single-use OTP and returns a `wss://` URL.
4. The browser connects to Deriv directly with that URL.

## Run
    cp .env.example .env   # set DERIV_API_BASE, SESSION_SECRET, BASIC_AUTH_*
    docker compose up -d --build
    curl localhost:3000/api/health

## Go-live checklist
- [ ] SESSION_SECRET set (32+ random chars) and kept in your secret manager.
- [ ] BASIC_AUTH_USER / BASIC_AUTH_PASSWORD set (the app returns 503 in production without them).
- [ ] TLS terminated in front (cookies are `Secure` in production; HSTS assumes HTTPS).
- [ ] DERIV_ALLOW_REAL stays false until the client signs off.
- [ ] Rotate any PAT that was ever pasted anywhere insecure.
- [ ] Rotating SESSION_SECRET signs everyone out; they simply onboard again.