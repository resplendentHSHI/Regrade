/**
 * SVG pet portraits — soft, rounded, pastel-colored.
 * Each species has idle + happy variants (different eyes/expression).
 * Sized to fit the sidebar pet nest (~90px).
 */

import type { ReactNode } from "react";
import type { PetSpecies } from "@/lib/pet";

interface PetSvgProps {
  species: PetSpecies;
  happy?: boolean;
  className?: string;
}

/* ── Shared palette (uses CSS variables where possible) ─────────────── */
const C = {
  cream: "oklch(0.96 0.02 75)",
  rose: "oklch(0.82 0.08 10)",
  roseDark: "oklch(0.65 0.12 10)",
  sage: "oklch(0.85 0.04 145)",
  sageDark: "oklch(0.7 0.06 145)",
  butter: "oklch(0.92 0.06 90)",
  butterDark: "oklch(0.8 0.08 85)",
  eye: "oklch(0.25 0.02 270)",
  eyeHighlight: "white",
  blush: "oklch(0.85 0.1 10 / 0.5)",
  nose: "oklch(0.72 0.08 10)",
};

/* ── Bibi: bookworm ─────────────────────────────────────────────────── */
function Bibi({ happy }: { happy?: boolean }) {
  return (
    <svg viewBox="0 0 90 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Book */}
      <rect x="15" y="58" width="60" height="14" rx="3" fill={C.sage} />
      <rect x="15" y="58" width="30" height="14" rx="3" fill={C.sageDark} opacity="0.3" />
      <line x1="45" y1="58" x2="45" y2="72" stroke={C.sageDark} strokeWidth="1" opacity="0.5" />
      {/* Pages */}
      <rect x="18" y="62" width="5" height="6" rx="1" fill={C.cream} opacity="0.6" />

      {/* Body */}
      <ellipse cx="45" cy="46" rx="22" ry="20" fill={C.rose} />
      <ellipse cx="45" cy="48" rx="18" ry="15" fill={C.cream} />

      {/* Eyes */}
      <ellipse cx="37" cy="42" rx={happy ? 4 : 3.5} ry={happy ? 4.5 : 3.5} fill={C.eye} />
      <ellipse cx="53" cy="42" rx={happy ? 4 : 3.5} ry={happy ? 4.5 : 3.5} fill={C.eye} />
      <circle cx={happy ? 38.5 : 38} cy="40.5" r="1.5" fill={C.eyeHighlight} />
      <circle cx={happy ? 54.5 : 54} cy="40.5" r="1.5" fill={C.eyeHighlight} />

      {/* Mouth */}
      {happy ? (
        <path d="M 41 49 Q 45 53 49 49" stroke={C.roseDark} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M 42 49 Q 45 51 48 49" stroke={C.roseDark} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      )}

      {/* Blush */}
      {happy && (
        <>
          <ellipse cx="31" cy="47" rx="4" ry="2.5" fill={C.blush} />
          <ellipse cx="59" cy="47" rx="4" ry="2.5" fill={C.blush} />
        </>
      )}
    </svg>
  );
}

/* ── Professor Hoot: owl ────────────────────────────────────────────── */
function Professor({ happy }: { happy?: boolean }) {
  return (
    <svg viewBox="0 0 90 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ear tufts */}
      <path d="M 25 30 L 30 18 L 36 28" fill={C.butterDark} />
      <path d="M 65 30 L 60 18 L 54 28" fill={C.butterDark} />

      {/* Body */}
      <ellipse cx="45" cy="50" rx="24" ry="26" fill={C.butter} />
      {/* Belly */}
      <ellipse cx="45" cy="55" rx="16" ry="16" fill={C.cream} />

      {/* Glasses */}
      <circle cx="36" cy="42" r="9" stroke={C.sageDark} strokeWidth="1.8" fill="none" />
      <circle cx="54" cy="42" r="9" stroke={C.sageDark} strokeWidth="1.8" fill="none" />
      <line x1="45" y1="42" x2="45" y2="42" stroke={C.sageDark} strokeWidth="1.8" />
      <path d="M 44.5 40 L 45.5 40" stroke={C.sageDark} strokeWidth="1.8" strokeLinecap="round" />

      {/* Eyes behind glasses */}
      <circle cx="36" cy="42" r={happy ? 4 : 3} fill={C.eye} />
      <circle cx="54" cy="42" r={happy ? 4 : 3} fill={C.eye} />
      <circle cx={happy ? 37.5 : 37} cy="40.5" r="1.3" fill={C.eyeHighlight} />
      <circle cx={happy ? 55.5 : 55} cy="40.5" r="1.3" fill={C.eyeHighlight} />

      {/* Beak */}
      <path d="M 42 50 L 45 54 L 48 50" fill={C.butterDark} stroke={C.butterDark} strokeWidth="0.5" strokeLinejoin="round" />

      {/* Feet */}
      <path d="M 33 74 L 30 80 M 33 74 L 33 80 M 33 74 L 36 80" stroke={C.butterDark} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 57 74 L 54 80 M 57 74 L 57 80 M 57 74 L 60 80" stroke={C.butterDark} strokeWidth="1.5" strokeLinecap="round" />

      {/* Blush */}
      {happy && (
        <>
          <ellipse cx="27" cy="48" rx="4" ry="2.5" fill={C.blush} />
          <ellipse cx="63" cy="48" rx="4" ry="2.5" fill={C.blush} />
        </>
      )}
    </svg>
  );
}

/* ── Pip: grumpy cat ────────────────────────────────────────────────── */
function Pip({ happy }: { happy?: boolean }) {
  return (
    <svg viewBox="0 0 90 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ears */}
      <path d="M 24 35 L 30 12 L 40 32" fill={C.rose} />
      <path d="M 66 35 L 60 12 L 50 32" fill={C.rose} />
      <path d="M 28 33 L 32 18 L 39 31" fill={C.cream} opacity="0.6" />
      <path d="M 62 33 L 58 18 L 51 31" fill={C.cream} opacity="0.6" />

      {/* Head / body */}
      <ellipse cx="45" cy="50" rx="24" ry="22" fill={C.rose} />
      <ellipse cx="45" cy="53" rx="18" ry="15" fill={C.cream} />

      {/* Eyes — half-lidded when idle, rounder when happy */}
      {happy ? (
        <>
          <ellipse cx="36" cy="44" rx="4" ry="4.5" fill={C.eye} />
          <ellipse cx="54" cy="44" rx="4" ry="4.5" fill={C.eye} />
          <circle cx="37.5" cy="42.5" r="1.5" fill={C.eyeHighlight} />
          <circle cx="55.5" cy="42.5" r="1.5" fill={C.eyeHighlight} />
        </>
      ) : (
        <>
          <ellipse cx="36" cy="44" rx="4.5" ry="2.5" fill={C.eye} />
          <ellipse cx="54" cy="44" rx="4.5" ry="2.5" fill={C.eye} />
          <circle cx="37.5" cy="43" r="1" fill={C.eyeHighlight} />
          <circle cx="55.5" cy="43" r="1" fill={C.eyeHighlight} />
        </>
      )}

      {/* Nose */}
      <ellipse cx="45" cy="50" rx="2.5" ry="2" fill={C.nose} />

      {/* Mouth */}
      <path d="M 42 52 Q 45 55 48 52" stroke={C.roseDark} strokeWidth="1.2" strokeLinecap="round" fill="none" />

      {/* Whiskers */}
      <line x1="20" y1="48" x2="33" y2="50" stroke={C.roseDark} strokeWidth="0.8" opacity="0.4" />
      <line x1="20" y1="53" x2="33" y2="52" stroke={C.roseDark} strokeWidth="0.8" opacity="0.4" />
      <line x1="70" y1="48" x2="57" y2="50" stroke={C.roseDark} strokeWidth="0.8" opacity="0.4" />
      <line x1="70" y1="53" x2="57" y2="52" stroke={C.roseDark} strokeWidth="0.8" opacity="0.4" />

      {/* Blush */}
      {happy && (
        <>
          <ellipse cx="28" cy="50" rx="4" ry="2.5" fill={C.blush} />
          <ellipse cx="62" cy="50" rx="4" ry="2.5" fill={C.blush} />
        </>
      )}
    </svg>
  );
}

/* ── Momo: bunny ────────────────────────────────────────────────────── */
function Momo({ happy }: { happy?: boolean }) {
  return (
    <svg viewBox="0 0 90 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ears */}
      <ellipse cx="32" cy="18" rx="8" ry="18" fill={C.butter} transform="rotate(-10 32 18)" />
      <ellipse cx="32" cy="18" rx="4.5" ry="14" fill={C.cream} opacity="0.5" transform="rotate(-10 32 18)" />
      <ellipse cx="58" cy="18" rx="8" ry="18" fill={C.butter} transform="rotate(10 58 18)" />
      <ellipse cx="58" cy="18" rx="4.5" ry="14" fill={C.cream} opacity="0.5" transform="rotate(10 58 18)" />

      {/* Head / body */}
      <ellipse cx="45" cy="52" rx="24" ry="24" fill={C.butter} />
      <ellipse cx="45" cy="56" rx="17" ry="16" fill={C.cream} />

      {/* Eyes */}
      <ellipse cx="36" cy="46" rx={happy ? 4 : 3.5} ry={happy ? 5 : 4} fill={C.eye} />
      <ellipse cx="54" cy="46" rx={happy ? 4 : 3.5} ry={happy ? 5 : 4} fill={C.eye} />
      <circle cx={happy ? 37.5 : 37} cy="44.5" r="1.5" fill={C.eyeHighlight} />
      <circle cx={happy ? 55.5 : 55} cy="44.5" r="1.5" fill={C.eyeHighlight} />

      {/* Nose */}
      <ellipse cx="45" cy="52" rx="2.5" ry="2" fill={C.nose} />

      {/* Mouth */}
      {happy ? (
        <path d="M 41 55 Q 45 59 49 55" stroke={C.roseDark} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M 42 55 Q 45 57 48 55" stroke={C.roseDark} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      )}

      {/* Heart on belly */}
      <path
        d="M 45 64 C 45 62 42 59 40 61 C 38 63 40 66 45 69 C 50 66 52 63 50 61 C 48 59 45 62 45 64 Z"
        fill={C.rose}
        opacity={happy ? "0.8" : "0.5"}
      />

      {/* Blush */}
      {happy && (
        <>
          <ellipse cx="28" cy="52" rx="4" ry="2.5" fill={C.blush} />
          <ellipse cx="62" cy="52" rx="4" ry="2.5" fill={C.blush} />
        </>
      )}
    </svg>
  );
}

/* ── Dispatcher ─────────────────────────────────────────────────────── */

const PETS: Record<PetSpecies, (props: { happy?: boolean }) => ReactNode> = {
  bibi: Bibi,
  professor: Professor,
  pip: Pip,
  momo: Momo,
};

export function PetSvg({ species, happy = false, className }: PetSvgProps) {
  const Component = PETS[species];
  return (
    <div className={className} style={{ width: 90, height: 90 }}>
      <Component happy={happy} />
    </div>
  );
}
