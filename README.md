# Lasya Traders — Backend

The existing Express server remains available for local development and rollback. The Cloudflare branch adds a persistent D1-backed Worker API with signed owner/staff sessions.

## Recommended hosting

Use the frontend repository's Cloudflare Pages project for the storefront and same-origin API. This avoids browser CORS configuration and lets Pages Functions use the D1 binding.

## Cloudflare files
- src/index.js — Worker API implementation.
- migrations/0001_initial.sql — D1 tables and indexes.
- wrangler.toml — standalone Worker configuration (replace the D1 UUID and set ALLOWED_ORIGIN before deploying it separately).
- CLOUDFLARE-DEPLOY.md — step-by-step setup, secrets, and security checklist.

## Existing Express development server
Run npm install and npm start to launch server.js locally. The original Express backend keeps its in-memory data behavior; do not use it as the production database because state is lost when the process restarts.

Real product records are intentionally not seeded until the business supplies the actual product catalogue.