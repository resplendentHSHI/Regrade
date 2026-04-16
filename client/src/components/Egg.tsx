import { useState } from "react";
import { savePet } from "@/lib/store";
import { newPet, type Pet, PET_ART, PET_INFO } from "@/lib/pet";

const EGG_ART = `   .--.
  /    \\
 ( ≀≀≀≀ )
  \\____/`;

const CRACKED_ART = `   .′ ʼ.
  / ✦    \\
 ( ≀ ✧ ≀ )
  \\_ᴗᴗ_/`;

interface EggProps {
  onHatched: (pet: Pet) => void;
}

export function Egg({ onHatched }: EggProps) {
  const [taps, setTaps] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [hatching, setHatching] = useState(false);
  const [revealed, setRevealed] = useState<Pet | null>(null);

  async function handleTap() {
    if (hatching || revealed) return;
    setShaking(true);
    setTimeout(() => setShaking(false), 600);
    const next = taps + 1;
    setTaps(next);
    if (next >= 3) {
      setHatching(true);
      setTimeout(async () => {
        const pet = newPet();
        await savePet(pet);
        setRevealed(pet);
        // Let the reveal animation play, then notify parent
        setTimeout(() => onHatched(pet), 1800);
      }, 500);
    }
  }

  if (revealed) {
    const info = PET_INFO[revealed.species];
    return (
      <div className="flex flex-col items-center gap-2 py-2 float-up">
        <div className="relative">
          <pre className="ascii text-foreground/80">{PET_ART[revealed.species]}</pre>
          <span
            className="sparkle absolute -top-1 -right-1 text-accent-foreground"
            style={{ animationDelay: "0s" }}
          >
            ✦
          </span>
          <span
            className="sparkle absolute -top-2 left-0 text-primary"
            style={{ animationDelay: "0.3s" }}
          >
            ✧
          </span>
          <span
            className="sparkle absolute -bottom-1 right-2 text-secondary-foreground"
            style={{ animationDelay: "0.6s" }}
          >
            ·
          </span>
        </div>
        <div className="text-center">
          <p className="display-italic text-sm">Meet {info.displayName}!</p>
          <p className="text-[10px] text-muted-foreground">{info.species}</p>
        </div>
      </div>
    );
  }

  const hint =
    taps === 0
      ? "tap to hatch"
      : taps === 1
      ? "something's moving..."
      : taps === 2
      ? "almost there!"
      : "";

  return (
    <button
      onClick={handleTap}
      className="flex flex-col items-center gap-2 py-2 w-full group"
      aria-label="hatch egg"
    >
      <pre
        className={`ascii transition-colors ${
          hatching
            ? "egg-crack text-primary"
            : shaking
            ? "egg-wiggle text-foreground"
            : "text-foreground/70 group-hover:text-foreground"
        }`}
      >
        {taps >= 2 ? CRACKED_ART : EGG_ART}
      </pre>
      <p className="display-italic text-xs text-muted-foreground italic">
        {hint}
      </p>
    </button>
  );
}
