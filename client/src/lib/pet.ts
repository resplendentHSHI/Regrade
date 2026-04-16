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
      "A new pal! I already love this. What shall we read first?",
      "Hi there! I brought snacks. Metaphorically. Let's learn!",
    ],
    idle: [
      "Little and often beats all at once, you know.",
      "You're doing just fine — I've got an eye on things.",
      "Good work deserves its full points. Always.",
      "Take a breath. The grades will still be here in five minutes.",
      "Every paper has a story. Yours is going great ♡",
      "I've been practicing my reading. I'm very fast now!",
      "Did you drink water today? Just checking.",
      "You're allowed to be proud of small things.",
      "A cup of tea and a careful read — that's the recipe.",
      "Posture check! Shoulders down ♡",
      "Kind reminder: you are a student, not a grade.",
      "If today is a tough day, we'll go gentle. Deal?",
    ],
    analyzing: [
      "Reading between the lines now...",
      "Hmm, looking at this one carefully.",
      "One page at a time, one page at a time.",
      "Be right with you — just skimming the rubric.",
      "Ooh, a fresh one! Adjusting my tiny glasses.",
      "Comparing the work to the rubric. Very scholarly!",
    ],
    regrade_found: [
      "Oh! I think this one's worth asking about ♡",
      "Look, I found something! Here, have a peek.",
      "That looks a little off — shall we gently mention it?",
      "Found a wrinkle in the rubric. You should see this!",
      "This one caught my eye. I wrote you a polite draft ♡",
    ],
    no_issues: [
      "Nothing to worry about here! Fair grading all around.",
      "Clean as a library shelf ♡",
      "All in order! You can put this one to rest.",
      "Graded with care. Sometimes the grader gets it right!",
      "Everything checks out. Onwards!",
    ],
    streak: [
      "Look at you, going through the whole stack!",
      "Very thorough. I'm a little proud, not gonna lie.",
      "Consistency! That's how good students become great ones ♡",
      "You're in the zone. I love the zone.",
    ],
  },

  professor: {
    welcome: [
      "Hoo. A pleasure to make your acquaintance.",
      "Professor Hoot, at your service. Let us attend to your marks.",
      "Welcome! I believe we shall make a rather splendid team.",
      "Ah, a new student. Excellent. Office hours are always open.",
    ],
    idle: [
      "A well-examined paper is a well-earned grade.",
      "Diligence compounds. Kindly remember that.",
      "Consult the syllabus before arguing. Always.",
      "Hoo-hoo. Patience. The analysis will not rush itself.",
      "Rest is part of the work. Even owls sleep, you know.",
      "A brief walk sharpens the mind. Consider it.",
      "I find that a neat desk invites clearer thinking.",
      "Curiosity is the best study technique I know.",
      "Remember to eat. Brains are expensive machines.",
      "Knowledge is cumulative. Every page counts.",
      "The difference between good and great is a second read.",
      "Pride in your work is not arrogance. It's stewardship.",
    ],
    analyzing: [
      "Examining the rubric with due care...",
      "One moment — cross-referencing the deductions.",
      "Let us not hurry a careful read.",
      "Consulting the evidence now.",
      "Hoo. Turning the pages with deliberation.",
      "A thorough owl is a useful owl.",
    ],
    regrade_found: [
      "I believe a polite inquiry is warranted here.",
      "Attention: a discrepancy worth noting.",
      "A courteous email should resolve this quite nicely.",
      "I've drafted something. Civil, accurate, unfussy.",
      "The rubric and the work diverge here. Worth raising.",
    ],
    no_issues: [
      "Sound grading. I concur with the verdict.",
      "A fair assessment. No action required.",
      "The rubric was applied appropriately here.",
      "Well done to the grader, and well done to you.",
      "Tidy work all around. Nothing to contest.",
    ],
    streak: [
      "A scholarly pace. Most admirable.",
      "You honor the discipline with your thoroughness.",
      "This is how long careers begin. Steadily.",
      "Well, well. Quite the studious afternoon.",
    ],
  },

  pip: {
    welcome: [
      "oh. hi. guess I'm yours now. fine, this'll be good.",
      "Pip. I'm the pocket-sized second opinion. Nice to meet you.",
      "look at you. bringing me into your little academic life. cute.",
      "okay okay, I'm awake. let's do the thing.",
    ],
    idle: [
      "I'm rooting for you. quietly. from under this blanket.",
      "you're doing better than you think. that's my hot take.",
      "a tiny nap between assignments? strongly recommend.",
      "you know what's underrated? finishing things.",
      "small wins. they stack. trust me on this one.",
      "stretching is free and suspiciously effective.",
      "I may be a gremlin but I'm your gremlin.",
      "genuinely impressed by your follow-through today.",
      "reminder: the bar is you vs. yesterday-you.",
      "if you're reading this, you're handling it. that counts.",
      "I'd be nicer but I have a reputation to maintain.",
      "secretly proud of you. don't tell anyone.",
    ],
    analyzing: [
      "reading. give me a sec.",
      "ok this one's interesting. thinking.",
      "patience. brilliance doesn't hurry.",
      "skimming with the intensity of a hungry cat.",
      "hmm. give me a minute with this.",
    ],
    regrade_found: [
      "hey. this one's worth a second look. I'll wait.",
      "look at that. points on the table. let's collect.",
      "there it is. nice catch by me, if I do say so.",
      "worth an email. a friendly one. I know you got it.",
    ],
    no_issues: [
      "clean. rare, but it happens.",
      "fair enough. I'll allow it.",
      "graded correctly. respect where it's due.",
      "no notes. next one.",
    ],
    streak: [
      "look at you, actually doing the thing. so proud.",
      "this is productivity. I barely recognize you (affectionate).",
      "you're on a streak. I'm taking partial credit.",
    ],
  },

  momo: {
    welcome: [
      "HIIII!! I'm Momo!! So happy to meet you!!",
      "Omg a new friend!! I'm Momo. We're gonna be the best team!!",
      "Hi hi hi!! I hopped all the way here for you!!",
      "YOU'RE HERE!! I mean, hi! I'm Momo!!",
    ],
    idle: [
      "You're doing amazing!! Seriously!!",
      "Remember: you earned those points. Every single one!",
      "Deep breath!! It's gonna be great!!",
      "Big believer in you today!! And every day!!",
      "Don't forget to be a little silly between assignments!!",
      "Snack break?? I support snack break!!",
      "Good grades, great vibes — that's the Momo motto!!",
      "You look great today!! I can tell!!",
      "If no one told you yet: proud of you!!",
      "Tiny dance party, two seconds, let's go!! ✦✦✦",
      "You and me against the syllabus!! Let's goooo!!",
      "Gentle reminder: you are awesome!! Okay bye!!",
    ],
    analyzing: [
      "Oooh oooh let's see let's see!!",
      "Reading super carefully!!",
      "One sec!! Almost done!!",
      "Focus mode activated!!",
      "Hopping through the pages!!",
    ],
    regrade_found: [
      "YAY! We found one!! This feels good!!",
      "Points!!! We can get points back!!",
      "Hop to it — this one's totally worth asking!!",
      "Look look look!! Something to send in!!",
      "Ooooh this one!! This is the one!!",
    ],
    no_issues: [
      "All good!! Grader knew what they were doing!!",
      "Nothing wrong here!! Move along!!",
      "Clean!! Next one!!",
      "Fair grade!! Onward!!",
      "A+ to the grader this time!!",
    ],
    streak: [
      "You're on FIRE!! Keep going!!",
      "Look at you!! So much checking!! Amazing!!",
      "HOP HOP HOP what a pace!!",
      "This is peak Momo energy!! Love it!!",
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
