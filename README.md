# Allo Inventory & Order-Fulfillment Platform

Welcome to the **Allo Inventory & Order-Fulfillment Suite** — a high-performance Next.js application built to handle high-concurrency checkout locks and real-time inventory reservations for multi-warehouse retail brands.

This application protects checkout stock allocations against race conditions, handles pending checkout lock counts, manages locks with countdown timers, triggers live UI transitions without full page refreshes, and features comprehensive bulk/lazy holds cleanup alongside request idempotency protection.

---

## 🚀 Quick Start (Local Setup)

To spin up the Allo telemetry and inventory dashboard locally:

### 1. Clone & Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure your **hosted PostgreSQL database URL** (e.g. from Neon or Supabase) is set in `.env`:
```env
DATABASE_URL="postgresql://user:password@host:port/dbname?schema=public"
```

### 3. Run Database Migrations
Prisma 7 reads schema models and applies Postgres migrations directly using the configuration loaded from `prisma.config.ts`:
```bash
npx prisma migrate dev --name init
```

### 4. Seed the Database
Deploy sample warehouses, telemetry products, and active starting stock:
```bash
npx prisma db seed
```

### 5. Run the Local Server
Launch the local development environment:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to interact with the dashboard.

---

## ⚡ Concurrency Control Strategy

To prevent race conditions where two concurrent shoppers pay for the same physical unit when stock is low, the reservation endpoint (`POST /api/reservations`) uses an **Atomic Row-Level Database Update**.

Instead of executing a separate `SELECT` query followed by a conditional `UPDATE` query (which creates an unsafe race window between the read and write), we run a single, atomic SQL statement inside a transaction:

```sql
UPDATE "Stock"
SET "reservedUnits" = "reservedUnits" + :quantity
WHERE "productId" = :productId
  AND "warehouseId" = :warehouseId
  AND "totalUnits" - "reservedUnits" >= :quantity
```

### Why this is 100% Race-Condition-Free:
1. **Row Lock Exclusion**: When PostgreSQL executes this `UPDATE` query, it acquires a write lock on the target stock row. 
2. **Sequential Evaluation**: Any concurrent transaction trying to write to the same row is blocked and queued. 
3. **Condition Re-evaluation**: Once the first transaction commits, the next queued transaction resumes, but it evaluates the `WHERE` condition (`totalUnits - reservedUnits >= quantity`) against the *newly updated* state.
4. **Instant Detection**: If the first transaction holds the last remaining unit, the second transaction's `WHERE` check will evaluate to false, affecting `0` rows.
5. **No-Lock Overheads**: If `affectedRows` is `0`, we roll back the transaction and instantly return `409 Conflict`. No long-running explicit table locks (`LOCK TABLE`) are needed, ensuring massive throughput.

---

## ⏱️ Reservation Expiry Architecture

Allo utilizes a **dual-layered cleanup architecture** to ensure that expired reservations release their held stock back to the active pool reliably, without leaking units:

### Layer 1: Lazy Cleanup on Read (High Reliability)
Every time a client queries the product catalog (`GET /api/products`) or attempts to allocate new stock, the server automatically executes a fast pre-flight cleanup:
* It queries for any active `PENDING` reservation where `expiresAt < NOW()`.
* It transitions their state to `RELEASED` and decrements `reservedUnits` on the stock table accordingly.
* This guarantees that shoppers **always** see 100% accurate available stock levels in real-time, even if background cleanups are delayed.

### Layer 2: Active Bulk Worker (Production Scheduled)
We expose a dedicated endpoint `/api/cron/cleanup`. In production, this can be triggered by a Vercel Cron, GitHub Action, or Upstash scheduler every minute.
* It bulk-releases all expired `PENDING` reservations in a single batch.
* Keeps the database clean and pruned of stale rows, maintaining query performance.

---

## 🛡️ Request Idempotency (Bonus)

To prevent duplicate reservations and double-charges from network retries, `POST /api/reservations` and `POST /api/reservations/:id/confirm` fully support the `Idempotency-Key` header:

1. We use a dedicated **`IdempotencyKey`** table in our Postgres database.
2. When a request with the header arrives:
   * **Key Lookup**: If it exists and status is `COMPLETED`, the server returns the cached response instantly with an `x-idempotency-cache: HIT` header.
   * **Concurrent Retry Check**: If the status is `PROCESSING`, it means a simultaneous request with the same key is active, and we return a `409 Conflict`.
   * **New Key Provision**: If it doesn't exist, we insert a `PROCESSING` key.
3. **Response Caching**: After executing the core allocation/payment transaction, we update the key's state in the database to `COMPLETED` and serialize the final status and response body.

---

## 🧪 Concurrency Validation Suite

We have written an automated concurrency test script at `scripts/test-concurrency.ts`. 

To verify race protection:
```bash
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/test-concurrency.ts
```

### What the test does:
1. Provisions a clean test SKU `CONCURRENCY-TEST-SKU` with exactly **1 unit of stock**.
2. Spawns **50 concurrent holds simultaneously** using parallel `Promise.all` transaction executions.
3. Asserts that:
   * **Exactly 1** request succeeds.
   * **Exactly 49** requests fail with an insufficient stock error.
   * The final stock level has exactly `1` reserved unit, and the database contains exactly `1` pending reservation record.

---

## 🎨 Premium UI/UX Aesthetics

The frontend is designed to deliver a high-end, premium experience mirroring cutting-edge retail platforms:
* **Deep Space Palette**: Seamless slate-950 and indigo-500 gradients tailored for premium high-fidelity dark modes.
* **Glassmorphic Paneling**: Blurry backdrops (`backdrop-blur-md`) with custom glowing border hovers.
* **Live Dynamic Telemetry**: Product cards display real-time inventory counts across different warehouses, allowing instant warehouse routing.
* **Micro-Animations**: Breathing glows, floating card indicators, and linear shimmers when actions submit.
* **Checkout Lock Timer**: A glowing checkout screen featuring a live ticking countdown and an animated progress bar that turns red under 60 seconds.
* **Detailed Error Overlays**: If a reservation expires, a dedicated `410 Expiry Alert` overlay reveals itself instantly, guiding the user back to the catalog.

---

## 🛠️ Trade-offs & Future Enhancements

With more time, we would implement:
1. **Redis Lock Layer**: While atomic database updates work flawlessly for single-record holds in Postgres, high-volume multi-product checkout baskets are best managed by a distributed memory store lock (like Redlock on Redis).
2. **Transaction Ledgering**: Instead of updating a static stock count in the `Stock` table directly, a production-grade system should write to an **immutable ledger of stock events** (Incoming, Allocated, Shipped) and derive counts, ensuring a complete financial audit trail.
3. **Database Partitioning**: Partitioning the `Reservation` table by `createdAt` monthly to prune millions of expired reservations without locking active tables.
