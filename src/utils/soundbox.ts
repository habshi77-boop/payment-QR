import type {PaymentTransaction} from '../types/payment';

let sharedAudioCtx: AudioContext | null = null;
let activePulseTimer: number | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function triggerHaptic(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore on unsupported browsers
    }
  }
}

export function triggerScanButtonTap(vibrationEnabled = true): void {
  if (vibrationEnabled) {
    triggerHaptic([35, 25, 55]);
  }
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // Audio blocked prior to gesture
  }
}

export interface SoundboxOptions {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  language: 'en-IN' | 'hi-IN';
  onSpeakerLevel?: (level: number, active: boolean) => void;
}

export function stopSoundboxAudio(): void {
  if (activePulseTimer !== null) {
    window.clearInterval(activePulseTimer);
    activePulseTimer = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(0);
    } catch {
      // Ignore
    }
  }
}

export function playPaymentSoundbox(
  tx: Pick<PaymentTransaction, 'amount' | 'payerName' | 'gateway'>,
  options: SoundboxOptions
): void {
  stopSoundboxAudio();

  const {soundEnabled, vibrationEnabled, language, onSpeakerLevel} = options;
  const rupees = Math.floor(tx.amount);
  const paise = Math.round((tx.amount - rupees) * 100);
  const spokenAmountEn =
    paise > 0 ? `${rupees} rupees and ${paise} paise` : `${rupees} rupees`;
  const spokenAmountHi =
    paise > 0 ? `${rupees} rupaye ${paise} paise` : `${rupees} rupaye`;

  // Speaker-synced vibration cadence matching the chime + spoken announcement
  if (vibrationEnabled) {
    triggerHaptic([110, 45, 160, 50, 220, 70, 140, 60, 180]);
  }

  let levelFrameId = 0;

  if (soundEnabled) {
    const ctx = getAudioContext();
    if (ctx) {
      try {
        const now = ctx.currentTime;
        const masterGain = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        masterGain.gain.setValueAtTime(0.42, now);
        masterGain.connect(analyser);
        analyser.connect(ctx.destination);

        // Loud, crisp 3-note merchant confirmation bell
        const notes = [
          {freq: 1046.5, start: 0, dur: 0.14}, // C6
          {freq: 1318.5, start: 0.11, dur: 0.16}, // E6
          {freq: 1567.98, start: 0.22, dur: 0.32}, // G6
        ];

        for (const n of notes) {
          const osc = ctx.createOscillator();
          const noteGain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(n.freq, now + n.start);
          noteGain.gain.setValueAtTime(0.001, now + n.start);
          noteGain.gain.linearRampToValueAtTime(0.95, now + n.start + 0.015);
          noteGain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
          osc.connect(noteGain);
          noteGain.connect(masterGain);
          osc.start(now + n.start);
          osc.stop(now + n.start + n.dur + 0.02);
        }

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const sampleChime = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length / 255;
          onSpeakerLevel?.(Math.min(1, avg * 2.2), true);
          if (ctx.currentTime - now < 0.7) {
            levelFrameId = window.requestAnimationFrame(sampleChime);
          }
        };
        levelFrameId = window.requestAnimationFrame(sampleChime);
      } catch {
        // Fallback if Web Audio fails
      }
    }

    // Voice Soundbox Announcement
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const spokenText =
        language === 'hi-IN'
          ? `Payment QR par ${spokenAmountHi} ${tx.payerName} se prapt hue.`
          : `Payment confirmed! Received ${spokenAmountEn} from ${tx.payerName} on Payment QR.`;

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = language;
      utterance.rate = 1.02;
      utterance.pitch = 1.04;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((v) => v.lang.toLowerCase().includes(language.toLowerCase())) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('en'));
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      let syllablePhase = 0;
      utterance.onstart = () => {
        if (levelFrameId) window.cancelAnimationFrame(levelFrameId);
        activePulseTimer = window.setInterval(() => {
          syllablePhase += 0.65;
          const level = 0.45 + Math.abs(Math.sin(syllablePhase)) * 0.55;
          onSpeakerLevel?.(level, true);
        }, 70);
      };

      utterance.onboundary = () => {
        if (vibrationEnabled) {
          triggerHaptic(32);
        }
      };

      const finishSpeech = () => {
        if (activePulseTimer !== null) {
          window.clearInterval(activePulseTimer);
          activePulseTimer = null;
        }
        onSpeakerLevel?.(0, false);
      };

      utterance.onend = finishSpeech;
      utterance.onerror = finishSpeech;

      window.setTimeout(() => {
        try {
          window.speechSynthesis.speak(utterance);
        } catch {
          finishSpeech();
        }
      }, 280);
    } else {
      globalThis.setTimeout(() => onSpeakerLevel?.(0, false), 900);
    }
  } else {
    // Vibration-only speaker pulse simulation
    let steps = 0;
    activePulseTimer = window.setInterval(() => {
      steps += 1;
      onSpeakerLevel?.(steps % 2 === 0 ? 0.85 : 0.4, true);
      if (steps >= 10 && activePulseTimer !== null) {
        window.clearInterval(activePulseTimer);
        activePulseTimer = null;
        onSpeakerLevel?.(0, false);
      }
    }, 110);
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function sendBackgroundPaymentNotification(tx: PaymentTransaction): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = '✅ Payment Confirmed - Payment QR';
  const phonePart = tx.payerPhone ? ` (${tx.payerPhone})` : '';
  const sourcePart = tx.paymentSource || tx.gateway;
  const body = `You've received ₹${tx.amount.toFixed(2)} from ${tx.payerName}${phonePart} via ${sourcePart} · ${tx.id}`;
  const options: NotificationOptions & {vibrate?: number[]} = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `payment-qr-${tx.id}`,
    requireInteraction: true,
    vibrate: [120, 60, 180, 60, 240],
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return;
      }
    }
    new Notification(title, options);
  } catch {
    // Fallback ignored if browser suppresses background notifications
  }
}
