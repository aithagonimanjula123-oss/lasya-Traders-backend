'use strict';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Prefer the server-only service-role key when configured. Never expose this key in frontend code.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
let configuredAccounts = [];
try {
  const parsed = JSON.parse(process.env.AUTH_ACCOUNTS_JSON || '[]');
  if (Array.isArray(parsed)) configuredAccounts = parsed
    .filter(a => a && typeof a.email === 'string' && typeof a.password === 'string' && ['admin','owner'].includes(a.role))
    .map(a => ({ email: a.email.trim().toLowerCase(), password: a.password, role: a.role }))
    .filter(a => a.email && a.password.length >= 12);
} catch (_) {
  console.error('AUTH_ACCOUNTS_JSON is invalid JSON; using individual account environment variables.');
}
if (ADMIN_EMAIL && ADMIN_PASSWORD && !configuredAccounts.some(a => a.email === ADMIN_EMAIL)) {
  configuredAccounts.push({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin' });
}
if (OWNER_EMAIL && OWNER_PASSWORD && !configuredAccounts.some(a => a.email === OWNER_EMAIL)) {
  configuredAccounts.push({ email: OWNER_EMAIL, password: OWNER_PASSWORD, role: 'owner' });
}
const SITE_ORIGINS = new Set([
  'https://lasyatraderschandur.netlify.app',
  'https://lasya-traders.netlify.app',
  'https://lasya-traders-frontend-latest.onrender.com'
]);
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

app.use(cors({
  origin(origin, callback) {
    if (!origin || SITE_ORIGINS.has(origin) ||
      /^https:\/\/(?:[a-z0-9-]+\.)?netlify\.app$/.test(origin) ||
      /^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    console.warn('Rejected CORS origin:', origin);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600
}));
app.use(express.json({ limit: '1mb' }));
app.use((req, _, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`); next(); });

const VALID_CATEGORIES = ['Soaps', 'Chocolates', 'Accessories', 'Beverages', 'Snacks'];
const VALID_STATUSES = ['Pending', 'Confirmed', 'Delivered', 'Cash Collected'];
const dbRequired = (req, res, next) => {
  if (!supabase) return res.status(503).json({ message: 'Database is not configured on the server.' });
  next();
};
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/health') return next();
  return dbRequired(req, res, next);
});

// Per-instance brute-force limiter. Keep this for the current single-instance deployment.
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let record = loginAttempts.get(key);
  if (!record || now - record.start > 15 * 60 * 1000) record = { start: now, count: 0 };
  record.count += 1; loginAttempts.set(key, record);
  if (record.count > 10) return res.status(429).json({ message: 'Too many login attempts. Try again in 15 minutes.' });
  next();
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function makeToken(account) {
  const payload = Buffer.from(JSON.stringify({
    sub: account.email, role: account.role, exp: Date.now() + 8 * 60 * 60 * 1000
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!SESSION_SECRET || configuredAccounts.length === 0) {
      return res.status(503).json({ message: 'Authentication is not configured on the server.' });
    }
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const parts = token.split('.');
    if (parts.length !== 2) return res.status(401).json({ message: 'Sign-in required.' });
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('base64url');
    if (!safeEqual(parts[1], expected)) return res.status(401).json({ message: 'Invalid or expired session.' });
    try {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const account = configuredAccounts.find(a => a.email === payload.sub && a.role === payload.role);
      if (!account || !roles.includes(payload.role) || !Number.isFinite(payload.exp) || payload.exp < Date.now()) {
        return res.status(401).json({ message: 'Session expired or account access was revoked. Sign in again.' });
      }
      req.auth = { email: payload.sub, role: payload.role };
      next();
    } catch (_) { return res.status(401).json({ message: 'Invalid session.' }); }
  };
}
const requireAdmin = requireRole('admin');
app.post('/api/auth/login', loginRateLimit, (req, res) => {
  if (!SESSION_SECRET || configuredAccounts.length === 0) {
    return res.status(503).json({ message: 'Authentication is not configured. Add approved accounts and SESSION_SECRET in Render.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const requestedRole = String(req.body?.role || '');
  if (!email || !password || !['admin','owner'].includes(requestedRole)) {
    return res.status(400).json({ message: 'Email, password, and portal role are required.' });
  }
  const account = configuredAccounts.find(a => a.email === email && a.role === requestedRole && safeEqual(a.password, password));
  if (!account) return res.status(401).json({ message: 'Incorrect email/password or account is not approved for this portal.' });
  res.json({ token: makeToken(account), role: account.role, expiresIn: 28800 });
});
// Public catalogue reads and customer order creation are allowed; staff operations require a signed session.
app.use('/api/products', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireAdmin(req, res, next);
  next();
});
app.use('/api/orders', (req, res, next) => {
  if (req.method === 'POST' && (req.path === '/' || req.path === '')) return requireRole('owner', 'admin')(req, res, next);
  if (req.method === 'GET' && (req.path === '/' || req.path === '')) return requireRole('owner', 'admin')(req, res, next);
  return requireAdmin(req, res, next);
});
app.use('/api/summary', requireAdmin);

function productOut(p) {
  return { id: Number(p.id), name: p.name, category: p.category, price: Number(p.sell_price ?? p.price), stock: Number(p.stock),
    imageUrl: p.image_url || null, unit: p.unit || 'per piece', minOrder: Number(p.min_order || 1),
    unitCase: p.unit_case || null,
    retailPrice: p.retail_price == null ? null : Number(p.retail_price),
    whPrice: p.wh_price == null ? null : Number(p.wh_price),
    sellPrice: p.sell_price == null ? Number(p.price) : Number(p.sell_price),
    bulkPrice: p.bulk_price == null ? null : Number(p.bulk_price),
    mrp: p.mrp == null ? null : Number(p.mrp),
    discountPrice: p.discount_price == null ? null : Number(p.discount_price),
    discountType: p.discount_type || null, discountValue: p.discount_value == null ? null : Number(p.discount_value),
    createdAt: p.created_at, updatedAt: p.updated_at };
}
function orderOut(o) {
  return { id: Number(o.id), storeName: o.store_name, storePhone: o.store_phone || null,
    items: Array.isArray(o.items) ? o.items : [], totalAmount: Number(o.total_amount || 0),
    status: o.status, paymentMethod: o.payment_method || 'Cash on Delivery',
    cashCollected: Boolean(o.cash_collected), placedAt: o.placed_at, updatedAt: o.updated_at };
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
  const stock = Number(b.stock);
  if (!Number.isInteger(stock) || stock < 0) errors.push('stock must be a non-negative integer');
  else data.stock = stock;
  data.image_url = typeof b.imageUrl === 'string' && b.imageUrl.trim() ? b.imageUrl.trim() : null;
  const optionalPrices = [
    ['retailPrice', 'retail_price'], ['whPrice', 'wh_price'], ['sellPrice', 'sell_price'],
    ['bulkPrice', 'bulk_price'], ['mrp', 'mrp'], ['discountPrice', 'discount_price']
  ];
  for (const [inputKey, dbKey] of optionalPrices) {
    const raw = b[inputKey];
    if (raw === undefined || raw === null || raw === '') {
      data[dbKey] = inputKey === 'sellPrice' ? (data.price ?? Number(b.price)) : null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) errors.push(inputKey + ' must be a non-negative number');
    else data[dbKey] = value;
  }
  data.unit_case = typeof b.unitCase === 'string' && b.unitCase.trim() ? b.unitCase.trim() : null;
  const discountType = b.discountType == null || b.discountType === '' ? null : String(b.discountType);
  const discountValue = b.discountValue == null || b.discountValue === '' ? null : Number(b.discountValue);
  if (discountType !== null && !['percent', 'flat'].includes(discountType)) errors.push('invalid discount type');
  else if (discountType === null) {
    data.discount_type = null;
    data.discount_value = null;
  } else if (!Number.isFinite(discountValue) || discountValue <= 0) {
    errors.push('discount value must be greater than 0');
  } else if (discountType === 'percent' && discountValue > 100) {
    errors.push('percentage discount cannot exceed 100');
  } else if (discountType === 'flat' && discountValue > price) {
    errors.push('flat discount cannot exceed price');
  } else {
    data.discount_type = discountType;
    data.discount_value = discountValue;
  }
  return { data, errors };
}
function fail(res, error, message = 'Database request failed') {
  console.error(message, error?.message || error);
  return res.status(500).json({ message });
}

app.get('/api/health', async (_, res) => {
  if (!supabase) return res.status(503).json({ status: 'offline', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in Render.' });
  try {
    const { error } = await supabase.from('products').select('id', { head: true, count: 'exact' });
    if (error) {
      console.error('Supabase health check failed:', error.message || error.code || 'unknown database error');
      return res.status(503).json({ status: 'offline', message: 'Supabase connection failed. Check the server logs for the database error.' });
    }
    return res.json({ status: 'ok', service: 'Lasya Traders API', database: 'connected' });
  } catch (error) {
    console.error('Supabase health check threw:', error?.message || error);
    return res.status(503).json({ status: 'offline', message: 'Supabase health check failed. Check the server logs.' });
  }
});

app.get('/api/products', async (req, res) => {
  let query = supabase.from('products').select('*').order('id', { ascending: true });
  if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) query = query.eq('category', req.query.category);
  const { data, error } = await query;
  if (error) return fail(res, error, 'Could not load products');
  let result = (data || []).map(productOut);
  if (req.query.search) {
    const search = String(req.query.search).toLowerCase();
    result = result.filter(p => p.name.toLowerCase().includes(search) || p.category.toLowerCase().includes(search));
  }
  res.json(result);
});

app.get('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return fail(res, error, 'Could not load product');
  if (!data) return res.status(404).json({ message: 'Not found' });
  res.json(productOut(data));
});

app.post('/api/products', async (req, res) => {
  const { data: values, errors } = validateProduct(req.body || {});
  if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });
  const { data, error } = await supabase.from('products').insert(values).select('*').single();
  if (error) return fail(res, error, 'Could not save product');
  console.log(`[PRODUCT +] id=${data.id} "${data.name}"`);
  res.status(201).json(productOut(data));
});

app.put('/api/products/:id', async (req, res) => {
  const { data: current, error: readError } = await supabase.from('products').select('*').eq('id', req.params.id).maybeSingle();
  if (readError) return fail(res, readError, 'Could not load product');
  if (!current) return res.status(404).json({ message: 'Not found' });
  const body = req.body || {};
  const merged = {
    name: body.name ?? current.name,
    category: body.category ?? current.category,
    price: body.price ?? current.price,
    stock: body.stock ?? current.stock,
    imageUrl: body.imageUrl ?? current.image_url,
    unitCase: body.unitCase ?? current.unit_case,
    retailPrice: body.retailPrice ?? current.retail_price,
    whPrice: body.whPrice ?? current.wh_price,
    sellPrice: body.sellPrice ?? current.sell_price ?? current.price,
    bulkPrice: body.bulkPrice ?? current.bulk_price,
    mrp: body.mrp ?? current.mrp,
    discountPrice: body.discountPrice ?? current.discount_price,
    discountType: body.discountType ?? current.discount_type,
    discountValue: body.discountValue ?? current.discount_value
  };
  const { data: values, errors } = validateProduct(merged);
  if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });
  values.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('products').update(values).eq('id', req.params.id).select('*').single();
  if (error) return fail(res, error, 'Could not update product');
  res.json(productOut(data));
});

app.delete('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase.from('products').delete().eq('id', req.params.id).select('*').maybeSingle();
  if (error) return fail(res, error, 'Could not delete product');
  if (!data) return res.status(404).json({ message: 'Not found' });
  console.log(`[PRODUCT -] id=${data.id} "${data.name}"`);
  res.json({ success: true, deleted: productOut(data) });
});

app.get('/api/orders', async (req, res) => {
  let query = supabase.from('orders').select('*').order('placed_at', { ascending: false });
  if (req.auth?.role === 'owner') query = query.eq('store_email', req.auth.email);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.cashCollected !== undefined) query = query.eq('cash_collected', req.query.cashCollected === 'true');
  if (req.query.date) {
    const start = new Date(req.query.date + 'T00:00:00.000Z');
    const end = new Date(start.getTime() + 86400000);
    query = query.gte('placed_at', start.toISOString()).lt('placed_at', end.toISOString());
  }
  const { data, error } = await query;
  if (error) return fail(res, error, 'Could not load orders');
  res.json((data || []).map(orderOut));
});

app.get('/api/orders/daily-stats', async (req, res) => {
  const days = Math.max(1, Math.min(parseInt(req.query.days || '7', 10) || 7, 90));
  const { data, error } = await supabase.from('orders').select('*');
  if (error) return fail(res, error, 'Could not load daily statistics');
  const orders = (data || []).map(orderOut);
  const stats = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const rows = orders.filter(o => o.placedAt && o.placedAt.slice(0, 10) === date);
    stats.push({ date, count: rows.length, revenue: rows.reduce((n, o) => n + o.totalAmount, 0),
      cashCollected: rows.filter(o => o.cashCollected).reduce((n, o) => n + o.totalAmount, 0) });
  }
  res.json(stats);
});

app.get('/api/orders/:id', async (req, res) => {
  const { data, error } = await supabase.from('orders').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return fail(res, error, 'Could not load order');
  if (!data) return res.status(404).json({ message: 'Not found' });
  res.json(orderOut(data));
});

app.post('/api/orders', async (req, res) => {
  const b = req.body || {};
  if (!b.storeName || !String(b.storeName).trim()) return res.status(400).json({ message: 'storeName required' });
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ message: 'items required' });
  const totalAmount = Number(b.totalAmount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return res.status(400).json({ message: 'totalAmount required' });
  const values = { store_name: String(b.storeName).trim(), store_email: req.auth?.email || null, store_phone: b.storePhone || null, items: b.items,
    total_amount: totalAmount, status: 'Pending', payment_method: 'Cash on Delivery',
    cash_collected: false, placed_at: new Date().toISOString() };
  const { data, error } = await supabase.from('orders').insert(values).select('*').single();
  if (error) return fail(res, error, 'Could not save order');
  console.log(`[ORDER +] #${data.id} "${data.store_name}" ₹${data.total_amount}`);
  res.status(201).json(orderOut(data));
});

app.put('/api/orders/:id', async (req, res) => {
  const b = req.body || {}, values = {};
  if (b.status !== undefined) {
    if (!VALID_STATUSES.includes(b.status)) return res.status(400).json({ message: 'Invalid status' });
    values.status = b.status;
  }
  if (b.cashCollected !== undefined) values.cash_collected = Boolean(b.cashCollected);
  if (!Object.keys(values).length) return res.status(400).json({ message: 'No supported fields to update' });
  values.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('orders').update(values).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return fail(res, error, 'Could not update order');
  if (!data) return res.status(404).json({ message: 'Not found' });
  res.json(orderOut(data));
});

app.get('/api/summary', async (_, res) => {
  const [ordersResult, productsResult] = await Promise.all([
    supabase.from('orders').select('*'),
    supabase.from('products').select('id,stock')
  ]);
  if (ordersResult.error) return fail(res, ordersResult.error, 'Could not load summary');
  if (productsResult.error) return fail(res, productsResult.error, 'Could not load summary');
  const orders = (ordersResult.data || []).map(orderOut);
  const products = productsResult.data || [];
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter(o => o.placedAt && o.placedAt.slice(0, 10) === today);
  res.json({ todayOrderCount: todayOrders.length, todayRevenue: todayOrders.reduce((n, o) => n + o.totalAmount, 0),
    totalCashCollected: orders.filter(o => o.cashCollected).reduce((n, o) => n + o.totalAmount, 0),
    pendingOrders: orders.filter(o => o.status === 'Pending').length, totalProducts: products.length,
    lowStockCount: products.filter(p => Number(p.stock) < 20).length });
});

app.use('/api', (req, res) => res.status(404).json({ message: 'Route not found' }));
app.use((err, _, res, __) => { console.error(err); res.status(500).json({ message: 'Internal server error' }); });

app.listen(PORT, () => console.log(`Lasya Traders API listening on port ${PORT}; Supabase ${supabase ? 'configured' : 'MISSING CONFIG'}`));
module.exports = app;
