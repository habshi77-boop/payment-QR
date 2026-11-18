import React, {useEffect, useRef, useState} from 'react';
import jsQR from 'jsqr';
import {Camera, CheckCircle2, ImageUp, Loader2, QrCode, ScanLine, X} from 'lucide-react';
import {triggerHaptic, triggerScanButtonTap} from '../utils/soundbox';

export interface ScannedPaymentDetails {
  amount: number;
  payerName?: string;
  payerPhone?: string;
  payerVpa?: string;
  paymentSource?: string;
  note?: string;
}

interface ScanAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAcceptAmount: (details: ScannedPaymentDetails) => void;
  onGenerateQrAmount: (details: ScannedPaymentDetails) => void;
}

function parseScannedQrText(raw: string): {
  amount?: number;
  payerName?: string;
  payerVpa?: string;
  note?: string;
} {
  const trimmed = raw.trim();

  if (trimmed.toLowerCase().startsWith('upi://')) {
    try {
      const url = new URL(trimmed);
      const am = Number(url.searchParams.get('am'));
      const pn = url.searchParams.get('pn') || undefined;
      const pa = url.searchParams.get('pa') || undefined;
      const tn = url.searchParams.get('tn') || undefined;
      return {
        amount: Number.isFinite(am) && am > 0 ? am : undefined,
        payerName: pn,
        payerVpa: pa,
        note: tn,
      };
    } catch {
      // Fall through
    }
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {amount?: number; payerName?: string; note?: string};
      const am = Number(parsed.amount);
      return {
        amount: Number.isFinite(am) && am > 0 ? am : undefined,
        payerName: parsed.payerName,
        note: parsed.note,
      };
    } catch {
      // Fall through
    }
  }

  const match = trimmed.match(/(\d+(?:\.\d{1,2})?)/);
  if (match) {
    const am = Number(match[1]);
    if (Number.isFinite(am) && am > 0) {
      return {amount: am, note: 'Scanned Amount QR'};
    }
  }

  return {};
}

export const ScanAmountModal: React.FC<ScanAmountModalProps> = ({
  isOpen,
  onClose,
  onAcceptAmount,
  onGenerateQrAmount,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(false);

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'unavailable'>('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [cameraBlockedInIframe, setCameraBlockedInIframe] = useState<boolean>(false);
  const [scannedText, setScannedText] = useState<string>('');
  const [scanError, setScanError] = useState<string>('');
  const [isScanningImage, setIsScanningImage] = useState<boolean>(false);
  const [amountInput, setAmountInput] = useState<string>('');
  const [detectedCustomer, setDetectedCustomer] = useState<{
    payerName?: string;
    payerPhone?: string;
    payerVpa?: string;
    paymentSource?: string;
    note?: string;
  }>({});

  const stopActiveStream = () => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startLiveCamera = async () => {
    stopActiveStream();
    setCameraState('starting');
    setCameraError('');
    setCameraBlockedInIframe(false);
    setScannedText('');
    setScanError('');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unavailable');
      setCameraError('Live camera unsupported here. Tap Open Camera below to capture.');
      return;
    }

    const attempts: MediaStreamConstraints[] = [
      {video: {facingMode: {ideal: 'environment'}}, audio: false},
      {video: true, audio: false},
    ];

    let stream: MediaStream | null = null;
    let lastErr: unknown;

    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastErr = err;
        const errName = err instanceof DOMException ? err.name : '';
        if (errName === 'NotAllowedError' || errName === 'SecurityError') {
          break;
        }
      }
    }

    if (!stream) {
      if (!mountedRef.current) return;
      stopActiveStream();
      setCameraState('unavailable');
      const errName = lastErr instanceof DOMException ? lastErr.name : '';
      const inIframe = typeof window !== 'undefined' && window.self !== window.top;
      if (errName === 'NotAllowedError' || errName === 'SecurityError') {
        setCameraBlockedInIframe(inIframe);
        setCameraError(
          inIframe
            ? 'Live camera is blocked inside the preview frame. Tap Open Camera below to use your phone camera directly.'
            : 'Camera permission blocked. Allow camera in browser site settings, then tap Retry Camera.'
        );
      } else if (errName === 'NotReadableError') {
        setCameraError('Camera is in use by another app. Close it and tap Retry Camera.');
      } else {
        setCameraError('Live camera unavailable here. Tap Open Camera below to capture.');
      }
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.muted = true;
      video.setAttribute('playsinline', 'true');
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          video.addEventListener('loadedmetadata', done, {once: true});
          window.setTimeout(done, 400);
        });
        await video.play().catch(() => {});
      }
    }

    if (!mountedRef.current) return;
    setCameraState('active');

    const scanFrame = () => {
      if (!mountedRef.current) return;
      const v = videoRef.current;
      const canvas = canvasRef.current;
      if (v && canvas && v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            triggerHaptic([50, 40, 90]);
            const parsed = parseScannedQrText(code.data);
            if (parsed.amount) {
              setAmountInput(parsed.amount.toFixed(2).replace(/\.00$/, ''));
            }
            setDetectedCustomer({
              payerName: parsed.payerName,
              payerVpa: parsed.payerVpa,
              note: parsed.note,
            });
            setScannedText(`QR Detected · ₹${parsed.amount ?? ''}`);
            return;
          }
        }
      }
      rafRef.current = window.requestAnimationFrame(scanFrame);
    };

    rafRef.current = window.requestAnimationFrame(scanFrame);
  };

  useEffect(() => {
    if (!isOpen) return;
    mountedRef.current = true;
    startLiveCamera();

    return () => {
      mountedRef.current = false;
      stopActiveStream();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const analyzeImageBase64 = async (imageBase64: string, mimeType: string) => {
    setIsScanningImage(true);
    setScanError('');
    setScannedText('');
    try {
      const res = await fetch('/api/payments/scan-image', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({imageBase64, mimeType}),
      });
      const data = (await res.json()) as {
        found?: boolean;
        primaryAmount?: number;
        payerName?: string | null;
        payerPhone?: string | null;
        payerVpa?: string | null;
        paymentSource?: string | null;
        matchedText?: string;
        error?: string;
      };

      if (!res.ok || !data.found || typeof data.primaryAmount !== 'number') {
        setScanError(data.error || 'Could not detect primary collectible amount.');
        return;
      }

      triggerScanButtonTap(true);
      const exactStr = Number.isInteger(data.primaryAmount)
        ? String(data.primaryAmount)
        : data.primaryAmount.toFixed(2);
      setAmountInput(exactStr);
      setDetectedCustomer({
        payerName: data.payerName || undefined,
        payerPhone: data.payerPhone || undefined,
        payerVpa: data.payerVpa || undefined,
        paymentSource: data.paymentSource || undefined,
        note: 'Scanned Exact Collect Amount',
      });
      setScannedText(`Exact Collect Amount: ${data.matchedText || `₹${exactStr}`} (other amounts ignored)`);
    } catch {
      setScanError('Network error while scanning screen amount.');
    } finally {
      setIsScanningImage(false);
    }
  };

  const handleCaptureCameraAmount = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || cameraState !== 'active') return;
    const srcW = video.videoWidth || 720;
    const srcH = video.videoHeight || 720;
    const maxDim = 1024;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    await analyzeImageBase64(dataUrl, 'image/jpeg');
  };

  const handleUploadPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const img = new Image();
      img.onload = () => {
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const qr = jsQR(imageData.data, w, h, {inversionAttempts: 'attemptBoth'});
          if (qr && qr.data) {
            const parsed = parseScannedQrText(qr.data);
            if (parsed.amount) {
              triggerScanButtonTap(true);
              setAmountInput(parsed.amount.toFixed(2).replace(/\.00$/, ''));
              setDetectedCustomer({
                payerName: parsed.payerName,
                payerVpa: parsed.payerVpa,
                note: parsed.note,
              });
              setScannedText(`QR Detected · ₹${parsed.amount.toFixed(2)}`);
              return;
            }
          }
          analyzeImageBase64(offscreen.toDataURL('image/jpeg', 0.88), 'image/jpeg');
        } else {
          analyzeImageBase64(reader.result as string, file.type || 'image/jpeg');
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const parsedAmount = Number(amountInput);
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const fullViewHref = typeof window !== 'undefined' ? window.location.href : '/';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan amount or payment QR"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-[#00A859]">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">Amount &amp; QR Scanner</h2>
              <p className="text-xs text-slate-500">Reads exact collect amount · ignores wallet extras</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Camera Viewfinder */}
        <div className="relative mx-5 mt-4 h-48 overflow-hidden rounded-2xl bg-[#091510] shadow-inner">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${cameraState === 'active' ? 'opacity-100' : 'opacity-20'}`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Viewfinder Corner Frame (only visible when live camera is active) */}
          {cameraState === 'active' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-32 w-52">
                <span className="absolute top-0 left-0 h-6 w-6 rounded-tl-xl border-t-4 border-l-4 border-emerald-400" />
                <span className="absolute top-0 right-0 h-6 w-6 rounded-tr-xl border-t-4 border-r-4 border-emerald-400" />
                <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-xl border-b-4 border-l-4 border-emerald-400" />
                <span className="absolute right-0 bottom-0 h-6 w-6 rounded-br-xl border-r-4 border-b-4 border-emerald-400" />
                {!scannedText && (
                  <div className="animate-scan-beam absolute inset-x-1 top-0 h-0.5 bg-emerald-400 shadow-[0_0_12px_#34d399]" />
                )}
              </div>
            </div>
          )}

          {cameraState !== 'active' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#091510]/90 p-4 text-center">
              <QrCode className="h-7 w-7 text-emerald-400" />
              <p className="mt-2 max-w-xs text-xs font-medium leading-relaxed text-slate-200">
                {cameraState === 'starting' ? 'Starting camera scanner…' : cameraError}
              </p>
              {cameraState === 'unavailable' && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => startLiveCamera()}
                    className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3.5 py-1.5 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-500/30"
                  >
                    Retry Camera
                  </button>
                  {cameraBlockedInIframe && (
                    <a
                      href={fullViewHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/20"
                    >
                      Open Full Tab
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {scannedText && (
            <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-xl bg-[#00A859]/95 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{scannedText}</span>
            </div>
          )}
        </div>

        {/* Camera Capture & Screen Photo Scan Triggers */}
        <div className="mx-5 mt-3 grid grid-cols-2 gap-2.5">
          {cameraState === 'active' ? (
            <button
              type="button"
              disabled={isScanningImage}
              onClick={handleCaptureCameraAmount}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-40"
            >
              {isScanningImage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4 text-emerald-400" />
              )}
              <span>{isScanningImage ? 'Scanning…' : 'Scan Screen Amount'}</span>
            </button>
          ) : (
            <label
              htmlFor="native-camera-input"
              className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-800 ${
                isScanningImage ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              {isScanningImage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4 text-emerald-400" />
              )}
              <span>{isScanningImage ? 'Scanning…' : 'Open Camera'}</span>
            </label>
          )}

          <label
            htmlFor="upload-photo-input"
            className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 transition-colors hover:bg-slate-50 ${
              isScanningImage ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            <ImageUp className="h-4 w-4 text-[#00A859]" />
            <span>Upload Photo</span>
          </label>
          <input
            id="native-camera-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleUploadPhoto}
            className="sr-only"
          />
          <input
            id="upload-photo-input"
            type="file"
            accept="image/*"
            onChange={handleUploadPhoto}
            className="sr-only"
          />
        </div>

        {scanError && (
          <div className="mx-5 mt-2.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {scanError}
          </div>
        )}

        {/* Amount & Payer Controls */}
        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="scan-amount-input" className="block text-xs font-semibold text-slate-600">
              Scanned or Manual Amount (INR)
            </label>
            <div className="mt-1.5 flex items-center rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 transition-all focus-within:border-[#00A859] focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-500/10">
              <span className="font-mono text-2xl font-bold text-slate-400">₹</span>
              <input
                id="scan-amount-input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="ml-2 w-full bg-transparent font-mono text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums outline-none placeholder:text-slate-300"
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

          {(detectedCustomer.payerName ||
            detectedCustomer.payerPhone ||
            detectedCustomer.payerVpa ||
            detectedCustomer.paymentSource) && (
            <div className="rounded-2xl bg-emerald-50/80 px-4 py-3 text-xs text-slate-700">
              <div className="font-semibold text-emerald-800">Auto-Captured Customer Details</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-600">
                {detectedCustomer.payerName && (
                  <span className="font-semibold text-slate-900">{detectedCustomer.payerName}</span>
                )}
                {detectedCustomer.payerPhone && <span className="font-mono">{detectedCustomer.payerPhone}</span>}
                {detectedCustomer.paymentSource && <span>{detectedCustomer.paymentSource}</span>}
                {detectedCustomer.payerVpa && <span className="font-mono">{detectedCustomer.payerVpa}</span>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              disabled={!isValidAmount}
              onClick={() =>
                onGenerateQrAmount({
                  amount: parsedAmount,
                  ...detectedCustomer,
                })
              }
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <QrCode className="h-4 w-4 text-[#00A859]" />
              Generate QR
            </button>
            <button
              type="button"
              disabled={!isValidAmount}
              onClick={() =>
                onAcceptAmount({
                  amount: parsedAmount,
                  ...detectedCustomer,
                })
              }
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#06B863] to-[#00A859] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,168,89,0.45)] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
            >
              Accept Payment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
