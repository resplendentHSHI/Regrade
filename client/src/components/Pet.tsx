import { type Pet, PET_ART, PET_ART_HAPPY, PET_INFO } from "@/lib/pet";

interface PetProps {
  pet: Pet;
  tip?: string | null;
  mood?: "idle" | "happy";
}

export function PetCompanion({ pet, tip, mood = "idle" }: PetProps) {
  const info = PET_INFO[pet.species];
  const art = mood === "happy" ? PET_ART_HAPPY[pet.species] : PET_ART[pet.species];

  return (
    <div className="flex flex-col items-center gap-1.5 py-3 px-2 relative">
      {/* Speech bubble */}
      {tip && (
        <div className="bubble-in w-full mb-1">
          <div className="speech-bubble relative rounded-2xl rounded-bl-sm bg-card border border-border px-3 py-2 text-xs leading-snug shadow-sm">
            <p className="text-card-foreground">{tip}</p>
          </div>
        </div>
      )}

      {/* Pet */}
      <div className="pet-bob">
        <pre className="ascii text-foreground/85">{art}</pre>
      </div>

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
