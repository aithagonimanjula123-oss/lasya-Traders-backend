# Last Traders — Cloudflare Pages + D1

The upgrade/cloudflare-d1 branch adds a Cloudflare Worker API backed by D1 and preserves the original Express server.js for local development or rollback. The frontend branch also contains the same API as a Pages Function so the recommended deployment can use a single origin.

## Recommended deployment

1. Create a Cloudflare Pages project named lasya-traders and connect the frontend GitHub repository. Use the upgrade/cloudflare-premium branch for preview first; do not merge to production until you have tested the preview.
2. In Cloudflare, create a D1 database named last-traders-production. Copy its UUID into wrangler.toml in the frontend repo in place of REPLACE_WITH_D1_DATABASE_ID.
3. Run npx wrangler d1 migrations apply last-traders-production --remote from the frontend repo to create tables and indexes.
4. Configure these Pages secrets (never commit their values): AUTH_SECRET (a long random secret, at least 32 random bytes), OWNER_EMAIL, OWNER_PASSWORD, STAFF_EMAIL, STAFF_PASSWORD.
5. Trigger a Pages deployment and test /api/health, sign-in, products, order placement, and employee inventory/order actions.
6. After the preview works, merge the reviewed branch and use the production branch for automatic deploys.

## CLI secret setup

From the frontend repository, after the Pages project exists, run each command and enter the value when prompted:

    npx wrangler pages secret put AUTH_SECRET --project-name lasya-traders
    npx wrangler pages secret put OWNER_EMAIL --project-name lasya-traders
    npx wrangler pages secret put OWNER_PASSWORD --project-name lasya-traders
    npx wrangler pages secret put STAFF_EMAIL --project-name lasya-traders
    npx wrangler pages secret put STAFF_PASSWORD --project-name lasya-traders

Choose unique strong passwords; do not use sample or school passwords. Keep them out of GitHub and browser code.

## Security and data notes

- API write operations require an 8-hour HMAC-signed session token. Owner and staff roles have separate permissions.
- Owners can view only orders associated with their sign-in email; staff can manage inventory and all orders.
- SQL uses prepared statements, input validation, D1 constraints, and a same-origin default CORS policy.
- Static response headers disable framing, MIME sniffing, and unnecessary browser permissions.
- The old Express backend remains unchanged on this branch for rollback. It uses in-memory data and is not the production persistence layer.
- The current demo products are deliberately not seeded. Add the real sample products after you provide them.
- Before handling real customer data, test access boundaries, configure rate limiting/monitoring, and review backup/recovery. The current single owner + single staff credential model is a lightweight starter, not a multi-user account system.

## Local development

Use Wrangler Pages local development with a configured D1 database and secrets. Do not deploy until the D1 ID and all five secrets are set.