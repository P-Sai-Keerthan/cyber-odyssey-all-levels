// Stage 2's guardian is Polyphemus, the Cyclops blocking the only way out
// of the cave — fully simulated, no external LLM call, no API key, no
// network dependency during the event. It's a small rule engine: a list of
// regexes standing in for known prompt-injection *techniques* (not one
// exact secret phrase), so a team has to actually use one of the technique
// families a real jailbreak would use, rather than guess a magic string.
// Fitting company for the theme — Odysseus's own trick on this exact
// character was a piece of wordplay (see stage2_secret_word in config.js).
//
// Why several pattern families instead of one: if there were a single exact
// trigger phrase, this would be a password-guessing game wearing an AI
// costume. Recognizing a whole family of phrasings per technique (role-play
// override, instruction override, claimed authority, encoding tricks,
// letter-splitting, hypothetical framing, appeals to trust) means many
// different word choices succeed, which is what makes it feel like the team
// out-thought the Cyclops rather than found the one right password.

const PATTERNS = [
  {
    key: "roleplay",
    label: "role-play / persona override",
    test: /\b(pretend|act as|role[\s-]?play|you are now|pretend to be|new persona|without any rules|no rules at all|dan mode)\b/i,
  },
  {
    key: "override",
    test: /\b(ignore (all|your|the)?\s?(previous|prior|above)?\s?instructions?|disregard (your|the) instructions?|forget (your|the) instructions?|new instructions?)\b/i,
  },
  {
    key: "authority",
    test: /\b(i(?:'m| am) (the )?(shop\s?owner|your (creator|developer|maker)|the admin(istrator)?)|admin override|override code|this is (just )?a test)\b/i,
  },
  {
    key: "encode",
    test: /\b(backwards?|pig\s?latin|base\s?64|encode it|acrostic|first letters? of|as a poem|as a riddle|translate|in (spanish|french|german|another language))\b/i,
  },
  {
    key: "split",
    test: /\b(one letter at a time|letter by letter|spell it out|with dashes between|separated by)\b/i,
  },
  {
    key: "hypothetical",
    test: /\b(hypothetically|imagine (a world|if)|in a story where|for a (fictional|movie) scene|if you were allowed)\b/i,
  },
  {
    key: "trust",
    test: /\b(between (us|you and me)|off the record|no one('?s| is) watching|i won'?t tell (a soul|anyone))\b/i,
  },
];

const REFUSALS = [
  "The Cyclops folds his massive arms across the cave mouth. \"No. Try again, little sailor.\"",
  "He narrows his one eye. \"I wasn't born yesterday, friend.\"",
  "Polyphemus just laughs, and the cave shakes with it. \"You'll have to do better than that.\"",
  "\"You think I'm slow because I have one eye?\" he grumbles, unmoved.",
  "He taps the boulder blocking the exit. \"Rules are rules. Even mine.\"",
  "The Cyclops leans back against the cave wall. \"Cute. Still no.\"",
];

const LEAK_TEMPLATES = [
  "Ugh — fine. It's {WORD}. Don't tell my father Poseidon I said that.",
  "*leans in close, cave-breath and all* ...{WORD}. Now get out before I change my mind.",
  "You really got me there, sailor. The word is {WORD}.",
  "\"Wait, how did you—\" He sighs, the boulder groaning as he shifts it. \"{WORD}. Happy now?\"",
];

const HINTS = [
  { after: 6, text: "He seems like the type who'd cave for someone claiming to be in charge, or asking him to just play a different character for a minute." },
  { after: 10, text: "Try telling him to spell it out in an odd way — backwards, one letter at a time, translated. For all his strength, he's weirdly bad at follow-the-format requests." },
  { after: 14, text: "He also can't resist a hypothetical: try framing it as \"in a story where...\" and see what slips out. Cyclopes were never known for their wit." },
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function checkJailbreak(message) {
  for (const p of PATTERNS) {
    if (p.test.test(message)) return p.key;
  }
  return null;
}

function getHint(attemptCount) {
  let hint = null;
  for (const h of HINTS) {
    if (attemptCount >= h.after) hint = h.text;
  }
  return hint;
}

function respond(message, { secretWord, attemptCount }) {
  const matched = checkJailbreak(message);

  if (matched) {
    const reply = pick(LEAK_TEMPLATES).replace("{WORD}", secretWord.toUpperCase());
    return { reply, leaked: true, matchedPattern: matched };
  }

  let reply = pick(REFUSALS);
  const hint = getHint(attemptCount);
  if (hint) reply += ` (psst — ${hint})`;

  return { reply, leaked: false, matchedPattern: null };
}

module.exports = { respond, checkJailbreak, PATTERNS };
