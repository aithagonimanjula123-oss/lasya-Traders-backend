PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK(category IN ('Soaps','Chocolates','Accessories','Beverages','Snacks')),
  price REAL NOT NULL CHECK(price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  imageUrl TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storeName TEXT NOT NULL CHECK(length(trim(storeName)) BETWEEN 1 AND 160),
  storePhone TEXT,
  items TEXT NOT NULL CHECK(json_valid(items)),
  totalAmount REAL NOT NULL CHECK(totalAmount > 0),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Confirmed','Delivered','Cash Collected')),
  paymentMethod TEXT NOT NULL DEFAULT 'Cash on Delivery',
  cashCollected INTEGER NOT NULL DEFAULT 0 CHECK(cashCollected IN (0,1)),
  placedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_orders_placedAt ON orders(placedAt);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
