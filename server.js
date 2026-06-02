/**
 * ═══════════════════════════════════════════════════════════
 *  Lasya Traders — Backend Server  v2.0
 *  Node.js + Express  |  npm install express cors  |  node server.js
 *
 *  Endpoints:
 *    GET    /api/health
 *    GET    /api/products
 *    POST   /api/products
 *    PUT    /api/products/:id
 *    DELETE /api/products/:id
 *
 *    GET    /api/orders             ?date=YYYY-MM-DD &status=Pending
 *    GET    /api/orders/:id
 *    POST   /api/orders
 *    PUT    /api/orders/:id         { status, cashCollected }
 *    GET    /api/orders/daily-stats  last-N-days count + revenue
 * ═══════════════════════════════════════════════════════════
 */
'use strict';

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(cors({
  origin: 'YOUR_EDGEONE_URL',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use((req,_,next)=>{ console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`); next(); });

/* ─── IN-MEMORY STORES ─── */
let pidCounter = 100;
let oidCounter = 1;

let products = [
  {id:1, name:'Dove Soap Bar',         category:'Soaps',       price:28, stock:240,imageUrl:null,createdAt:new Date().toISOString()},
  {id:2, name:'Dettol Hand Wash 200ml',category:'Soaps',       price:65, stock:180,imageUrl:null,createdAt:new Date().toISOString()},
  {id:3, name:'Lux Rose Soap',         category:'Soaps',       price:22, stock:310,imageUrl:null,createdAt:new Date().toISOString()},
  {id:4, name:'Dairy Milk 50g',        category:'Chocolates',  price:42, stock:500,imageUrl:null,createdAt:new Date().toISOString()},
  {id:5, name:'KitKat 4-Finger',       category:'Chocolates',  price:58, stock:320,imageUrl:null,createdAt:new Date().toISOString()},
  {id:6, name:'Munch Bar (10-pack)',    category:'Chocolates',  price:95, stock:12, imageUrl:null,createdAt:new Date().toISOString()},
  {id:7, name:'Colgate Toothbrush',    category:'Accessories', price:35, stock:430,imageUrl:null,createdAt:new Date().toISOString()},
  {id:8, name:'Scotch-Brite Scrubber', category:'Accessories', price:48, stock:200,imageUrl:null,createdAt:new Date().toISOString()},
  {id:9, name:'Parle-G Biscuits 200g', category:'Snacks',      price:20, stock:600,imageUrl:null,createdAt:new Date().toISOString()},
  {id:10,name:'Real Fruit Juice 1L',   category:'Beverages',   price:85, stock:150,imageUrl:null,createdAt:new Date().toISOString()},
  {id:11,name:'Tropicana Orange 1L',   category:'Beverages',   price:90, stock:8,  imageUrl:null,createdAt:new Date().toISOString()},
  {id:12,name:'Haldirams Namkeen 200g',category:'Snacks',      price:55, stock:280,imageUrl:null,createdAt:new Date().toISOString()},
];

/** @type {Order[]} */
let orders = [];

const VALID_CATEGORIES = ['Soaps','Chocolates','Accessories','Beverages','Snacks'];
const VALID_STATUSES   = ['Pending','Confirmed','Delivered','Cash Collected'];

/* ─── VALIDATION ─── */
function validateProduct(b) {
  const errors=[], data={};
  if(!b.name||!String(b.name).trim()) errors.push('name required');
  else data.name=String(b.name).trim();
  if(!VALID_CATEGORIES.includes(b.category)) errors.push('invalid category');
  else data.category=b.category;
  const price=parseFloat(b.price);
  if(isNaN(price)||price<0) errors.push('price must be >= 0');
  else data.price=price;
  const stock=parseInt(b.stock,10);
  if(isNaN(stock)||stock<0) errors.push('stock must be >= 0');
  else data.stock=stock;
  data.imageUrl=(typeof b.imageUrl==='string'&&b.imageUrl.trim())?b.imageUrl.trim():null;
  return {data,errors};
}

/* ══════════════════════════════════════
   HEALTH
══════════════════════════════════════ */
app.get('/api/health',(_,res)=>res.json({status:'ok',service:'Lasya Traders API v2',uptime:Math.round(process.uptime())+'s'}));

/* ══════════════════════════════════════
   PRODUCTS
══════════════════════════════════════ */
app.get('/api/products',(req,res)=>{
  let r=[...products];
  if(req.query.category&&VALID_CATEGORIES.includes(req.query.category)) r=r.filter(p=>p.category===req.query.category);
  if(req.query.search) r=r.filter(p=>p.name.toLowerCase().includes(req.query.search.toLowerCase()));
  res.json(r);
});

app.get('/api/products/:id',(req,res)=>{
  const p=products.find(p=>p.id===+req.params.id);
  if(!p) return res.status(404).json({message:'Not found'});
  res.json(p);
});

app.post('/api/products',(req,res)=>{
  const {data,errors}=validateProduct(req.body);
  if(errors.length) return res.status(400).json({message:'Validation failed',errors});
  const p={id:++pidCounter,...data,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  products.push(p);
  console.log(`[PRODUCT +] id=${p.id} "${p.name}"`);
  res.status(201).json(p);
});

app.put('/api/products/:id',(req,res)=>{
  const idx=products.findIndex(p=>p.id===+req.params.id);
  if(idx===-1) return res.status(404).json({message:'Not found'});
  const {data,errors}=validateProduct({...products[idx],...req.body});
  if(errors.length) return res.status(400).json({message:'Validation failed',errors});
  products[idx]={...products[idx],...data,updatedAt:new Date().toISOString()};
  res.json(products[idx]);
});

app.delete('/api/products/:id',(req,res)=>{
  const idx=products.findIndex(p=>p.id===+req.params.id);
  if(idx===-1) return res.status(404).json({message:'Not found'});
  const [deleted]=products.splice(idx,1);
  console.log(`[PRODUCT -] id=${deleted.id} "${deleted.name}"`);
  res.json({success:true,deleted});
});

/* ══════════════════════════════════════
   ORDERS
══════════════════════════════════════ */

/**
 * GET /api/orders
 * Optional query params:
 *   ?date=2025-06-01        filter by date (YYYY-MM-DD)
 *   ?status=Pending         filter by status
 *   ?cashCollected=true
 */
app.get('/api/orders',(req,res)=>{
  let r=[...orders];
  if(req.query.date)          r=r.filter(o=>o.placedAt&&o.placedAt.startsWith(req.query.date));
  if(req.query.status)        r=r.filter(o=>o.status===req.query.status);
  if(req.query.cashCollected) r=r.filter(o=>o.cashCollected===(req.query.cashCollected==='true'));
  res.json(r);
});

/** GET /api/orders/daily-stats?days=7 — count + revenue per day */
app.get('/api/orders/daily-stats',(req,res)=>{
  const n=Math.min(parseInt(req.query.days||'7',10),90);
  const stats=[];
  for(let i=n-1;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const dateStr=d.toISOString().split('T')[0];
    const dayOrders=orders.filter(o=>o.placedAt&&o.placedAt.startsWith(dateStr));
    stats.push({
      date:       dateStr,
      count:      dayOrders.length,
      revenue:    dayOrders.reduce((s,o)=>s+Number(o.totalAmount),0),
      cashCollected: dayOrders.filter(o=>o.cashCollected).reduce((s,o)=>s+Number(o.totalAmount),0),
    });
  }
  res.json(stats);
});

app.get('/api/orders/:id',(req,res)=>{
  const o=orders.find(o=>o.id===+req.params.id);
  if(!o) return res.status(404).json({message:'Not found'});
  res.json(o);
});

/**
 * POST /api/orders
 * Body: { storeName, storePhone?, items[], totalAmount, paymentMethod, cashCollected, placedAt }
 */
app.post('/api/orders',(req,res)=>{
  const b=req.body;
  if(!b.storeName||!b.storeName.trim()) return res.status(400).json({message:'storeName required'});
  if(!Array.isArray(b.items)||!b.items.length) return res.status(400).json({message:'items required'});
  const totalAmount=Number(b.totalAmount);
  if(isNaN(totalAmount)||totalAmount<=0) return res.status(400).json({message:'totalAmount required'});

  const order={
    id:             oidCounter++,
    storeName:      String(b.storeName).trim(),
    storePhone:     b.storePhone||null,
    items:          b.items,
    totalAmount,
    status:         'Pending',
    paymentMethod:  'Cash on Delivery',
    cashCollected:  false,
    placedAt:       b.placedAt||new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };
  orders.push(order);
  console.log(`[ORDER +] #${order.id} "${order.storeName}" ₹${order.totalAmount}`);
  res.status(201).json(order);
});

/**
 * PUT /api/orders/:id
 * Body: { status?, cashCollected? }
 */
app.put('/api/orders/:id',(req,res)=>{
  const idx=orders.findIndex(o=>o.id===+req.params.id);
  if(idx===-1) return res.status(404).json({message:'Not found'});
  const {status,cashCollected}=req.body;
  if(status!==undefined){
    if(!VALID_STATUSES.includes(status)) return res.status(400).json({message:'Invalid status. Must be one of: '+VALID_STATUSES.join(', ')});
    orders[idx].status=status;
  }
  if(cashCollected!==undefined) orders[idx].cashCollected=Boolean(cashCollected);
  orders[idx].updatedAt=new Date().toISOString();
  console.log(`[ORDER ~] #${orders[idx].id} status=${orders[idx].status} cash=${orders[idx].cashCollected}`);
  res.json(orders[idx]);
});

/* ══════════════════════════════════════
   SUMMARY ENDPOINT (employee dashboard)
══════════════════════════════════════ */
app.get('/api/summary',(_,res)=>{
  const today=new Date().toISOString().split('T')[0];
  const todayOrders=orders.filter(o=>o.placedAt&&o.placedAt.startsWith(today));
  res.json({
    todayOrderCount: todayOrders.length,
    todayRevenue:    todayOrders.reduce((s,o)=>s+Number(o.totalAmount),0),
    totalCashCollected: orders.filter(o=>o.cashCollected).reduce((s,o)=>s+Number(o.totalAmount),0),
    pendingOrders:   orders.filter(o=>o.status==='Pending').length,
    totalProducts:   products.length,
    lowStockCount:   products.filter(p=>p.stock<20).length,
  });
});

/* ── 404 & error ── */
app.use((_,res)=>res.status(404).json({message:'Route not found'}));
app.use((err,_,res,__)=>{ console.error(err); res.status(500).json({message:'Internal server error'}); });

app.listen(PORT,()=>{
  console.log('═══════════════════════════════════════════');
  console.log('  Lasya Traders API  v2.0');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Health:  http://localhost:${PORT}/api/health`);
  console.log(`  Orders:  http://localhost:${PORT}/api/orders`);
  console.log(`  Stats:   http://localhost:${PORT}/api/orders/daily-stats`);
  console.log('═══════════════════════════════════════════');
});

module.exports=app;
