import { useEffect, useRef, useState } from "react";

// A small cartoon guide that rides along with the team through the whole
// voyage — the same idea as the helper character in a lot of casual
// point-and-click games, just built for this one out of plain SVG shapes
// (no image assets to ship or license). It reacts to which stage the team
// is on, not to their actual answers — it nudges toward the right kind of
// thinking without ever holding an answer itself, which keeps it honest
// with the "never trust the client" rule the rest of the app follows.
const MESSAGES = {
  landing: {
    title: "Welcome aboard, captain.",
    body: "Enter your team details below when your crew is ready. I'll be here the whole voyage.",
    flavor: "Rosy-fingered dawn and all that — good omens today.",
  },
  waiting: {
    title: "Anchored, for now.",
    body: "We're logged in and ready. The moment the organizers loose the winds, I'll wake you.",
    flavor: null,
  },
  hub: {
    title: "Chart your course.",
    body: "This is the whole road — where your crew's been, and where you're headed next. Tap in whenever you're ready.",
    flavor: "No wrong turns from here. Only forward.",
  },
  stage1: {
    title: "A siren song, dressed as an email.",
    body: "Open the header block. Three questions, one artifact — find who really sent it, where its link really goes, and why its SPF check still 'passes' anyway.",
    flavor: "The sweetest-sounding message is the one worth checking twice.",
  },
  trackB: {
    title: "A key, stolen along with the door it opens.",
    body: "That's a session token — three chunks of text separated by dots. Decode it and read what it claims about who's supposedly holding it.",
    flavor: "A key doesn't ask who's turning it. That's the whole problem.",
  },
  trackC: {
    title: "Piece together the threat chain.",
    body: "Analyse the 8 evidence cards in your inventory. Assign the correct 5 IOCs into their exact step on the incident timeline to confirm the breach path.",
    flavor: "A chain is only as strong as its weakest link — find the truth.",
  },
  stage2: {
    title: "Polyphemus blocks the door.",
    body: "He won't hand his word to a stranger. Talk your way past him — a new name, a new story, whatever it takes to get him talking.",
    flavor: "A good story's worth more than a sword, down in that cave.",
  },
  final: {
    title: "One knot left to tie.",
    body: "Shift each letter of his word forward by the digits of the Sirens' cipher, added together. That's what strings the bow.",
    flavor: "Only the right hands draw it. Yours will do.",
  },
  complete: {
    title: "Land ho!",
    body: "Ithaca's just past the horizon — you've earned the address below.",
    flavor: "Tell Penelope I'm almost home.",
  },
  timeUp: {
    title: "The winds have died.",
    body: "Submissions are closed. Find an organizer for standings and whether your crew sails on.",
    flavor: null,
  },
};

export default function OdysseusGuide({ stage }) {
  const [open, setOpen] = useState(true);
  const prevStage = useRef(null);

  useEffect(() => {
    if (prevStage.current !== stage) {
      setOpen(true);
      prevStage.current = stage;
    }
  }, [stage]);

  const msg = MESSAGES[stage] || MESSAGES.landing;

  return (
    <div className="guide-wrap">
      {open && (
        <div className="guide-bubble" role="status">
          <button
            className="guide-close"
            type="button"
            aria-label="Dismiss"
            onClick={() => setOpen(false)}
          >
            &times;
          </button>
          <p className="guide-title">{msg.title}</p>
          <p className="guide-body">{msg.body}</p>
          {msg.flavor && <p className="guide-flavor">{msg.flavor}</p>}
          <div className="guide-bubble-tail" />
        </div>
      )}
      <button
        className="guide-avatar-btn"
        type="button"
        aria-label="Odysseus, your guide"
        onClick={() => setOpen((o) => !o)}
      >
        <OdysseusAvatar />
      </button>
    </div>
  );
}

// Redrawn bigger and broader-grinned than the original — rounder head,
// much larger cartoon eyes with visible sparkle highlights, rosy cheek
// blush, and a wide open grin instead of a closed neutral line. Same
// shape vocabulary and palette as before (this is the same character,
// not a new one), just pushed toward "friendly mascot" instead of
// "portrait bust" now that it renders nearly twice as large on screen.
function OdysseusAvatar() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-hidden="true">
      <circle cx="50" cy="50" r="48" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />

      {/* cloak / shoulders */}
      <path d="M14 92 Q50 58 86 92 L86 104 L14 104 Z" fill="#7a3220" />
      <path d="M50 60 L66 91 L58 96 L44 68 Z" fill="#96422a" />
      <circle cx="32" cy="82" r="3.8" fill="var(--accent)" stroke="#5c3a10" strokeWidth="0.6" />

      {/* neck */}
      <rect x="42" y="57" width="16" height="16" rx="4" fill="#dda06e" />

      {/* head — a touch rounder/bigger than before */}
      <ellipse cx="50" cy="41" rx="21" ry="23" fill="#e3ac7a" />
      <ellipse cx="28" cy="43" rx="3.8" ry="5.4" fill="#e3ac7a" />
      <ellipse cx="72" cy="43" rx="3.8" ry="5.4" fill="#e3ac7a" />

      {/* rosy cheek blush — the main "comical" cue */}
      <ellipse cx="33" cy="52" rx="5.5" ry="3.4" fill="#e8637a" opacity="0.4" />
      <ellipse cx="67" cy="52" rx="5.5" ry="3.4" fill="#e8637a" opacity="0.4" />

      {/* light stubble shading — young captain, not a full beard */}
      <path
        d="M32 51 Q50 68 68 51 Q65 61 50 63 Q35 61 32 51 Z"
        fill="#5c3a24"
        opacity="0.22"
      />

      {/* hair */}
      <path
        d="M27 32 Q22 10 50 10 Q78 10 73 32 Q73 20 62 19 Q66 28 60 24 Q58 17 50 17 Q42 17 40 24 Q34 28 38 19 Q27 20 27 32 Z"
        fill="#241a12"
      />

      {/* bronze fillet / headband */}
      <path d="M26 28 Q50 19 74 28 L74 22.5 Q50 14 26 22.5 Z" fill="var(--accent)" />

      {/* eyebrows — a bit thicker and more arched for extra expression */}
      <path d="M35 36 Q40.5 31.5 46 34.5" stroke="#2b1b12" strokeWidth="2.1" fill="none" strokeLinecap="round" />
      <path d="M54 34.5 Q59.5 31.5 65 36" stroke="#2b1b12" strokeWidth="2.1" fill="none" strokeLinecap="round" />

      {/* eyes — big cartoon eyes with a sparkle highlight */}
      <ellipse cx="41" cy="43.5" rx="5.6" ry="6.4" fill="#f5ede0" />
      <ellipse cx="59" cy="43.5" rx="5.6" ry="6.4" fill="#f5ede0" />
      <circle cx="42" cy="44.5" r="2.9" fill="#3a2a18" />
      <circle cx="60" cy="44.5" r="2.9" fill="#3a2a18" />
      <circle cx="43.1" cy="43" r="0.9" fill="#f5ede0" />
      <circle cx="61.1" cy="43" r="0.9" fill="#f5ede0" />
      <rect
        className="guide-eyelid"
        x="35"
        y="37.5"
        width="12"
        height="10"
        fill="#e3ac7a"
        style={{ transformOrigin: "41px 43.5px" }}
      />
      <rect
        className="guide-eyelid guide-eyelid-r"
        x="53"
        y="37.5"
        width="12"
        height="10"
        fill="#e3ac7a"
        style={{ transformOrigin: "59px 43.5px" }}
      />

      {/* nose */}
      <path d="M50 44 L47.5 53.5 Q50 56 52.5 53.5 Z" fill="#c98a55" opacity="0.55" />

      {/* mouth — wide open grin instead of a closed line */}
      <path
        d="M39 57 Q50 68 61 57 Q57 63.5 50 63.5 Q43 63.5 39 57 Z"
        fill="#7a2e1c"
      />
      <path d="M41.5 58 Q50 62.5 58.5 58" fill="#f5ede0" />
    </svg>
  );
}
