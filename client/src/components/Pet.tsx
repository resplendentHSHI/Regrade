import { useState, useCallback } from "react";
import { type Pet, PET_INFO, PET_POKE_REACTIONS } from "@/lib/pet";
import { PetSvg } from "./PetSvg";

interface PetProps {
  pet: Pet;
  tip?: string | null;
  mood?: "idle" | "happy";
}

export function PetCompanion({ pet, tip, mood = "idle" }: PetProps) {
  const info = PET_INFO[pet.species];
  const [dancing, setDancing] = useState(false);
  const [pokeReaction, setPokeReaction] = useState<string | null>(null);

  const handlePoke = useCallback(() => {
    if (dancing) return;
    setDancing(true);
    const reactions = PET_POKE_REACTIONS[pet.species];
    setPokeReaction(reactions[Math.floor(Math.random() * reactions.length)]);
    setTimeout(() => {
      setDancing(false);
      setPokeReaction(null);
    }, 2000);
  }, [dancing, pet.species]);

  const showHappy = mood === "happy" || dancing;
  const displayTip = pokeReaction ?? tip;

  return (
    <div className="flex flex-col items-center gap-1.5 py-3 px-2 relative">
      {/* Speech bubble */}
      {displayTip && (
        <div key={displayTip} className="bubble-in w-full mb-1">
          <div className="speech-bubble relative rounded-2xl rounded-bl-sm bg-card border border-border px-3 py-2 text-xs leading-snug shadow-sm">
            <p className="text-card-foreground">{displayTip}</p>
          </div>
        </div>
      )}

      {/* Pet — clickable SVG */}
      <button
        type="button"
        onClick={handlePoke}
        className={`cursor-pointer transition-transform select-none ${
          dancing ? "pet-dance" : "pet-bob"
        }`}
        aria-label={`Poke ${info.displayName}`}
      >
        <PetSvg species={pet.species} happy={showHappy} />
      </button>

      {/* Name plate */}
      <div className="text-center mt-0.5">
        <p className="display-italic text-[13px] text-foreground/90 leading-tight">
          {info.displayName}
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          {info.species}
        </p>
      </div>
    </div>
  );
}
