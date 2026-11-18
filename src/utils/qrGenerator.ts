import QRCode from 'qrcode';
import type {GatewayConfig, PaymentTransaction} from '../types/payment';

export function buildPaymentQrPayload(
  tx: PaymentTransaction,
  config: GatewayConfig,
  mode: 'upi' | 'checkout' = 'upi'
): string {
  if (mode === 'checkout' && typeof window !== 'undefined') {
    return `${window.location.origin}/?checkout=${encodeURIComponent(tx.orderId)}`;
  }

  const params = new URLSearchParams({
    pa: config.merchantVpa,
    pn: config.merchantName,
    am: tx.amount.toFixed(2),
    cu: 'INR',
    tr: tx.orderId,
    tn: `${tx.id} | ${tx.payerName} | ${tx.note}`,
  });
  return `upi://pay?${params.toString()}`;
}

export async function generateQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: 560,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

export async function buildBrandedQrCardBlob(
  tx: PaymentTransaction,
  config: GatewayConfig,
  qrDataUrl: string
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1020;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // White card background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 800, 1020);

  // Emerald header band
  ctx.fillStyle = '#00A859';
  ctx.fillRect(0, 0, 800, 180);

  // Brand title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 42px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Payment QR', 400, 82);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '600 22px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`${config.merchantName} · ${config.provider}`, 400, 128);

  // Amount label
  ctx.fillStyle = '#64748B';
  ctx.font = '600 22px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(tx.status === 'CONFIRMED' ? 'CONFIRMED PAYMENT' : 'SCAN & PAY AMOUNT', 400, 240);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 64px "JetBrains Mono", monospace';
  ctx.fillText(`₹${tx.amount.toFixed(2)}`, 400, 315);

  // Draw QR image
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('QR image load failed'));
    img.src = qrDataUrl;
  });

  // Subtle frame around QR
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 3;
  ctx.strokeRect(180, 355, 440, 440);
  ctx.drawImage(img, 200, 375, 400, 400);

  // Details footer
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`${tx.payerName} · ${tx.orderId}`, 400, 855);

  ctx.fillStyle = '#475569';
  ctx.font = '500 20px "JetBrains Mono", monospace';
  ctx.fillText(`UPI VPA: ${config.merchantVpa}`, 400, 898);
  ctx.fillText(`TXN: ${tx.id} · UTR: ${tx.utr}`, 400, 936);

  ctx.fillStyle = '#00A859';
  ctx.font = '600 18px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Instant Soundbox Verified · Payment QR', 400, 982);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to export PNG'));
    }, 'image/png');
  });
}
