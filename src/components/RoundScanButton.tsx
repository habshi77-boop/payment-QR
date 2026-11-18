import React from 'react';
import {motion} from 'motion/react';

interface RoundScanButtonProps {
  onClick: () => void;
  speakerLevel: number;
  speakerActive: boolean;
  disabled?: boolean;
}

export const RoundScanButton: React.FC<RoundScanButtonProps> = ({
  onClick,
  speakerLevel,
  speakerActive,
  disabled = false,
}) => {
  const outerScale = speakerActive ? 1 + speakerLevel * 0.48 : 1;
  const midScale = speakerActive ? 1 + speakerLevel * 0.28 : 1;
  const buttonScale = speakerActive ? 1 + speakerLevel * 0.06 : 1;
  const jitterX = speakerActive && speakerLevel > 0.25 ? (speakerLevel > 0.6 ? 2 : -2) : 0;

  return (
    <div className="relative flex flex-col items-center justify-center select-none">
      {/* Ambient static halo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-32 w-32 rounded-full bg-emerald-500/20 blur-xl"
      />

      {/* Subtle idle ring around the round SCAN circle */}
      {!speakerActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-28 w-28 animate-pulse rounded-full border border-emerald-400/35"
        />
      )}

      {/* Outer speaker-synced acoustic vibration ring */}
      <div
        aria-hidden="true"
        style={{
          transform: `scale(${outerScale})`,
          opacity: speakerActive ? Math.min(0.45, 0.16 + speakerLevel * 0.35) : 0,
        }}
        className="pointer-events-none absolute h-24 w-24 rounded-full bg-emerald-400 transition-transform duration-75 ease-out"
      />
      {/* Inner speaker-synced ring */}
      <div
        aria-hidden="true"
        style={{
          transform: `scale(${midScale})`,
          opacity: speakerActive ? Math.min(0.7, 0.28 + speakerLevel * 0.42) : 0,
        }}
        className="pointer-events-none absolute h-24 w-24 rounded-full border-2 border-emerald-300 transition-transform duration-75 ease-out"
      />

      {/* Primary circular SCAN button modeled after the round GO control */}
      <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled}
        whileHover={{scale: 1.03}}
        whileTap={{scale: 0.92}}
        animate={{
          scale: buttonScale,
          x: jitterX,
        }}
        transition={{type: 'spring', stiffness: 520, damping: 24}}
        aria-label="Scan amount or payment QR code"
        className="relative z-10 flex h-24 w-24 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-[#0EC06A] via-[#00A859] to-[#008D4B] text-white shadow-[0_14px_34px_rgba(0,168,89,0.45),inset_0_1px_1px_rgba(255,255,255,0.4)] ring-4 ring-white/15 transition-shadow hover:shadow-[0_18px_40px_rgba(0,168,89,0.58)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Crisp concentric inner white ring */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1.5 rounded-full border-[2.5px] border-white/90 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]"
        />
        <span className="relative text-lg font-extrabold tracking-widest text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
          SCAN
        </span>
      </motion.button>
    </div>
  );
};
