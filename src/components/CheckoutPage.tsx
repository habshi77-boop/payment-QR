import React, {useEffect, useState} from 'react';
import {ArrowLeft, CheckCircle2, Lock, ShieldCheck, Smartphone} from 'lucide-react';
import type {GatewayConfig, PaymentMethod, PaymentTransaction} from '../types/payment';

interface CheckoutPageProps {
  orderId: string;
  onExitCheckout: () => void;
}

const METHODS: {id: PaymentMethod; label: string; desc: string}[] = [
  {id: 'UPI Intent', label: 'UPI App', desc: 'GPay, PhonePe, Paytm, BHIM'},
  {id: 'UPI QR', label: 'UPI QR', desc: 'Instant scan & verify'},
];

export const CheckoutPage: React.FC<CheckoutPageProps> = ({orderId, onExitCheckout}) => {
  const [tx, setTx] = useState<PaymentTransaction | null>(null);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [upiUri, setUpiUri] = useState<string>('');
  const [payerName, setPayerName] = useState<string>('');
  const [payerPhone, setPayerPhone] = useState<string>('');
  const [payerVpa, setPayerVpa] = useState<string>('');
  const [method, setMethod] = useState<PaymentMethod>('UPI Intent');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/payments/${encodeURIComponent(orderId)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Payment order not found');
        return res.json();
      })
      .then((data: {transaction: PaymentTransaction; config: GatewayConfig; upiUri: string}) => {
        setTx(data.transaction);
        setConfig(data.config);
        setUpiUri(data.upiUri);
        setPayerName(
          data.transaction.payerName === 'Awaiting Customer' ? '' : data.transaction.payerName
        );
        if (data.transaction.payerPhone) {
          setPayerPhone(data.transaction.payerPhone);
        }
        if (data.transaction.status === 'CONFIRMED') {
          setPaid(true);
        }
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  const handlePayNow = async () => {
    if (!tx) return;
    setPaying(true);
    setError('');
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          orderId: tx.orderId,
          payerName: payerName.trim() || 'UPI Customer',
          payerPhone: payerPhone.trim() || undefined,
          payerVpa: payerVpa.trim() || undefined,
          method,
        }),
      });
      if (!res.ok) throw new Error('Payment verification failed');
      const data = (await res.json()) as {transaction: PaymentTransaction};
      setTx(data.transaction);
      setPaid(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete payment');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8f7] px-4 py-8">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.04),0_18px_40px_-14px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onExitCheckout}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Merchant Terminal
          </button>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#008F4B]">
            <Lock className="h-3.5 w-3.5" />
            Secure Checkout
          </span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-500">Loading payment order…</div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold text-rose-600">{error}</p>
            <button
              type="button"
              onClick={onExitCheckout}
              className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white"
            >
              Return to Terminal
            </button>
          </div>
        ) : tx && config ? (
          paid ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-[#00A859]">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">Payment Successful</h1>
              <div className="mt-2 font-mono text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                ₹{tx.amount.toFixed(2)}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Paid to {config.merchantName} · UTR {tx.utr}
              </p>
              <button
                type="button"
                onClick={onExitCheckout}
                className="mt-6 w-full rounded-2xl bg-gradient-to-b from-[#06B863] to-[#00A859] py-3 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,168,89,0.45)] hover:brightness-105"
              >
                Back to Payment QR
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <div className="text-xs font-semibold text-slate-500">
                  {config.merchantName} · {config.provider}
                </div>
                <div className="mt-1 font-mono text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                  ₹{tx.amount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  Order {tx.orderId} · {tx.note}
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="checkout-payer" className="block text-xs font-semibold text-slate-600">
                      Your Name
                    </label>
                    <input
                      id="checkout-payer"
                      type="text"
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                      placeholder="Full Name"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-[#00A859] focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>
                  <div>
                    <label htmlFor="checkout-phone" className="block text-xs font-semibold text-slate-600">
                      Mobile Number
                    </label>
                    <input
                      id="checkout-phone"
                      type="tel"
                      value={payerPhone}
                      onChange={(e) => setPayerPhone(e.target.value)}
                      placeholder="10-digit mobile"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition-all focus:border-[#00A859] focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="checkout-vpa" className="block text-xs font-semibold text-slate-600">
                    UPI ID (e.g. 9820451290@ybl)
                  </label>
                  <input
                    id="checkout-vpa"
                    type="text"
                    value={payerVpa}
                    onChange={(e) => setPayerVpa(e.target.value)}
                    placeholder="yourname@okaxis or mobile@ybl"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition-all focus:border-[#00A859] focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-600">Choose Payment Method</span>
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition-all ${
                      method === m.id
                        ? 'border-[#00A859] bg-emerald-50/50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-5 w-5 text-[#00A859]" />
                      <div>
                        <div className="text-sm font-bold text-slate-900">{m.label}</div>
                        <div className="text-xs text-slate-500">{m.desc}</div>
                      </div>
                    </div>
                    <span
                      className={`h-4 w-4 rounded-full border-2 ${
                        method === m.id ? 'border-[#00A859] bg-[#00A859]' : 'border-slate-300'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={paying}
                onClick={handlePayNow}
                className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#06B863] to-[#00A859] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,168,89,0.45)] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                {paying ? 'Processing Gateway Payment…' : `Pay ₹${tx.amount.toFixed(2)} Now`}
              </button>

              {upiUri && (
                <a
                  href={upiUri}
                  className="block text-center text-xs font-semibold text-[#008F4B] hover:underline"
                >
                  Or open installed UPI app directly
                </a>
              )}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
};
