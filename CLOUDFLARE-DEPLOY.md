# Last Traders — Cloudflare upgrade

This branch prepares a Cloudflare Workers + D1 deployment while preserving the existing Express backend and storefront on `main`.

## Architecture
- Existing storefront: `lasya-Traders/index.html`
- Edge API: `src/index.js` (Cloudflare Worker)
- Persistent SQL schema: `migrations/0001_initial.sql`
- D1 binding config: `wrangler.toml`

## API compatibility
Implements the existing health, product CRUD, order CRUD, daily statistics, and summary routes. Product and order writes require `Authorization: Bearer <ADMIN_TOKEN>`. This protects write endpoints but is not a substitute for per-user authentication; do not expose an admin token in browser code. Before connecting the existing UI's write actions, implement a proper sign-in/session flow and role-based authorization.

## Deploy checklist
1. Create a Cloudflare D1 database named `last-traders-production` in the Cloudflare dashboard (the connected Cloudflare API session currently returns an authentication error).
2. Replace `REPLACE_WITH_DATABASE_ID` in `wrangler.toml` with the D1 database UUID.
3. Apply `migrations/0001_initial.sql` using Wrangler.
4. Set the secret: `npx wrangler secret put ADMIN_TOKEN` (use a long random value; never commit it).
5. Set `ALLOWED_ORIGIN` to the exact deployed frontend origin.
6. Deploy from this repo with Wrangler and test every route.
7. Configure the frontend API URL and proper authentication before enabling writes in the live UI.

## Security notes
- Prepared statements are used for SQL queries.
- Mutating API routes require a server-side bearer secret.
- CORS is restricted to a configured origin.
- Request fields and payload sizes are validated at the application layer.
- No credentials belong in source control.
- Add user accounts, password hashing, session cookies, CSRF protection, rate limits and audit logging before real business use.

## Current limitations
- This is deployment scaffolding, not a claim of production readiness.
- The current frontend's role selection is client-side only and is not secure authentication.
- D1 must be provisioned and its ID configured before deployment.
- Product seed data should be reviewed and imported only after you provide the real sample products.
