# Lasya Traders — Backend

Node.js / Express backend for the Lasya Traders wholesale supply platform.

## Deploy on Render
1. Push this repo to GitHub
2. Go to render.com → New Web Service → connect this repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Instance type: Free

## API Endpoints
- GET  /api/health
- GET  /api/products
- POST /api/products
- PUT  /api/products/:id
- DELETE /api/products/:id
- GET  /api/orders
- POST /api/orders
- PUT  /api/orders/:id
- GET  /api/orders/daily-stats
- GET  /api/summary
