import React from 'react';
import {motion} from 'motion/react';
import {Check, QrCode, Share2, Volume2, X} from 'lucide-react';
import type {PaymentTransaction} from '../types/payment';

interface FullScreenPaymentAlertProps {
  transaction: PaymentTransaction | null;
  speakerLevel: number;
  speakerActive: boolean;
  onClose: () => void;
  onGenerateQr: (tx: PaymentTransaction) => void;
  onReplaySoundbox: (tx: PaymentTransaction) => void;
  onShareReceipt: (tx: PaymentTransaction) => void;
}

export const FullScreenPaymentAlert: React.FC<FullScreenPaymentAlertProps> = ({
  transaction,
  speakerLevel,
  speakerActive,
  onClose,
  onGenerateQr,
  onReplaySoundbox,
  onShareReceipt,
}) => {
  if (!transaction) return null;

  const timeFormatted = new Date(transaction.confirmedAt || transaction.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const pulseScale = speakerActive ? 1 + speakerLevel * 0.35 : 1;

  return (
    <motion.div
      initial={{opacity: 0, scale: 0.96}}
      animate={{opacity: 1, scale: 1}}
      exit={{opacity: 0, scale: 0.96}}
      transition={{duration: 0.18, ease: [0.16, 1, 0.3, 1]}}
      role="alertdialog"
      aria-modal="true"
      aria-label="Payment Confirmed Notification"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-gradient-to-b from-[#08B863] via-[#00A859] to-[#008646] p-6 text-white sm:p-10"
    >
      {/* Top Bar */}
      <div className="mx-auto flex w-full max-w-lg items-center justify-between">
        <button
          type="button"
          onClick={() => onReplaySoundbox(transaction)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 bg-white/15 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          <Volume2 className="h-4 w-4" />
          <span>{speakerActive ? 'Speaking & Vibrating' : 'Replay Soundbox'}</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss payment confirmation"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Center Confirmation Content */}
      <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
        <div className="relative flex items-center justify-center">
          <div
            aria-hidden="true"
            style={{
              transform: `scale(${pulseScale})`,
              opacity: speakerActive ? 0.35 : 0.18,
            }}
            className="absolute h-32 w-32 rounded-full bg-white transition-transform duration-75"
          />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white text-[#00A859] shadow-[0_18px_40px_rgba(0,0,0,0.18)] ring-4 ring-white/25">
            <Check className="h-12 w-12 stroke-[3]" />
          </div>
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight text-white sm:text-2xl">
          ✅ Payment Confirmed - Payment QR
        </h1>

        <div className="mt-3 font-mono text-5xl font-extrabold tracking-tight text-white tabular-nums drop-shadow-xs sm:text-6xl">
          ₹{transaction.amount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
        </div>

        <p className="mt-2 text-base font-medium text-emerald-50">
          From {transaction.payerName}
          {transaction.payerPhone ? ` · ${transaction.payerPhone}` : ''}
        </p>

        {/* Clean Structured Payment & Customer Details */}
        <div className="mt-7 w-full rounded-3xl border border-white/15 bg-black/15 p-5 text-left shadow-inner backdrop-blur-md">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm">
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">Customer Name</dt>
              <dd className="mt-0.5 truncate font-semibold text-white">{transaction.payerName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">Mobile Number</dt>
              <dd className="mt-0.5 font-mono font-semibold text-white">
                {transaction.payerPhone || 'Not shared by bank'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">Payment Source</dt>
              <dd className="mt-0.5 truncate font-semibold text-white">
                {transaction.paymentSource || transaction.gateway}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">UPI / Account</dt>
              <dd className="mt-0.5 truncate font-mono font-semibold text-white">{transaction.vpa}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">Transaction ID</dt>
              <dd className="mt-0.5 font-mono font-semibold text-white">{transaction.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">UTR Reference</dt>
              <dd className="mt-0.5 font-mono font-semibold text-white">{transaction.utr}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">Order ID</dt>
              <dd className="mt-0.5 font-mono font-semibold text-white">{transaction.orderId}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-emerald-100/80">Confirmed At</dt>
              <dd className="mt-0.5 font-mono font-semibold text-white tabular-nums">{timeFormatted}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onGenerateQr(transaction)}
          className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/15 px-4 py-3 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          <QrCode className="h-4 w-4" />
          Generate QR
        </button>
        <button
          type="button"
          onClick={() => onShareReceipt(transaction)}
          className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/15 px-4 py-3 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          <Share2 className="h-4 w-4" />
          Share Receipt
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[48px] flex-1 items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-extrabold text-[#008F4B] shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition-transform active:scale-[0.98]"
        >
          Done
        </button>
      </div>
    </motion.div>
  );
};
