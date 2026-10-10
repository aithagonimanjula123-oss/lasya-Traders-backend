const CATEGORIES = new Set(['Soaps','Chocolates','Accessories','Beverages','Snacks']);
const STATUSES = new Set(['Pending','Confirmed','Delivered','Cash Collected']);
const enc = new TextEncoder();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
 status, headers: { 'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer', ...extra }
});
const fail = (message,status=400) => json({message},status);
const now = () => new Date().toISOString();
const productShape = r => ({...r,id:Number(r.id),price:Number(r.price),stock:Number(r.stock)});
const orderShape = r => ({...r,id:Number(r.id),items:JSON.parse(r.items),totalAmount:Number(r.totalAmount),cashCollected:Boolean(r.cashCollected)});
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function issueToken(email,role,secret){
 const payload=b64url(enc.encode(JSON.stringify({email,role,exp:Date.now()+8*60*60*1000})));
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));
 return payload+'.'+b64url(sig);
}
async function readToken(request,env){
 try{
  const raw=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
  const [payload,sig]=raw.split('.'); if(!payload||!sig||!env.AUTH_SECRET)return null;
  const key=await crypto.subtle.importKey('raw',enc.encode(env.AUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const valid=await crypto.subtle.verify('HMAC',key,bytes,enc.encode(payload)); if(!valid)return null;
  const data=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
  return data.exp>Date.now()&&['owner','staff'].includes(data.role)&&typeof data.email==='string'?data:null;
 }catch{return null;}
}

export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method;
  const origin=request.headers.get('origin');
  const allowedOrigin=env.ALLOWED_ORIGIN||url.origin;
  if(origin&&origin!==allowedOrigin)return fail('Origin not allowed',403);
  const headers = { 'access-control-allow-origin':allowedOrigin,'access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS','access-control-allow-headers':'Content-Type,Authorization','vary':'Origin' };
  if(method==='OPTIONS')return new Response(null,{status:204,headers});
  if(method==='GET'&&path==='/api/health')return json({status:'ok',service:'Last Traders API',storage:'Cloudflare D1'},200,headers);
  if(!path.startsWith('/api/'))return fail('Not found',404);
  if(path==='/api/auth/login'&&method==='POST'){
   try{
    if(!env.AUTH_SECRET||!env.OWNER_EMAIL||!env.OWNER_PASSWORD||!env.STAFF_EMAIL||!env.STAFF_PASSWORD)return fail('Authentication is not configured',503);
    const b=await request.json(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),role=b.role;
    const owner=role==='owner'&&email===env.OWNER_EMAIL.toLowerCase()&&password===env.OWNER_PASSWORD;
    const staff=role==='staff'&&email===env.STAFF_EMAIL.toLowerCase()&&password===env.STAFF_PASSWORD;
    if(!owner&&!staff)return fail('Invalid email or password',401);
    return json({token:await issueToken(email,role,env.AUTH_SECRET),user:{email,role}},200,headers);
   }catch{return fail('Invalid login request',400);}
  }
  const auth=await readToken(request,env);
  const write=!['GET','HEAD','OPTIONS'].includes(method);
  if((write||path.startsWith('/api/orders')||path==='/api/summary')&&!auth)return fail('Authentication required',401);
  if(write&&path.startsWith('/api/products')&&auth.role!=='staff')return fail('Staff access required',403);
  if(path==='/api/orders'&&method==='POST'&&auth?.role!=='owner')return fail('Store owner access required',403);
  if(path.startsWith('/api/orders/')&&method==='PUT'&&auth?.role!=='staff')return fail('Staff access required',403);
  if((path==='/api/summary'||path==='/api/orders/daily-stats')&&auth?.role!=='staff')return fail('Staff access required',403);
  try {
   const db = env.DB;
   if (path === '/api/products' && method === 'GET') {
    let sql='SELECT * FROM products'; const clauses=[], args=[];
    const category=url.searchParams.get('category'), search=url.searchParams.get('search');
    if(category && CATEGORIES.has(category)){clauses.push('category = ?');args.push(category);}
    if(search){clauses.push('name LIKE ?');args.push('%'+search.slice(0,100).replace(/[\\%_]/g,'')+'%');}
    if(clauses.length) sql+=' WHERE '+clauses.join(' AND ');
    sql+=' ORDER BY name LIMIT 500';
    const rows=await db.prepare(sql).bind(...args).all();
    return json((rows.results||[]).map(productShape),200,headers);
   }
   if (path === '/api/products' && method === 'POST') {
    const b=await request.json();
    const name=String(b.name||'').trim(), category=String(b.category||'');
    const price=Number(b.price), stock=Number(b.stock);
    if(!name||name.length>160||!CATEGORIES.has(category)||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0) return fail('Invalid product fields');
    const imageUrl=typeof b.imageUrl==='string'&&b.imageUrl.length<2048?b.imageUrl:null;
    const r=await db.prepare('INSERT INTO products(name,category,price,stock,imageUrl,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').bind(name,category,price,stock,imageUrl,now(),now()).run();
    const row=await db.prepare('SELECT * FROM products WHERE id=?').bind(r.meta.last_row_id).first();
    return json(productShape(row),201,headers);
   }
   const pm=path.match(/^\/api\/products\/(\d+)$/);
   if(pm && method==='PUT'){
    const id=Number(pm[1]), b=await request.json(), old=await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first();
    if(!old)return fail('Not found',404);
    const name=String(b.name??old.name).trim(), category=String(b.category??old.category), price=Number(b.price??old.price), stock=Number(b.stock??old.stock);
    if(!name||name.length>160||!CATEGORIES.has(category)||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0)return fail('Invalid product fields');
    const imageUrl=typeof b.imageUrl==='string'?b.imageUrl:old.imageUrl;
    await db.prepare('UPDATE products SET name=?,category=?,price=?,stock=?,imageUrl=?,updatedAt=? WHERE id=?').bind(name,category,price,stock,imageUrl,now(),id).run();
    return json(productShape(await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first()),200,headers);
   }
   if(pm && method==='DELETE'){
    const r=await db.prepare('DELETE FROM products WHERE id=?').bind(Number(pm[1])).run();
    return r.meta.changes?json({success:true},200,headers):fail('Not found',404);
   }
   if(path==='/api/orders' && method==='GET'){
    let sql='SELECT * FROM orders', clauses=[], args=[];
    if(auth.role==='owner'){clauses.push('storeEmail=?');args.push(auth.email);}
    const date=url.searchParams.get('date'),status=url.searchParams.get('status'),cash=url.searchParams.get('cashCollected');
    if(date){clauses.push('substr(placedAt,1,10)=?');args.push(date);}
    if(status&&STATUSES.has(status)){clauses.push('status=?');args.push(status);}
    if(cash==='true'||cash==='false'){clauses.push('cashCollected=?');args.push(cash==='true'?1:0);}
    if(clauses.length)sql+=' WHERE '+clauses.join(' AND ');
    sql+=' ORDER BY placedAt DESC LIMIT 500';
    return json((await db.prepare(sql).bind(...args).all()).results.map(orderShape),200,headers);
   }
   if(path==='/api/orders' && method==='POST'){
    const b=await request.json(), storeName=String(b.storeName||'').trim(), items=b.items;
    const totalAmount=Number(b.totalAmount);
    if(!storeName||storeName.length>160||!Array.isArray(items)||!items.length||items.length>100||!Number.isFinite(totalAmount)||totalAmount<=0)return fail('Invalid order fields');
    const orderItems=JSON.stringify(items);
    const r=await db.prepare('INSERT INTO orders(storeName,storeEmail,storePhone,items,totalAmount,status,paymentMethod,cashCollected,placedAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(storeName,auth.email,typeof b.storePhone==='string'?b.storePhone.slice(0,30):null,orderItems,totalAmount,'Pending','Cash on Delivery',0,typeof b.placedAt==='string'?b.placedAt:now(),now()).run();
    return json(orderShape(await db.prepare('SELECT * FROM orders WHERE id=?').bind(r.meta.last_row_id).first()),201,headers);
   }
   const om=path.match(/^\/api\/orders\/(\d+)$/);
   if(om && method==='GET'){
    const row=await db.prepare('SELECT * FROM orders WHERE id=?').bind(Number(om[1])).first();
    if(!row||(auth.role==='owner'&&row.storeEmail!==auth.email))return fail('Not found',404);
    return json(orderShape(row),200,headers);
   }
   if(om && method==='PUT'){
    const id=Number(om[1]),b=await request.json(),old=await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if(!old)return fail('Not found',404);
    const status=b.status??old.status, cashCollected=b.cashCollected===undefined?old.cashCollected:(b.cashCollected?1:0);
    if(!STATUSES.has(status))return fail('Invalid status');
    await db.prepare('UPDATE orders SET status=?,cashCollected=?,updatedAt=? WHERE id=?').bind(status,cashCollected,now(),id).run();
    return json(orderShape(await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first()),200,headers);
   }
   if(path==='/api/orders/daily-stats' && method==='GET'){
    const days=Math.min(90,Math.max(1,Number.parseInt(url.searchParams.get('days')||'7',10)||7));
    const rows=(await db.prepare("SELECT substr(placedAt,1,10) AS date,COUNT(*) AS count,SUM(totalAmount) AS revenue,SUM(CASE WHEN cashCollected=1 THEN totalAmount ELSE 0 END) AS cashCollected FROM orders WHERE placedAt >= ? GROUP BY substr(placedAt,1,10) ORDER BY date").bind(new Date(Date.now()-days*86400000).toISOString().slice(0,10)).all()).results;
    const byDate=new Map(rows.map(r=>[r.date,r]));
    return json(Array.from({length:days},(_,i)=>{const date=new Date(Date.now()-(days-1-i)*86400000).toISOString().slice(0,10),r=byDate.get(date)||{};return {date,count:Number(r.count||0),revenue:Number(r.revenue||0),cashCollected:Number(r.cashCollected||0)}}),200,headers);
   }
   if(path==='/api/summary' && method==='GET'){
    const today=now().slice(0,10);
    const row=await db.prepare("SELECT COUNT(*) AS todayOrderCount,COALESCE(SUM(totalAmount),0) AS todayRevenue,COALESCE(SUM(CASE WHEN cashCollected=1 THEN totalAmount ELSE 0 END),0) AS totalCashCollected,SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END) AS pendingOrders FROM orders WHERE substr(placedAt,1,10)=?").bind(today).first();
    const prod=await db.prepare('SELECT COUNT(*) AS totalProducts,SUM(CASE WHEN stock<20 THEN 1 ELSE 0 END) AS lowStockCount FROM products').first();
    return json({...row,...prod},200,headers);
   }
   return fail('Route not found',404);
  } catch(e) { console.error('API error',e); return fail('Internal server error',500); }
 }
};
