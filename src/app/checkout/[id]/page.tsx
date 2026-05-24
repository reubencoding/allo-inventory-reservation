"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  Lock, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  ArrowLeft,
  Building2,
  Package,
  ShoppingBag,
  RefreshCw,
  CreditCard as CardIcon,
  QrCode,
  ShieldCheck,
  Sparkles
} from "lucide-react";

interface Reservation {
  id: string;
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  status: "PENDING" | "CONFIRMED" | "RELEASED";
  expiresAt: string;
}

export default function CheckoutPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const id = params.id;
  const router = useRouter();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  
  // Real-time countdown state
  const [timeLeft, setTimeLeft] = useState<number>(0); 
  const [totalDuration, setTotalDuration] = useState<number>(600); 

  // Payment Form States
  const [paymentMethod, setPaymentMethod] = useState<"card" | "upi" | "apple">("card");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [upiId, setUpiId] = useState("");
  
  // Simulated gateway progress
  const [gatewayStep, setGatewayStep] = useState<string>("");

  // 1. Fetch reservation details on mount
  const fetchReservation = async () => {
    try {
      const res = await fetch(`/api/reservations/${id}`);
      if (res.status === 404) {
        setError("Reservation hold not found or invalid.");
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to fetch reservation");
      }
      const data = await res.json();
      setReservation(data);

      if (data.status === "PENDING") {
        const expiry = new Date(data.expiresAt).getTime();
        const now = Date.now();
        const diffSeconds = Math.max(0, Math.floor((expiry - now) / 1000));
        setTimeLeft(diffSeconds);
        
        const createdApprox = expiry - (10 * 60 * 1000);
        const totalSecs = Math.max(1, Math.floor((expiry - createdApprox) / 1000));
        setTotalDuration(totalSecs);
      }
    } catch (err) {
      setError("An unexpected error occurred while loading this checkout session.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservation();
  }, [id]);

  // 2. Ticking Countdown effect
  useEffect(() => {
    if (!reservation || reservation.status !== "PENDING" || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setReservation((prevRes) => prevRes ? { ...prevRes, status: "RELEASED" } : null);
          updateLocalReservationStatus(id, "RELEASED");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [reservation, timeLeft]);

  // Sync state back to localStorage list
  const updateLocalReservationStatus = (resId: string, status: "PENDING" | "CONFIRMED" | "RELEASED") => {
    const saved = localStorage.getItem("allo_reservations");
    if (saved) {
      try {
        const list: any[] = JSON.parse(saved);
        const updated = list.map((item) => 
          item.id === resId ? { ...item, status } : item
        );
        localStorage.setItem("allo_reservations", JSON.stringify(updated));
      } catch (e) {
        // Ignore
      }
    }
  };

  // 3. Confirm Reservation with Simulated Gateway Delays
  const handleConfirm = async () => {
    if (!reservation) return;
    setConfirming(true);

    const steps = [
      "Contacting secure payment gateway...",
      "Initiating 3D Secure 2.2 authorization...",
      "Resolving multi-warehouse inventory allocation...",
      "Finalizing debit and database ledgering..."
    ];

    // Simulate real 3DS verification steps before calling backend API
    for (let i = 0; i < steps.length; i++) {
      setGatewayStep(steps[i]);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": idempotencyKey,
        },
      });

      const data = await res.json();

      if (res.status === 200) {
        setReservation((prev) => prev ? { ...prev, status: "CONFIRMED" } : null);
        updateLocalReservationStatus(id, "CONFIRMED");
      } else if (res.status === 410) {
        setReservation((prev) => prev ? { ...prev, status: "RELEASED" } : null);
        updateLocalReservationStatus(id, "RELEASED");
        setError("RESERVATION_EXPIRED");
      } else {
        alert(data.error || "Failed to confirm purchase.");
      }
    } catch (err) {
      alert("Network error. Please try confirming again.");
    } finally {
      setConfirming(false);
      setGatewayStep("");
    }
  };

  // 4. Release Reservation early (Cancel purchase)
  const handleRelease = async () => {
    if (!reservation) return;
    if (!confirm("Are you sure you want to cancel this checkout session? This will immediately release the stock back to other shoppers.")) return;
    setReleasing(true);

    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: "POST",
      });

      const data = await res.json();

      if (res.status === 200) {
        setReservation((prev) => prev ? { ...prev, status: "RELEASED" } : null);
        updateLocalReservationStatus(id, "RELEASED");
      } else {
        alert(data.error || "Failed to release reservation hold.");
      }
    } catch (err) {
      alert("Network error. Please try again.");
    } finally {
      setReleasing(false);
    }
  };

  // Helper formatting for seconds remaining
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  };

  // Input Formatting Helpers
  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || "";
    const parts = [];

    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }

    if (parts.length > 0) {
      return parts.join(" ");
    } else {
      return v;
    }
  };

  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    if (v.length >= 2) {
      return `${v.slice(0, 2)}/${v.slice(2, 4)}`;
    }
    return v;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin mb-4" />
        <p className="text-xs text-slate-400 font-semibold animate-pulse">Establishing Secure Payment Gateway...</p>
      </div>
    );
  }

  // Handle standard page errors
  if (error && error !== "RESERVATION_EXPIRED") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <XCircle className="h-12 w-12 text-rose-500 mb-4 animate-float" />
        <h2 className="text-lg font-bold text-white mb-2">Checkout Error</h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-6">{error}</p>
        <Link 
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Return to Catalog
        </Link>
      </div>
    );
  }

  // Handle 410 Reservation Expired
  if (error === "RESERVATION_EXPIRED") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="relative mb-6">
          <Clock className="h-16 w-16 text-rose-500 animate-pulse-subtle" />
          <AlertTriangle className="h-6 w-6 text-rose-400 absolute -bottom-1 -right-1 bg-slate-950 rounded-full" />
        </div>
        <h2 className="text-xl font-black text-rose-400 tracking-wide mb-2 uppercase">Lock Window Expired (410)</h2>
        <p className="text-xs text-slate-300 leading-relaxed mb-6 max-w-xs mx-auto">
          The payment timer has run out. The units held for you have been automatically released back to the stock catalog to prevent abandoned checkout deadlocks.
        </p>
        <Link 
          href="/"
          className="inline-flex items-center gap-2 px-5 py-3 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/20 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Re-Reserve Item
        </Link>
      </div>
    );
  }

  const { productName, warehouseName, quantity, status } = reservation!;
  const isPending = status === "PENDING";
  const isConfirmed = status === "CONFIRMED";
  const isReleased = status === "RELEASED";

  // Calculate visual progress bar percentage
  const percentage = Math.max(0, Math.min(100, (timeLeft / totalDuration) * 100));

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* 3DS Simulated Verification Modal Overlay */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="glass-panel border border-indigo-500/20 max-w-md w-full p-8 rounded-2xl text-center shadow-2xl relative overflow-hidden space-y-6">
            <div className="absolute top-0 left-0 w-full h-1 bg-slate-800">
              <div className="h-full bg-indigo-500 animate-shimmer w-1/2" />
            </div>
            
            <ShieldCheck className="h-14 w-14 text-indigo-400 mx-auto animate-float" />
            
            <div className="space-y-2">
              <h3 className="font-bold text-white text-base flex items-center justify-center gap-1.5">
                <Lock className="h-4 w-4 text-indigo-400" />
                3D Secure Verification
              </h3>
              <p className="text-xs text-slate-400 font-medium">Securing allocation from bank & warehouse...</p>
            </div>

            <div className="flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-slate-900 border border-slate-800">
              <RefreshCw className="h-4 w-4 text-indigo-500 animate-spin" />
              <span className="text-xs text-slate-200 font-mono font-bold animate-pulse">{gatewayStep}</span>
            </div>
          </div>
        </div>
      )}

      <Link 
        href="/"
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white mb-8 self-start transition font-bold"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Catalog
      </Link>

      {isPending && (
        <div className="space-y-6">
          {/* Lock Badge banner */}
          <div className="flex items-center justify-center gap-2 p-3 rounded-xl border border-indigo-500/20 bg-indigo-950/10 text-indigo-400 text-xs font-bold tracking-wide animate-pulse-subtle">
            <Lock className="h-4 w-4" /> Secure Inventory Lock Activated
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
            {/* Left: Summary Details Card (2/5 size) */}
            <div className="lg:col-span-2 space-y-6">
              {/* Summary */}
              <div className="glass-panel border border-slate-800 rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2 pb-4 border-b border-slate-800/80">
                  <ShoppingBag className="h-5 w-5 text-indigo-400" />
                  <h2 className="text-base font-bold text-white">Purchase Summary</h2>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Package className="h-5 w-5 text-slate-500 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-white text-sm">{productName}</h4>
                      <p className="text-[10px] font-bold text-indigo-400 font-mono mt-0.5">Quantity: {quantity} Unit{quantity > 1 ? "s" : ""}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 pt-4 border-t border-slate-800/40">
                    <Building2 className="h-5 w-5 text-slate-500 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-white text-xs leading-snug">{warehouseName}</h4>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">Fulfillment Center Source</p>
                    </div>
                  </div>
                </div>

                {/* Secure lock telemetry status */}
                <div className="pt-5 border-t border-slate-800/40 font-mono text-[9px] text-slate-500 space-y-1">
                  <div>HOLD_ID: {id}</div>
                  <div>SECURE_TRANS_VER: TLS_1.3_AES_256</div>
                </div>
              </div>

              {/* Countdown clock card */}
              <div className="glass-panel border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-slate-900">
                  <div 
                    className={`h-full transition-all duration-1000 ${
                      timeLeft < 60 
                        ? "bg-rose-500 animate-pulse" 
                        : timeLeft < 180 
                        ? "bg-amber-500" 
                        : "bg-indigo-500"
                    }`} 
                    style={{ width: `${percentage}%` }}
                  />
                </div>

                <Clock className={`h-8 w-8 mb-4 ${timeLeft < 60 ? "text-rose-400 animate-pulse" : "text-indigo-400"}`} />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Hold Expires In</span>
                <span className={`text-4xl font-black font-mono tracking-tight leading-none mb-4 ${
                  timeLeft < 60 
                    ? "text-rose-400 glow-text-rose animate-pulse" 
                    : timeLeft < 180 
                    ? "text-amber-400" 
                    : "text-white glow-text-indigo"
                }`}>
                  {formatTime(timeLeft)}
                </span>

                <p className="text-[10px] text-slate-400 font-medium leading-relaxed max-w-[170px]">
                  Complete payment before the timer expires to secure allocation.
                </p>
              </div>
            </div>

            {/* Right: Payment Portal (3/5 size) */}
            <div className="lg:col-span-3 glass-panel border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex items-center gap-2 pb-4 border-b border-slate-800/80">
                <ShieldCheck className="h-5 w-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white">Allo Secure Payment Gateway</h2>
              </div>

              {/* Payment Methods tabs */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("card")}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    paymentMethod === "card"
                      ? "bg-indigo-600 text-white border border-indigo-500/30"
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  <CardIcon className="h-3.5 w-3.5" />
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("upi")}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    paymentMethod === "upi"
                      ? "bg-indigo-600 text-white border border-indigo-500/30"
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  UPI / QR
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("apple")}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    paymentMethod === "apple"
                      ? "bg-indigo-600 text-white border border-indigo-500/30"
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Apple Pay
                </button>
              </div>

              {/* Card Form */}
              {paymentMethod === "card" && (
                <div className="space-y-6">
                  {/* Glowing Credit Card Mockup */}
                  <div className="relative h-44 rounded-2xl p-5 bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 border border-indigo-500/10 shadow-2xl overflow-hidden flex flex-col justify-between max-w-sm mx-auto w-full group">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(99,102,241,0.15),transparent_60%)] pointer-events-none" />
                    
                    <div className="flex justify-between items-start">
                      <div className="h-9 w-12 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center overflow-hidden">
                        <div className="h-6 w-8 bg-amber-500/20 rounded relative" />
                      </div>
                      <CardIcon className="h-7 w-7 text-indigo-400/80" />
                    </div>

                    <div className="space-y-3">
                      {/* Card Number display */}
                      <span className="text-base font-mono font-bold tracking-widest text-slate-100 block">
                        {cardNumber || "•••• •••• •••• ••••"}
                      </span>

                      <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                        <div>
                          <span className="text-slate-500 uppercase block tracking-wider mb-0.5">Cardholder</span>
                          <span className="text-slate-300 uppercase truncate max-w-[160px] block">
                            {cardName || "YOUR NAME"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 uppercase block tracking-wider mb-0.5">Expires</span>
                          <span className="text-slate-300 block">
                            {cardExpiry || "MM/YY"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Cardholder Name</label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Card Number</label>
                      <input
                        type="text"
                        placeholder="4111 2222 3333 4444"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                        className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        maxLength={19}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Expiry Date</label>
                        <input
                          type="text"
                          placeholder="MM/YY"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                          className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          maxLength={5}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">CVV</label>
                        <input
                          type="password"
                          placeholder="•••"
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/[^0-9]/gi, ""))}
                          className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          maxLength={3}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* UPI Form */}
              {paymentMethod === "upi" && (
                <div className="space-y-6 text-center py-4">
                  {/* Fake QR Mock */}
                  <div className="h-32 w-32 bg-white rounded-xl border-4 border-slate-800 p-2 mx-auto flex items-center justify-center relative group">
                    <QrCode className="h-full w-full text-slate-950" />
                    <div className="absolute inset-0 bg-slate-950/80 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300">
                      <span className="text-[10px] font-bold text-white px-2 text-center">Scan to Pay</span>
                    </div>
                  </div>

                  <div className="max-w-xs mx-auto space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 text-left">Or Enter UPI ID</label>
                    <input
                      type="text"
                      placeholder="allo@ybl"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Apple Pay Form */}
              {paymentMethod === "apple" && (
                <div className="py-12 text-center space-y-4">
                  <div className="h-12 w-full max-w-xs mx-auto rounded-xl bg-white text-black flex items-center justify-center gap-1 hover:bg-slate-100 transition shadow-lg shadow-white/5 cursor-pointer">
                    <span className="font-extrabold text-sm font-sans tracking-tight"> Pay</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">Native payment integration mock</p>
                </div>
              )}

              {/* Pay and cancel triggers */}
              <div className="space-y-4 pt-4 border-t border-slate-800/40">
                <button
                  onClick={handleConfirm}
                  disabled={confirming || releasing}
                  className="w-full py-3.5 px-6 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  Pay & Confirm Allocation
                </button>

                <button
                  onClick={handleRelease}
                  disabled={confirming || releasing}
                  className="w-full py-3 px-6 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white hover:border-slate-600 transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <XCircle className="h-3.5 w-3.5 text-rose-500" />
                  Cancel & Release Hold
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmed Screen */}
      {isConfirmed && (
        <div className="glass-panel border border-green-500/20 bg-green-950/5 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-6">
          <div className="relative inline-block mb-2">
            <CheckCircle2 className="h-16 w-16 text-green-400 animate-float" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-extrabold text-white bg-gradient-to-r from-white to-green-400 bg-clip-text text-transparent">
              Order Confirmed!
            </h2>
            <p className="text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
              Your payment succeeded and the inventory allocation has been permanently committed. Your package is routing to shipping.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-900 text-left font-semibold space-y-2.5 max-w-sm mx-auto text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Order ID:</span>
              <span className="text-white font-mono">{id.substring(0, 18)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Item:</span>
              <span className="text-slate-300 font-bold">{productName} (Qty: {quantity})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Source:</span>
              <span className="text-slate-300">{warehouseName.split(" Fulfillment")[0]}</span>
            </div>
          </div>

          <Link 
            href="/"
            className="inline-flex items-center gap-2 px-5 py-3 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/20 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Return to Catalog
          </Link>
        </div>
      )}

      {/* Released Screen */}
      {isReleased && (
        <div className="glass-panel border border-slate-800 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-6">
          <XCircle className="h-16 w-16 text-slate-600 mx-auto mb-2 animate-float" />

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Hold Released</h2>
            <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
              This checkout session has been cancelled or timed out. The reserved units have been securely returned to available stock pools.
            </p>
          </div>

          <Link 
            href="/"
            className="inline-flex items-center gap-2 px-5 py-3 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/20 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
