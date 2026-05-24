"use client";

import { useEffect, useState, startTransition } from "react";
import Link from "next/link";
import { 
  Package, 
  Layers, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw, 
  CreditCard,
  Building2,
  Sparkles,
  ArrowRight
} from "lucide-react";

interface Stock {
  id: string;
  warehouseId: string;
  warehouseName: string;
  location: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  imageUrl: string | null;
  stocks: Stock[];
}

interface ReservationSummary {
  id: string;
  productName: string;
  warehouseName: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: string;
}

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  title?: string;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reservations, setReservations] = useState<ReservationSummary[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Selection state per product ID
  const [selectedWarehouse, setSelectedWarehouse] = useState<Record<string, string>>({});
  const [reserveQuantity, setReserveQuantity] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  // 1. Fetch products and active reservations on mount
  const fetchCatalog = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = await res.json();
      setProducts(data);

      // Set default warehouse & quantity selection for each product
      const defaultsWarehouse: Record<string, string> = {};
      const defaultsQuantity: Record<string, number> = {};

      data.forEach((p: Product) => {
        if (p.stocks.length > 0) {
          defaultsWarehouse[p.id] = p.stocks[0].warehouseId;
        }
        defaultsQuantity[p.id] = 1;
      });

      setSelectedWarehouse((prev) => ({ ...defaultsWarehouse, ...prev }));
      setReserveQuantity((prev) => ({ ...defaultsQuantity, ...prev }));
    } catch (err) {
      showToast("error", "Failed to connect to inventory server. Ensure DATABASE_URL is set in .env", "Connection Error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
    // Load local reservations from session state to keep them visible
    const saved = localStorage.getItem("allo_reservations");
    if (saved) {
      try {
        setReservations(JSON.parse(saved));
      } catch (e) {
        // Ignore
      }
    }
  }, []);

  // Sync reservations to localStorage
  const saveReservations = (updated: ReservationSummary[]) => {
    setReservations(updated);
    localStorage.setItem("allo_reservations", JSON.stringify(updated));
  };

  // 2. Toast controller
  const showToast = (type: "success" | "error" | "info", message: string, title?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, title }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  };

  // 3. Trigger a reservation
  const handleReserve = async (productId: string) => {
    const warehouseId = selectedWarehouse[productId];
    const quantity = reserveQuantity[productId] || 1;

    if (!warehouseId) {
      showToast("error", "Please select a warehouse first.");
      return;
    }

    setSubmitting((prev) => ({ ...prev, [productId]: true }));

    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ productId, warehouseId, quantity }),
      });

      const data = await res.json();

      if (res.status === 201) {
        showToast(
          "success",
          `Reserved ${quantity} units of ${data.reservation.productName} at ${data.reservation.warehouseName}! Expiring in 10 minutes.`,
          "Hold Successful"
        );

        // Add to active reservations list
        const newRes: ReservationSummary = {
          id: data.reservation.id,
          productName: data.reservation.productName,
          warehouseName: data.reservation.warehouseName,
          quantity: data.reservation.quantity,
          status: "PENDING",
          expiresAt: data.reservation.expiresAt,
        };

        saveReservations([newRes, ...reservations]);
        
        // Refresh catalog to reflect new holds
        await fetchCatalog(true);
      } else if (res.status === 409) {
        showToast(
          "error",
          "There is not enough available stock in the selected warehouse for this request.",
          "Stock Conflict (409)"
        );
      } else {
        showToast("error", data.error || "Reservation failed", "Error");
      }
    } catch (error) {
      showToast("error", "Network request failed. Try again.", "Network Error");
    } finally {
      setSubmitting((prev) => ({ ...prev, [productId]: false }));
    }
  };

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-md w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-2xl border glass-panel animate-float flex gap-3 ${
              toast.type === "error"
                ? "border-red-500/20 bg-red-950/20"
                : toast.type === "success"
                ? "border-green-500/20 bg-green-950/20"
                : "border-indigo-500/20 bg-indigo-950/20"
            }`}
          >
            <div className="mt-0.5">
              {toast.type === "error" ? (
                <AlertTriangle className="h-5 w-5 text-red-400" />
              ) : toast.type === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : (
                <Clock className="h-5 w-5 text-indigo-400" />
              )}
            </div>
            <div className="flex-1">
              {toast.title && <h4 className="font-semibold text-sm text-white mb-0.5">{toast.title}</h4>}
              <p className="text-xs text-slate-300 font-medium leading-relaxed">{toast.message}</p>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-slate-400 hover:text-white text-sm self-start font-bold"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Header Banner */}
      <header className="relative mb-12 text-center sm:text-left sm:flex sm:items-center sm:justify-between border-b border-slate-800 pb-8">
        <div>
          <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
            <span className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 flex items-center gap-1 animate-pulse-subtle">
              <Sparkles className="h-3 w-3" /> Live Control
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl bg-gradient-to-r from-white via-slate-100 to-indigo-400 bg-clip-text text-transparent">
            Allo Fulfillment Suite
          </h1>
          <p className="mt-2 text-sm text-slate-400 font-medium">
            Multi-warehouse real-time inventory management protected by atomic transactional reservation logic.
          </p>
        </div>
        <div className="mt-6 sm:mt-0 flex justify-center sm:justify-end">
          <button
            onClick={() => fetchCatalog()}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Catalog
          </button>
        </div>
      </header>

      {/* Core Layout */}
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left/Middle: Product Catalog */}
        <section className="lg:col-span-2 space-y-8">
          <div className="flex items-center gap-2 mb-4">
            <Package className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Stock Catalog</h2>
          </div>

          {loading ? (
            <div className="h-96 flex flex-col items-center justify-center border border-slate-800 rounded-2xl bg-slate-900/20 glass-panel">
              <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin mb-4" />
              <p className="text-xs text-slate-400 font-semibold animate-pulse">Initializing Allo Telemetry...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="h-96 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-2xl p-8 text-center bg-slate-900/10">
              <AlertTriangle className="h-10 w-10 text-indigo-400/50 mb-4 animate-float" />
              <h3 className="font-bold text-white mb-1">Database Not Seeded</h3>
              <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
                Connect your hosted PostgreSQL database in <code className="px-1.5 py-0.5 rounded bg-slate-950 font-mono">.env</code>, run migrations, and execute the seed command.
              </p>
              <div className="text-left font-mono text-[10px] text-slate-500 p-4 rounded bg-slate-950 border border-slate-900">
                DATABASE_URL="your-postgres-url"<br/>
                npx prisma migrate dev<br/>
                npx prisma db seed
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {products.map((product) => {
                const whId = selectedWarehouse[product.id] || "";
                const qty = reserveQuantity[product.id] || 1;
                const isSubmitting = submitting[product.id] || false;
                const activeStock = product.stocks.find(s => s.warehouseId === whId);
                const hasStock = activeStock ? activeStock.availableUnits >= qty : false;

                return (
                  <article key={product.id} className="glass-panel border border-slate-800/80 rounded-2xl overflow-hidden flex flex-col h-full group">
                    {/* Visual Card Image/Banner */}
                    <div className="h-40 relative bg-slate-900 overflow-hidden">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img 
                          src={product.imageUrl} 
                          alt={product.name}
                          className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-slate-950 to-indigo-950">
                          <Package className="h-12 w-12 text-indigo-500/20" />
                        </div>
                      )}
                      <div className="absolute top-3 right-3 px-2 py-1 text-[10px] font-bold rounded-md bg-slate-950/80 border border-slate-800 text-slate-300">
                        {product.sku}
                      </div>
                      <div className="absolute bottom-3 left-3">
                        <span className="text-xl font-black text-white glow-text-indigo">
                          ${product.price.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="p-5 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="text-base font-bold text-white mb-2 leading-snug">{product.name}</h3>
                        <p className="text-xs text-slate-400 font-medium leading-relaxed mb-6">{product.description}</p>
                      </div>

                      <div className="space-y-4">
                        {/* Stock per Warehouse breakdown */}
                        <div className="border border-slate-800/60 rounded-xl overflow-hidden bg-slate-950/40">
                          <div className="grid grid-cols-3 gap-1 px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
                            <div>Warehouse</div>
                            <div className="text-center">Reserved</div>
                            <div className="text-right">Available</div>
                          </div>
                          <div className="divide-y divide-slate-800/40">
                            {product.stocks.map((stock) => (
                              <div key={stock.id} className="grid grid-cols-3 gap-1 px-3 py-2.5 text-xs font-semibold items-center">
                                <div className="text-slate-300 truncate" title={stock.warehouseName}>
                                  {stock.warehouseName.split(" Fulfillment")[0]}
                                </div>
                                <div className="text-center font-mono text-indigo-400">
                                  {stock.reservedUnits} <span className="text-[10px] text-slate-600">/ {stock.totalUnits}</span>
                                </div>
                                <div className={`text-right font-mono ${stock.availableUnits > 0 ? "text-green-400 font-bold" : "text-rose-500 font-normal"}`}>
                                  {stock.availableUnits}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Interactive Hold Form */}
                        <div className="pt-2 border-t border-slate-800/40 space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Source</label>
                              <select
                                value={whId}
                                onChange={(e) => setSelectedWarehouse((prev) => ({ ...prev, [product.id]: e.target.value }))}
                                className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                              >
                                {product.stocks.map((stock) => (
                                  <option key={stock.warehouseId} value={stock.warehouseId}>
                                    {stock.warehouseName.includes("US-WEST") ? "US-WEST (SF)" : "US-EAST (NY)"}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Quantity</label>
                              <input
                                type="number"
                                min={1}
                                max={99}
                                value={qty}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value) || 1);
                                  setReserveQuantity((prev) => ({ ...prev, [product.id]: val }));
                                }}
                                className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>

                          <button
                            onClick={() => handleReserve(product.id)}
                            disabled={isSubmitting || !hasStock}
                            className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                              hasStock 
                                ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/10 cursor-pointer" 
                                : "bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed"
                            }`}
                          >
                            {isSubmitting ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                Reserving...
                              </>
                            ) : (
                              <>
                                <Clock className="h-3.5 w-3.5" />
                                {hasStock ? "Reserve Stock" : "Out of Stock"}
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Panel: Active Reservations */}
        <section className="space-y-8">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Active Reservations</h2>
          </div>

          <div className="glass-panel border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Holds Log</span>
              <button
                onClick={() => {
                  saveReservations([]);
                  showToast("info", "Cleared local reservation log.");
                }}
                className="text-[10px] font-semibold text-slate-400 hover:text-white"
              >
                Clear Log
              </button>
            </div>

            {reservations.length === 0 ? (
              <div className="py-12 text-center">
                <Clock className="h-8 w-8 text-slate-700 mx-auto mb-3 animate-float" />
                <h4 className="text-xs font-bold text-slate-400 mb-1">No Active Holds</h4>
                <p className="text-[10px] text-slate-500 max-w-[200px] mx-auto leading-relaxed">
                  Reserve a product from the catalog to temporarily secure stock.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {reservations.map((res) => {
                  const isPending = res.status === "PENDING";
                  const isConfirmed = res.status === "CONFIRMED";
                  const isReleased = res.status === "RELEASED";

                  return (
                    <div 
                      key={res.id} 
                      className={`p-3 rounded-xl border flex flex-col justify-between gap-3 text-xs ${
                        isConfirmed 
                          ? "bg-green-950/10 border-green-500/10" 
                          : isReleased 
                          ? "bg-slate-900/40 border-slate-800/80" 
                          : "bg-indigo-950/10 border-indigo-500/10"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <h4 className="font-bold text-white truncate max-w-[160px]">{res.productName}</h4>
                          <p className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-slate-500" /> {res.warehouseName.split(" Fulfillment")[0]}
                          </p>
                          <p className="text-[10px] font-bold text-indigo-400 font-mono">Qty: {res.quantity}</p>
                        </div>
                        
                        {/* Status pill */}
                        <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-md tracking-wider flex items-center gap-0.5 ${
                          isConfirmed 
                            ? "bg-green-500/10 text-green-400 border border-green-500/20" 
                            : isReleased 
                            ? "bg-slate-800 text-slate-400 border border-slate-700" 
                            : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse-subtle"
                        }`}>
                          {isConfirmed ? (
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          ) : isReleased ? (
                            <XCircle className="h-2.5 w-2.5" />
                          ) : (
                            <Clock className="h-2.5 w-2.5" />
                          )}
                          {res.status}
                        </span>
                      </div>

                      {/* Pending Action Link */}
                      {isPending && (
                        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
                          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[100px]">{res.id}</span>
                          <Link 
                            href={`/checkout/${res.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
                          >
                            <CreditCard className="h-3 w-3" /> Checkout
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                      )}

                      {!isPending && (
                        <div className="text-[9px] text-slate-500 font-mono truncate">
                          ID: {res.id}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
