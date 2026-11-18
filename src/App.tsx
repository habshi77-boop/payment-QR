import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence} from 'motion/react';
import {
  Bell,
  CheckCircle2,
  QrCode,
  Search,
  Settings,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  CreateOrderResponse,
  GatewayConfig,
  PaymentMethod,
  PaymentTransaction,
} from './types/payment';
import {RoundScanButton} from './components/RoundScanButton';
import {ScanAmountModal, type ScannedPaymentDetails} from './components/ScanAmountModal';
import {FullScreenPaymentAlert} from './components/FullScreenPaymentAlert';
import {PaymentQRModal} from './components/PaymentQRModal';
import {GatewaySettingsModal} from './components/GatewaySettingsModal';
import {CheckoutPage} from './components/CheckoutPage';
import {PWAInstallButton} from './components/PWAInstallButton';
import {OfflineIndicator} from './components/OfflineIndicator';
import {
  playPaymentSoundbox,
  requestNotificationPermission,
  sendBackgroundPaymentNotification,
  stopSoundboxAudio,
  triggerHaptic,
  triggerScanButtonTap,
} from './utils/soundbox';

const DEFAULT_CONFIG: GatewayConfig = {
  provider: 'UPI Gateway',
  merchantName: 'Payment QR Merchant',
  merchantVpa: 'paymentqr@okaxis',
  keyId: 'cp_live_9842a10e4c',
  webhookActive: true,
  soundboxEnabled: true,
  vibrationEnabled: true,
  voiceLanguage: 'en-IN',
};

export default function App() {
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('checkout');
  });

  const [config, setConfig] = useState<GatewayConfig>(DEFAULT_CONFIG);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Terminal form state (manual amount entry & UPI mode only)
  const [amountInput, setAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI QR');
  const [submitting, setSubmitting] = useState(false);

  // Filter & search
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'CONFIRMED' | 'PENDING'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & full-screen alert
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isGatewayModalOpen, setIsGatewayModalOpen] = useState(false);
  const [qrTransaction, setQrTransaction] = useState<PaymentTransaction | null>(null);
  const [alertTransaction, setAlertTransaction] = useState<PaymentTransaction | null>(null);

  // Soundbox live speaker animation state
  const [speakerLevel, setSpeakerLevel] = useState(0);
  const [speakerActive, setSpeakerActive] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );

  const seenConfirmedIds = useRef<Set<string>>(new Set());
  const configRef = useRef<GatewayConfig>(config);
  configRef.current = config;

  const triggerInstantAlert = useCallback((tx: PaymentTransaction) => {
    if (seenConfirmedIds.current.has(tx.id) && tx.status === 'CONFIRMED') {
      return;
    }
    seenConfirmedIds.current.add(tx.id);

    setAlertTransaction(tx);
    playPaymentSoundbox(tx, {
      soundEnabled: configRef.current.soundboxEnabled,
      vibrationEnabled: configRef.current.vibrationEnabled,
      language: configRef.current.voiceLanguage,
      onSpeakerLevel: (level, active) => {
        setSpeakerLevel(level);
        setSpeakerActive(active);
      },
    });
    sendBackgroundPaymentNotification(tx);
  }, []);

  const loadInitialData = useCallback(async () => {
    try {
      const [cfgRes, payRes] = await Promise.all([fetch('/api/gateway/config'), fetch('/api/payments')]);
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as GatewayConfig;
        setConfig(cfg);
      }
      if (payRes.ok) {
        const data = (await payRes.json()) as {transactions: PaymentTransaction[]};
        setTransactions(data.transactions);
        for (const t of data.transactions) {
          if (t.status === 'CONFIRMED') {
            seenConfirmedIds.current.add(t.id);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (checkoutOrderId) return;
    loadInitialData();
  }, [checkoutOrderId, loadInitialData]);

  // Real-time SSE listener for <1s instant gateway confirmations
  useEffect(() => {
    if (checkoutOrderId) return;

    const es = new EventSource('/api/payments/stream');
    es.addEventListener('payment_confirmed', (event: MessageEvent) => {
      try {
        const tx = JSON.parse(event.data) as PaymentTransaction;
        setTransactions((prev) => {
          const exists = prev.some((p) => p.id === tx.id || p.orderId === tx.orderId);
          if (exists) {
            return prev.map((p) => (p.id === tx.id || p.orderId === tx.orderId ? tx : p));
          }
          return [tx, ...prev];
        });
        setQrTransaction((prev) => (prev && prev.orderId === tx.orderId ? tx : prev));
        triggerInstantAlert(tx);
      } catch {
        // Ignore malformed SSE payload
      }
    });

    return () => {
      es.close();
    };
  }, [checkoutOrderId, triggerInstantAlert]);

  const handleAcceptPayment = async (scanned?: ScannedPaymentDetails) => {
    const amt = scanned?.amount ?? Number(amountInput);
    if (!Number.isFinite(amt) || amt <= 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          amount: amt,
          payerName: scanned?.payerName,
          payerPhone: scanned?.payerPhone,
          payerVpa: scanned?.payerVpa,
          paymentSource: scanned?.paymentSource,
          note: scanned?.note || 'Instant Payment',
          gateway: config.provider,
          method: paymentMethod,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {transaction: PaymentTransaction};
      setTransactions((prev) => {
        const exists = prev.some((t) => t.id === data.transaction.id);
        return exists ? prev : [data.transaction, ...prev];
      });
      setIsScanModalOpen(false);
      triggerInstantAlert(data.transaction);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateQrOrder = async (scanned?: ScannedPaymentDetails) => {
    const amt = scanned?.amount ?? Number(amountInput);
    if (!Number.isFinite(amt) || amt <= 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          amount: amt,
          payerName: scanned?.payerName,
          note: scanned?.note || 'QR Payment Request',
          gateway: config.provider,
          method: paymentMethod,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as CreateOrderResponse;
      setTransactions((prev) => [data.transaction, ...prev]);
      setIsScanModalOpen(false);
      setQrTransaction(data.transaction);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPendingOrder = async (tx: PaymentTransaction) => {
    const res = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        orderId: tx.orderId,
        amount: tx.amount,
        payerName: tx.payerName,
        gateway: tx.gateway,
        method: tx.method,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {transaction: PaymentTransaction};
    setTransactions((prev) => prev.map((t) => (t.id === data.transaction.id ? data.transaction : t)));
    setQrTransaction(null);
    triggerInstantAlert(data.transaction);
  };

  const handleSaveConfig = async (next: GatewayConfig) => {
    const res = await fetch('/api/gateway/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const saved = (await res.json()) as GatewayConfig;
      setConfig(saved);
    }
  };

  const handleTriggerWebhookTest = async () => {
    await fetch('/api/payments/webhook', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        event: 'payment.captured',
        amount: Number(amountInput) || 259.94,
        payerName: 'Amar Sharma',
        payerPhone: '9820451290',
        payerVpa: '9820451290@ybl',
        gateway: config.provider,
        note: 'Gateway Webhook Payment',
      }),
    });
  };

  const handleToggleSoundbox = async () => {
    const next = {...config, soundboxEnabled: !config.soundboxEnabled};
    setConfig(next);
    await handleSaveConfig(next);
    if (next.soundboxEnabled) {
      triggerScanButtonTap(next.vibrationEnabled);
    } else {
      stopSoundboxAudio();
    }
  };

  const handleEnableAlerts = async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      triggerHaptic([40, 30, 60]);
    }
  };

  const handleShareReceipt = async (tx: PaymentTransaction) => {
    const phoneLine = tx.payerPhone ? `\nMobile: ${tx.payerPhone}` : '';
    const text = `✅ Payment Confirmed - Payment QR\nAmount: ₹${tx.amount.toFixed(2)}\nCustomer: ${tx.payerName}${phoneLine}\nSource: ${tx.paymentSource || tx.gateway} (${tx.vpa})\nTXN ID: ${tx.id}\nOrder: ${tx.orderId}\nUTR: ${tx.utr}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Payment QR Receipt · ₹${tx.amount.toFixed(2)}`,
          text,
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore
    }
  };

  const stats = useMemo(() => {
    const confirmed = transactions.filter((t) => t.status === 'CONFIRMED');
    const totalCollected = confirmed.reduce((sum, t) => sum + t.amount, 0);
    return {
      totalCollected,
      confirmedCount: confirmed.length,
      pendingCount: transactions.filter((t) => t.status === 'PENDING').length,
    };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (filterStatus !== 'ALL' && tx.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          tx.payerName.toLowerCase().includes(q) ||
          (tx.payerPhone || '').toLowerCase().includes(q) ||
          (tx.paymentSource || '').toLowerCase().includes(q) ||
          tx.vpa.toLowerCase().includes(q) ||
          tx.id.toLowerCase().includes(q) ||
          tx.orderId.toLowerCase().includes(q) ||
          tx.utr.toLowerCase().includes(q) ||
          String(tx.amount).includes(q)
        );
      }
      return true;
    });
  }, [transactions, filterStatus, searchQuery]);

  if (checkoutOrderId) {
    return (
      <CheckoutPage
        orderId={checkoutOrderId}
        onExitCheckout={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('checkout');
          window.history.replaceState({}, '', url.toString());
          setCheckoutOrderId(null);
          loadInitialData();
        }}
      />
    );
  }

  const parsedAmount = Number(amountInput);
  const isAmountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  return (
    <div className="min-h-screen bg-[#f6f8f7] pb-14 text-slate-900">
      {/* Top Bar Contract: Brand wordmark — Nav links — Primary action */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3 sm:px-6">
          <a
            href="#terminal"
            className="text-lg font-extrabold tracking-tight text-slate-950 whitespace-nowrap shrink-0"
          >
            Payment QR
          </a>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a
              href="#terminal"
              className="underline-offset-4 transition-colors hover:text-slate-950 hover:underline whitespace-nowrap shrink-0"
            >
              Terminal
            </a>
            <a
              href="#transactions"
              className="underline-offset-4 transition-colors hover:text-slate-950 hover:underline whitespace-nowrap shrink-0"
            >
              Transactions
            </a>
            <button
              type="button"
              onClick={() => handleCreateQrOrder()}
              className="underline-offset-4 transition-colors hover:text-slate-950 hover:underline whitespace-nowrap shrink-0"
            >
              QR Studio
            </button>
            <button
              type="button"
              onClick={() => setIsGatewayModalOpen(true)}
              className="underline-offset-4 transition-colors hover:text-slate-950 hover:underline whitespace-nowrap shrink-0"
            >
              Gateway
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => setIsGatewayModalOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Settings className="h-4 w-4 text-emerald-400" />
              <span>Gateway</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        {/* Main 2-Column Workspace */}
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-12">
          {/* Left Column: Primary Round SCAN Stage at Top + Manual Accept Payment Terminal */}
          <section id="terminal" className="space-y-6 lg:col-span-5">
            {/* Primary Top Round SCAN Console */}
            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-b from-[#091610] via-[#0D1E16] to-[#08130E] px-6 py-7 text-center shadow-[0_22px_50px_-15px_rgba(6,78,59,0.42)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-10 left-1/2 h-44 w-64 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-2xl"
              />
              <RoundScanButton
                onClick={() => {
                  triggerScanButtonTap(config.vibrationEnabled);
                  setIsScanModalOpen(true);
                }}
                speakerLevel={speakerLevel}
                speakerActive={speakerActive}
              />
              <h1 className="relative mt-4 text-balance text-base font-extrabold tracking-tight text-white">
                Scan Amount or Payment QR
              </h1>
              <p className="relative mt-1 max-w-xs text-xs leading-relaxed text-emerald-100/75">
                Primary scanner · Reads exact amount &amp; vibrates with speaker
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.04),0_14px_34px_-14px_rgba(15,23,42,0.07)] sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight text-slate-950">
                    Accept Payment
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Manual amount entry &amp; Soundbox alert
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleToggleSoundbox}
                    aria-label={config.soundboxEnabled ? 'Mute soundbox' : 'Unmute soundbox'}
                    className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
                      config.soundboxEnabled
                        ? 'border-emerald-200 bg-emerald-50 text-[#00A859]'
                        : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {config.soundboxEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                  </button>

                  {notificationPermission !== 'granted' && (
                    <button
                      type="button"
                      onClick={handleEnableAlerts}
                      aria-label="Enable background alerts"
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      <Bell className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Manual Amount Input */}
              <div className="mt-5">
                <label htmlFor="terminal-amount" className="block text-xs font-semibold text-slate-600">
                  Enter Payment Amount (INR)
                </label>
                <div className="mt-1.5 flex items-center rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3.5 transition-all focus-within:border-[#00A859] focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-500/10">
                  <span className="font-mono text-3xl font-bold text-slate-400">₹</span>
                  <input
                    id="terminal-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="ml-2 w-full bg-transparent font-mono text-3xl font-extrabold tracking-tight text-slate-950 tabular-nums outline-none placeholder:text-slate-300"
                    placeholder="0.00"
                  />
                  {amountInput && (
                    <button
                      type="button"
                      onClick={() => setAmountInput('')}
                      aria-label="Clear amount"
                      className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                Enter amount manually or tap SCAN above. Customer name, mobile number, and payment source are captured automatically.
              </p>

              <div className="mt-4">
                <span className="block text-xs font-semibold text-slate-600">UPI Mode</span>
                <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/90 p-1">
                  {(['UPI QR', 'UPI Intent'] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`min-h-[38px] rounded-lg px-2 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                        paymentMethod === m
                          ? 'bg-white text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Green Accept Payment CTA + Generate QR */}
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!isAmountValid || submitting}
                  onClick={() => handleAcceptPayment()}
                  className="flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#06B863] to-[#00A859] px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,168,89,0.45)] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{submitting ? 'Confirming…' : 'Accept Payment'}</span>
                </button>

                <button
                  type="button"
                  disabled={!isAmountValid || submitting}
                  onClick={() => handleCreateQrOrder()}
                  className="flex min-h-[50px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                >
                  <QrCode className="h-4 w-4 text-[#00A859]" />
                  <span>Generate QR</span>
                </button>
              </div>
            </div>
          </section>

          {/* Right Column: Collection Summary + Live Payment Feed & QR Generation */}
          <section id="transactions" className="space-y-6 lg:col-span-7">
            <div
              aria-label="Collection summary"
              className="grid grid-cols-2 gap-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.04),0_14px_34px_-14px_rgba(15,23,42,0.07)] sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-slate-100 sm:p-6"
            >
              <div className="sm:pr-5">
                <div className="text-xs font-semibold text-slate-500">Collected Today</div>
                <div className="mt-1 font-mono text-2xl font-extrabold tracking-tight text-slate-950 tabular-nums sm:text-3xl">
                  ₹{stats.totalCollected.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </div>
              </div>
              <div className="sm:px-5">
                <div className="text-xs font-semibold text-slate-500">Confirmed</div>
                <div className="mt-1 font-mono text-2xl font-extrabold tracking-tight text-[#00A859] tabular-nums sm:text-3xl">
                  {stats.confirmedCount}
                </div>
              </div>
              <div className="col-span-2 border-t border-slate-100 pt-3 sm:col-span-1 sm:border-t-0 sm:pt-0 sm:pl-5">
                <div className="text-xs font-semibold text-slate-500">Active Gateway</div>
                <div className="mt-1.5 truncate text-sm font-bold text-slate-950">
                  {config.provider}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
                  {config.merchantVpa}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_2px_10px_-2px_rgba(15,23,42,0.04),0_14px_34px_-14px_rgba(15,23,42,0.07)]">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight text-slate-950">
                    Payment Gateway Ledger
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Tap any payment to generate, share, or download its scannable QR code
                  </p>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 self-start rounded-xl bg-slate-100/90 p-1">
                  {(['ALL', 'CONFIRMED', 'PENDING'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFilterStatus(tab)}
                      className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                        filterStatus === tab
                          ? 'bg-white text-slate-950 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab === 'ALL' ? 'All' : tab === 'CONFIRMED' ? 'Confirmed' : 'Pending'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Bar */}
              <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
                <div className="flex items-center gap-2.5 rounded-xl border border-transparent bg-slate-50 px-3.5 py-2 transition-all focus-within:border-emerald-500/40 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-500/10">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by customer name, mobile, UPI app, UTR, or amount…"
                    className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* Payment Rows */}
              <div className="divide-y divide-slate-100">
                {loading ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Connecting to Payment QR payment gateway…
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    No matching payments yet. Tap SCAN above or Accept Payment to collect.
                  </div>
                ) : (
                  filteredTransactions.map((tx) => {
                    const timeStr = new Date(tx.confirmedAt || tx.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-slate-50/80 sm:px-6"
                      >
                        <button
                          type="button"
                          onClick={() => setQrTransaction(tx)}
                          className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
                        >
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                              tx.status === 'CONFIRMED'
                                ? 'bg-emerald-50 text-[#00A859]'
                                : 'bg-amber-50 text-amber-600'
                            }`}
                          >
                            <CheckCircle2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="truncate text-sm font-bold text-slate-950">
                                {tx.payerName}
                              </span>
                              {tx.payerPhone && (
                                <span className="font-mono text-xs font-medium text-slate-600">
                                  {tx.payerPhone}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-slate-500">
                              <span className="font-semibold text-slate-700">
                                {tx.paymentSource || tx.gateway}
                              </span>
                              <span aria-hidden="true"> · </span>
                              <span className="font-mono">{tx.vpa}</span>
                              <span aria-hidden="true"> · </span>
                              <span>{tx.status === 'CONFIRMED' ? `UTR ${tx.utr}` : 'Awaiting Payment'}</span>
                              <span aria-hidden="true"> · </span>
                              <span className="tabular-nums">{timeStr}</span>
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <div className="font-mono text-base font-extrabold tracking-tight text-slate-950 tabular-nums">
                              ₹{tx.amount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </div>
                            <div
                              className={`text-xs font-semibold ${
                                tx.status === 'CONFIRMED' ? 'text-[#00A859]' : 'text-amber-600'
                              }`}
                            >
                              {tx.status === 'CONFIRMED' ? 'Confirmed' : 'Pending'}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setQrTransaction(tx)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-emerald-300 hover:text-[#00A859] whitespace-nowrap"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            <span>Generate QR</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Modals & Full-Screen Payment Alert */}
      <ScanAmountModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        onAcceptAmount={(details) => handleAcceptPayment(details)}
        onGenerateQrAmount={(details) => handleCreateQrOrder(details)}
      />

      <PaymentQRModal
        transaction={qrTransaction}
        config={config}
        onClose={() => setQrTransaction(null)}
        onConfirmPayment={handleConfirmPendingOrder}
      />

      <GatewaySettingsModal
        isOpen={isGatewayModalOpen}
        config={config}
        notificationPermission={notificationPermission}
        onNotificationPermissionChange={setNotificationPermission}
        onClose={() => setIsGatewayModalOpen(false)}
        onSaveConfig={handleSaveConfig}
        onTriggerTestWebhook={handleTriggerWebhookTest}
      />

      <AnimatePresence>
        {alertTransaction && (
          <FullScreenPaymentAlert
            transaction={alertTransaction}
            speakerLevel={speakerLevel}
            speakerActive={speakerActive}
            onClose={() => {
              stopSoundboxAudio();
              setSpeakerActive(false);
              setSpeakerLevel(0);
              setAlertTransaction(null);
            }}
            onGenerateQr={(tx) => {
              setAlertTransaction(null);
              setQrTransaction(tx);
            }}
            onReplaySoundbox={(tx) => {
              playPaymentSoundbox(tx, {
                soundEnabled: true,
                vibrationEnabled: config.vibrationEnabled,
                language: config.voiceLanguage,
                onSpeakerLevel: (level, active) => {
                  setSpeakerLevel(level);
                  setSpeakerActive(active);
                },
              });
            }}
            onShareReceipt={handleShareReceipt}
          />
        )}
      </AnimatePresence>

      <OfflineIndicator />
    </div>
  );
}
