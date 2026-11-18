import React, {useEffect, useState} from 'react';
import {CheckCircle2, Copy, Download, ExternalLink, QrCode, Share2, X} from 'lucide-react';
import type {GatewayConfig, PaymentTransaction} from '../types/payment';
import {buildBrandedQrCardBlob, buildPaymentQrPayload, generateQrDataUrl} from '../utils/qrGenerator';

interface PaymentQRModalProps {
  transaction: PaymentTransaction | null;
  config: GatewayConfig;
  onClose: () => void;
  onConfirmPayment: (tx: PaymentTransaction) => Promise<void>;
}

export const PaymentQRModal: React.FC<PaymentQRModalProps> = ({
  transaction,
  config,
  onClose,
  onConfirmPayment,
}) => {
  const [qrMode, setQrMode] = useState<'upi' | 'checkout'>('upi');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    let cancelled = false;
    const payload = buildPaymentQrPayload(transaction, config, qrMode);
    generateQrDataUrl(payload)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [transaction, config, qrMode]);

  if (!transaction) return null;

  const checkoutLink = buildPaymentQrPayload(transaction, config, 'checkout');

  const handleDownloadQr = async () => {
    if (!qrDataUrl) return;
    try {
      const blob = await buildBrandedQrCardBlob(transaction, config, qrDataUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PaymentQR-${transaction.orderId}-INR${transaction.amount}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg('High-res QR card downloaded');
      window.setTimeout(() => setStatusMsg(''), 2500);
    } catch {
      setStatusMsg('Could not export QR image');
    }
  };

  const handleShareQr = async () => {
    if (!qrDataUrl) return;
    try {
      const blob = await buildBrandedQrCardBlob(transaction, config, qrDataUrl);
      const file = new File([blob], `PaymentQR-${transaction.orderId}.png`, {type: 'image/png'});
      const shareText = `Payment QR Request\nOrder: ${transaction.orderId}\nAmount: ₹${transaction.amount.toFixed(2)}\nPayer: ${transaction.payerName}\nPay Link: ${checkoutLink}`;

      if (navigator.share && navigator.canShare && navigator.canShare({files: [file]})) {
        await navigator.share({
          title: `Payment QR · ₹${transaction.amount.toFixed(2)}`,
          text: shareText,
          files: [file],
        });
        setStatusMsg('QR shared');
        return;
      }

      if (navigator.share) {
        await navigator.share({
          title: `Payment QR · ₹${transaction.amount.toFixed(2)}`,
          text: shareText,
          url: checkoutLink,
        });
        setStatusMsg('Payment link shared');
        return;
      }

      await navigator.clipboard.writeText(shareText);
      setStatusMsg('Payment QR details copied to clipboard');
      window.setTimeout(() => setStatusMsg(''), 2500);
    } catch {
      // User cancelled share or clipboard blocked
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(checkoutLink);
      setStatusMsg('Gateway checkout link copied');
      window.setTimeout(() => setStatusMsg(''), 2500);
    } catch {
      setStatusMsg('Copy failed');
    }
  };

  const handleInstantCapture = async () => {
    setIsConfirming(true);
    try {
      await onConfirmPayment(transaction);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Payment QR Code"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-[#00A859]">
              <QrCode className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">Payment QR Code</h2>
              <p className="font-mono text-xs text-slate-500">
                {transaction.orderId} · {transaction.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR modal"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {/* QR Type Switcher */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setQrMode('upi')}
              className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                qrMode === 'upi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              UPI App QR
            </button>
            <button
              type="button"
              onClick={() => setQrMode('checkout')}
              className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                qrMode === 'checkout' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Gateway Link QR
            </button>
          </div>

          {/* Amount & Scannable QR Stage */}
          <div className="mt-4 flex flex-col items-center rounded-3xl bg-slate-50/90 p-5 text-center">
            <span className="text-xs font-semibold text-slate-500">
              {transaction.status === 'CONFIRMED' ? 'Confirmed Payment Receipt' : 'Scan & Pay Amount'}
            </span>
            <div className="mt-1 font-mono text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums">
              ₹{transaction.amount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {transaction.payerName}
              {transaction.payerPhone ? ` · ${transaction.payerPhone}` : ''}
              {' · '}
              {config.merchantVpa}
            </div>

            <div className="mt-4 rounded-2xl bg-white p-3.5 shadow-[0_6px_20px_-6px_rgba(15,23,42,0.12)]">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`Scannable QR code for ${transaction.orderId}`}
                  className="h-56 w-56 object-contain"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center text-xs text-slate-400">
                  Generating scannable QR…
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{transaction.paymentSource || transaction.gateway}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{transaction.status === 'CONFIRMED' ? 'Confirmed' : 'Pending'}</span>
              {transaction.utr !== 'PENDING' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">UTR {transaction.utr}</span>
                </>
              )}
            </div>
          </div>

          {statusMsg && (
            <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">
              {statusMsg}
            </div>
          )}

          {/* Share & Download Buttons */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleShareQr}
              className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Share2 className="h-4 w-4 text-[#00A859]" />
              Share QR
            </button>
            <button
              type="button"
              onClick={handleDownloadQr}
              className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Download className="h-4 w-4 text-[#00A859]" />
              Download QR
            </button>
          </div>

          {/* Gateway Checkout Actions */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Checkout Link
            </button>
            <a
              href={checkoutLink}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Checkout
            </a>
          </div>

          {transaction.status !== 'CONFIRMED' && (
            <button
              type="button"
              disabled={isConfirming}
              onClick={handleInstantCapture}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#06B863] to-[#00A859] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,168,89,0.45)] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              {isConfirming ? 'Confirming via Gateway…' : 'Accept Payment Now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
