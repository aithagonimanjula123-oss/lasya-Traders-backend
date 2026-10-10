'use strict';

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Configure it in Render before deploying this version.');
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false } : false,
  max: 5,
  connectionTimeoutMillis: 10000,
});
app.use(cors());
app.use(express.json());
app.use((req, _, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`); next(); });

const VALID_CATEGORIES = ['Soaps', 'Chocolates', 'Accessories', 'Beverages', 'Snacks'];
const VALID_STATUSES = ['Pending', 'Confirmed', 'Delivered', 'Cash Collected'];
const seedProducts = [
  { name:'Dove Soap Bar', category:'Soaps', price:28, stock:240 },
  { name:'Dettol Hand Wash 200ml', category:'Soaps', price:65, stock:180 },
  { name:'Lux Rose Soap', category:'Soaps', price:22, stock:310 },
  { name:'Dairy Milk 50g', category:'Chocolates', price:42, stock:500 },
  { name:'KitKat 4-Finger', category:'Chocolates', price:58, stock:320 },
  { name:'Munch Bar (10-pack)', category:'Chocolates', price:95, stock:12 },
  { name:'Colgate Toothbrush', category:'Accessories', price:35, stock:430 },
  { name:'Scotch-Brite Scrubber', category:'Accessories', price:48, stock:200 },
  { name:'Parle-G Biscuits 200g', category:'Snacks', price:20, stock:600 },
  { name:'Real Fruit Juice 1L', category:'Beverages', price:85, stock:150 },
  { name:'Tropicana Orange 1L', category:'Beverages', price:90, stock:8 },
  { name:'Haldirams Namkeen 200g', category:'Snacks', price:55, stock:280 },
];

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0),
      "imageUrl" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      "storeName" TEXT NOT NULL,
      "storePhone" TEXT,
      items JSONB NOT NULL,
      "totalAmount" NUMERIC(12,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      "paymentMethod" TEXT NOT NULL DEFAULT 'Cash on Delivery',
      "cashCollected" BOOLEAN NOT NULL DEFAULT FALSE,
      "placedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (count.rows[0].count === 0) {
    for (const p of seedProducts) {
      await pool.query(
        'INSERT INTO products (name, category, price, stock) VALUES ($1,$2,$3,$4)',
        [p.name, p.category, p.price, p.stock]
      );
    }
    console.log('Seeded initial inventory once. Future restarts will not recreate deleted products.');
  }
}

function validateProduct(b) {
  const errors = [], data = {};
  if (!b.name || !String(b.name).trim()) errors.push('name required');
  else data.name = String(b.name).trim();
  if (!VALID_CATEGORIES.includes(b.category)) errors.push('invalid category');
  else data.category = b.category;
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0) errors.push('price must be >= 0');
  else data.price = price;
  const stock = Number.parseInt(b.stock, 10);
  if (!Number.isInteger(stock) || stock < 0) errors.push('stock must be >= 0');
  else data.stock = stock;
  data.imageUrl = (typeof b.imageUrl === 'string' && b.imageUrl.trim()) ? b.imageUrl.trim() : null;
  return { data, errors };
}
function productRow(row) {
  return { ...row, price: Number(row.price), stock: Number(row.stock), imageUrl: row.imageUrl ?? null };
}
function orderRow(row) {
  return { ...row, totalAmount: Number(row.totalAmount), cashCollected: Boolean(row.cashCollected), items: row.items };
}

app.get('/api/health', async (_, res) => {
  try { await pool.query('SELECT 1'); res.json({ status:'ok', service:'Lasya Traders API', database:'connected' }); }
  catch (e) { console.error(e); res.status(503).json({ status:'error', database:'unavailable' }); }
});

app.get('/api/products', async (req, res, next) => {
  try {
    let sql = 'SELECT * FROM products', params = [], where = [];
    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      params.push(req.query.category); where.push(`category = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).toLowerCase()}%`);
      where.push(`LOWER(name) LIKE $${params.length}`);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY id';
    const result = await pool.query(sql, params);
    res.json(result.rows.map(productRow));
  } catch (e) { next(e); }
});

app.get('/api/products/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message:'Not found' });
    res.json(productRow(result.rows[0]));
  } catch (e) { next(e); }
});

app.post('/api/products', async (req, res, next) => {
  try {
    const { data, errors } = validateProduct(req.body);
    if (errors.length) return res.status(400).json({ message:'Validation failed', errors });
    const r = await pool.query(
      'INSERT INTO products (name,category,price,stock,"imageUrl") VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [data.name,data.category,data.price,data.stock,data.imageUrl]);
    res.status(201).json(productRow(r.rows[0]));
  } catch (e) { next(e); }
});

app.put('/api/products/:id', async (req, res, next) => {
  try {
    const old = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!old.rowCount) return res.status(404).json({ message:'Not found' });
    const { data, errors } = validateProduct({ ...productRow(old.rows[0]), ...req.body });
    if (errors.length) return res.status(400).json({ message:'Validation failed', errors });
    const r = await pool.query(
      'UPDATE products SET name=$1,category=$2,price=$3,stock=$4,"imageUrl"=$5,"updatedAt"=NOW() WHERE id=$6 RETURNING *',
      [data.name,data.category,data.price,data.stock,data.imageUrl,req.params.id]);
    res.json(productRow(r.rows[0]));
  } catch (e) { next(e); }
});

app.delete('/api/products/:id', async (req, res, next) => {
  try {
    const r = await pool.query('DELETE FROM products WHERE id=$1 RETURNING *', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message:'Product not found' });
    console.log(`[PRODUCT -] id=${r.rows[0].id} "${r.rows[0].name}"`);
    res.json({ success:true, deleted:productRow(r.rows[0]) });
  } catch (e) { next(e); }
});

app.get('/api/orders', async (req, res, next) => {
  try {
    let sql = 'SELECT * FROM orders', params = [], where = [];
    if (req.query.date) { params.push(String(req.query.date)); where.push(`"placedAt"::date = $${params.length}::date`); }
    if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
    if (req.query.cashCollected !== undefined) { params.push(req.query.cashCollected === 'true'); where.push(`"cashCollected" = $${params.length}`); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY "placedAt" DESC';
    const r = await pool.query(sql, params); res.json(r.rows.map(orderRow));
  } catch (e) { next(e); }
});

app.get('/api/orders/daily-stats', async (req, res, next) => {
  try {
    const n = Math.max(1, Math.min(Number.parseInt(req.query.days || '7',10) || 7, 90));
    const r = await pool.query(`
      SELECT d::date::text AS date,
        COUNT(o.id)::int AS count,
        COALESCE(SUM(o."totalAmount"),0)::numeric AS revenue,
        COALESCE(SUM(o."totalAmount") FILTER (WHERE o."cashCollected"),0)::numeric AS "cashCollected"
      FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') d
      LEFT JOIN orders o ON o."placedAt"::date=d::date
      GROUP BY d ORDER BY d
    `, [n]);
    res.json(r.rows.map(x => ({...x, revenue:Number(x.revenue), cashCollected:Number(x.cashCollected)})));
  } catch (e) { next(e); }
});

app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message:'Not found' });
    res.json(orderRow(r.rows[0]));
  } catch (e) { next(e); }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.storeName || !String(b.storeName).trim()) return res.status(400).json({message:'storeName required'});
    if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({message:'items required'});
    const totalAmount = Number(b.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return res.status(400).json({message:'totalAmount required'});
    const r = await pool.query(
      'INSERT INTO orders ("storeName","storePhone",items,"totalAmount",status,"paymentMethod","cashCollected","placedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,NOW())) RETURNING *',
      [String(b.storeName).trim(),b.storePhone||null,JSON.stringify(b.items),totalAmount,'Pending','Cash on Delivery',false,b.placedAt||null]);
    res.status(201).json(orderRow(r.rows[0]));
  } catch (e) { next(e); }
});

app.put('/api/orders/:id', async (req, res, next) => {
  try {
    const { status, cashCollected } = req.body;
    if (status !== undefined && !VALID_STATUSES.includes(status))
      return res.status(400).json({message:'Invalid status. Must be one of: '+VALID_STATUSES.join(', ')});
    const old = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!old.rowCount) return res.status(404).json({message:'Not found'});
    const r = await pool.query(
      'UPDATE orders SET status=$1,"cashCollected"=$2,"updatedAt"=NOW() WHERE id=$3 RETURNING *',
      [status === undefined ? old.rows[0].status : status,
       cashCollected === undefined ? old.rows[0].cashCollected : Boolean(cashCollected), req.params.id]);
    res.json(orderRow(r.rows[0]));
  } catch (e) { next(e); }
});

app.get('/api/summary', async (_, res, next) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE "placedAt"::date=CURRENT_DATE)::int AS "todayOrderCount",
        COALESCE(SUM("totalAmount") FILTER (WHERE "placedAt"::date=CURRENT_DATE),0)::numeric AS "todayRevenue",
        COALESCE(SUM("totalAmount") FILTER (WHERE "cashCollected"),0)::numeric AS "totalCashCollected",
        COUNT(*) FILTER (WHERE status='Pending')::int AS "pendingOrders"
      FROM orders
    `);
    const p = await pool.query('SELECT COUNT(*)::int AS "totalProducts", COUNT(*) FILTER (WHERE stock<20)::int AS "lowStockCount" FROM products');
    res.json({...r.rows[0], ...p.rows[0], todayRevenue:Number(r.rows[0].todayRevenue), totalCashCollected:Number(r.rows[0].totalCashCollected)});
  } catch (e) { next(e); }
});

app.use((_,res)=>res.status(404).json({message:'Route not found'}));
app.use((err,_,res,__)=>{ console.error(err); res.status(500).json({message:'Server/database error'}); });

initializeDatabase().then(() => {
  app.listen(PORT, () => console.log(`Lasya Traders API listening on ${PORT}; PostgreSQL persistence enabled.`));
}).catch(err => {
  console.error('Database initialization failed; refusing to start without persistence.', err);
  process.exit(1);
});
module.exports = app;
