/**
 * Poko companion system — ASCII art pets with distinct personalities.
 *
 * Each pet has:
 *   - a unique ASCII portrait (monospace, ~6 lines)
 *   - a name + personality descriptor
 *   - a bank of contextual tips/comments that reflect their voice
 *
 * Pets are randomly assigned at hatching. The app occasionally surfaces a tip
 * in a speech bubble above the pet in the sidebar.
 */

export type PetSpecies = "bibi" | "professor" | "pip" | "momo";

export type TipContext =
  | "welcome"
  | "idle"
  | "analyzing"
  | "regrade_found"
  | "no_issues"
  | "streak";

export interface Pet {
  species: PetSpecies;
  name: string;
  hatchedAt: string;
  tipsShown: number;
  lastTipAt: string | null;
}

/* ──────────────────── ASCII Portraits ──────────────────── */
/*
 * Designed in monospace. Each portrait is 5-7 lines tall, centered, and
 * reads well in JetBrains Mono at ~0.78rem / 1.05 line-height.
 */

export const PET_ART: Record<PetSpecies, string> = {
  // Bibi — a tiny worm peeking out of a book, sweet eyes
  bibi: `   _______
  /  ___  \\
 |  (o_o)  |
 |   \\ /   |
  \\__‿‿__/
   \`\`---\`\``,

  // Professor — owl with spectacles, wise look
  professor: `   ___
  (o,o)
  (___)
  -"-"-
  /   \\
 (     )`,

  // Pip — grumpy cat / gremlin with narrow eyes
  pip: `  /\\_/\\
 ( ._. )
  >   <
 (     )
  ^\` \`^`,

  // Momo — bunny with long ears and a bow
  momo: `   /|   |\\
   )o_o(
   (   )
  /     \\
 |   ♡   |
  \\_____/`,
};

/*
 * Alternate "happy" variants shown when a regrade is found or streak hits.
 * Keeping it subtle — same width, just different expression.
 */
export const PET_ART_HAPPY: Record<PetSpecies, string> = {
  bibi: `   _______
  /  ___  \\
 |  (^_^)  |
 |   \\v/   |
  \\__‿‿__/
   \`\`---\`\``,
  professor: `   ___
  (^,^)
  (___)
  -"-"-
  /   \\
 (     )`,
  pip: `  /\\_/\\
 ( o.o )
  > ! <
 (     )
  ^\` \`^`,
  momo: `   /|   |\\
   )^_^(
   (   )
  /  ✦  \\
 |   ♡   |
  \\_____/`,
};

export const PET_INFO: Record<PetSpecies, {
  displayName: string;
  species: string;
  personality: string;
  accent: "rose" | "sage" | "butter" | "lavender";
}> = {
  bibi: {
    displayName: "Bibi",
    species: "Bookworm",
    personality: "Sweet, encouraging, studious",
    accent: "rose",
  },
  professor: {
    displayName: "Professor Hoot",
    species: "Owl",
    personality: "Wise, formal, thoughtful",
    accent: "butter",
  },
  pip: {
    displayName: "Pip",
    species: "Gremlin",
    personality: "Dry, sarcastic, secretly loyal",
    accent: "lavender",
  },
  momo: {
    displayName: "Momo",
    species: "Bunny",
    personality: "Sunshine-cheerful, excitable",
    accent: "sage",
  },
};

/* ──────────────────── Tip banks ──────────────────── */

export const TIPS: Record<PetSpecies, Record<TipContext, string[]>> = {
  bibi: {
    welcome: [
      "Hi!! I'm Bibi. I'll help you catch any mix-ups ♡",
      "Oh! Hello, friend. Let's look after your grades together.",
    ],
    idle: [
      "Little and often beats all at once, you know.",
      "You're doing just fine — I've got an eye on things.",
      "If your gut says something's off, it usually is.",
      "Good work deserves its full points. Always.",
      "Take a breath. The grades will still be here in five minutes.",
    ],
    analyzing: [
      "Reading between the lines now...",
      "Hmm, looking at this one carefully.",
      "One page at a time, one page at a time.",
      "Be right with you — just skimming the rubric.",
    ],
    regrade_found: [
      "Oh! I think this one's worth asking about ♡",
      "Look, I found something! Here, have a peek.",
      "That looks a little off — shall we gently mention it?",
    ],
    no_issues: [
      "Nothing to worry about here! Fair grading all around.",
      "Clean as a library shelf ♡",
      "All in order! You can put this one to rest.",
    ],
    streak: [
      "Look at you, going through the whole stack!",
      "Very thorough. I'm a little proud, not gonna lie.",
    ],
  },

  professor: {
    welcome: [
      "Hoo. A pleasure to make your acquaintance.",
      "Professor Hoot, at your service. Let us attend to your marks.",
    ],
    idle: [
      "A well-examined paper is a well-earned grade.",
      "Diligence compounds. So do small errors, unfortunately.",
      "Remember: the rubric is a suggestion the grader follows imperfectly.",
      "Consult the syllabus before arguing. Always.",
      "Hoo-hoo. Patience. The analysis will not rush itself.",
    ],
    analyzing: [
      "Examining the rubric with due care...",
      "One moment — cross-referencing the deductions.",
      "Let us not hurry a careful read.",
      "Consulting the evidence now.",
    ],
    regrade_found: [
      "I believe a polite inquiry is warranted here.",
      "Attention: a discrepancy worth noting.",
      "The grader appears to have overlooked something. Observe.",
    ],
    no_issues: [
      "Sound grading. I concur with the verdict.",
      "A fair assessment. No action required.",
      "The rubric was applied appropriately here.",
    ],
    streak: [
      "A scholarly pace. Most admirable.",
      "You honor the discipline with your thoroughness.",
    ],
  },

  pip: {
    welcome: [
      "oh. hi. guess I'm yours now.",
      "Pip. I watch things. Let's see what mess we have.",
    ],
    idle: [
      "Your grades aren't going to audit themselves.",
      "TAs are tired. Tired TAs miss things. Just saying.",
      "I'd take a nap but someone has to keep an eye on this.",
      "Another day, another rubric crime probably.",
      "If the grader used 'close enough', it's usually not.",
    ],
    analyzing: [
      "reading. don't bother me.",
      "ugh. fine. looking.",
      "oh interesting. this one's sloppy.",
      "patience. genius at work. maybe.",
    ],
    regrade_found: [
      "yep. they botched it. told you.",
      "points stolen. recovery time.",
      "this one. this one's worth the email.",
    ],
    no_issues: [
      "hmph. fair enough this time.",
      "no complaints. weird, but okay.",
      "graded correctly. I'm as surprised as you.",
    ],
    streak: [
      "you're really going through it, huh.",
      "look at you, actually caring. cute.",
    ],
  },

  momo: {
    welcome: [
      "HIIII!! I'm Momo!! Let's get your points back!!",
      "Omg a new friend!! I'm Momo. We're gonna be the best team.",
    ],
    idle: [
      "Checking your grades is self-care!! Fact!!",
      "You're doing amazing!! Seriously!!",
      "Remember: you earned those points. Every one!",
      "Deep breath!! It's gonna be great!!",
      "We're partners in crime now. Grade crime. You know what I mean.",
    ],
    analyzing: [
      "Oooh oooh let's see let's see!!",
      "Reading super carefully!!",
      "One sec!! Almost done!!",
      "Focus mode activated!!",
    ],
    regrade_found: [
      "YAY! We found one!! This feels good!!",
      "Points!!! We can get points back!!",
      "Hop to it — this one's totally worth asking!!",
    ],
    no_issues: [
      "All good!! Grader knew what they were doing!!",
      "Nothing wrong here!! Move along!!",
      "Clean!! Next one!!",
    ],
    streak: [
      "You're on FIRE!! Keep going!!",
      "Look at you!! So much checking!! Amazing!!",
    ],
  },
};

/* ──────────────────── Helpers ──────────────────── */

export function randomSpecies(): PetSpecies {
  const options: PetSpecies[] = ["bibi", "professor", "pip", "momo"];
  return options[Math.floor(Math.random() * options.length)];
}

export function getRandomTip(species: PetSpecies, context: TipContext): string {
  const bank = TIPS[species][context];
  return bank[Math.floor(Math.random() * bank.length)];
}

export function newPet(species: PetSpecies = randomSpecies()): Pet {
  return {
    species,
    name: PET_INFO[species].displayName,
    hatchedAt: new Date().toISOString(),
    tipsShown: 0,
    lastTipAt: null,
  };
}

/* Accent color class helper for the speech bubble */
export function accentClass(species: PetSpecies): string {
  const map = {
    rose: "border-primary/40",
    sage: "border-secondary/60",
    butter: "border-accent/60",
    lavender: "border-[oklch(0.7_0.1_320)/40%]",
  };
  return map[PET_INFO[species].accent];
}
