import { useEffect, useState } from "react";

// The 3-Track spine of Cyber Odyssey:
// Track A (Scam Bazaar) -> Track B (Session Hijack) -> Track C (Forensics Hub) -> Ithaca (Finish)
export const MAP_STAGES = ["stage1", "trackB", "trackC", "complete"];

export const MAP_LABELS = {
  stage1: "Track A · Scam Bazaar",
  trackB: "Track B · Session Hijack",
  trackC: "Track C · Forensics Hub",
  complete: "Ithaca",
};

export const MAP_NODE_POSITIONS = [
  { x: 68, y: 88 },
  { x: 32, y: 62 },
  { x: 68, y: 36 },
  { x: 32, y: 10 },
];

export function buildSnakePath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const midY = (p0.y + p1.y) / 2;
    d += ` C ${p0.x},${midY} ${p1.x},${midY} ${p1.x},${p1.y}`;
  }
  return d;
}

const ICON_PATHS = {
  stage1: (
    <>
      <path d="M3 6h18v12H3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3.5 6.5 12 13 20.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  trackB: (
    <>
      <circle cx="8" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11.5 12H21M17.5 12v3M21 12v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  trackC: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" />
      <path d="M8 8l4 8 4-8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  complete: (
    <>
      <circle cx="12" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {/* Anchor. The second arc was missing a radius — "a9 9 0 0 0 9 9" followed
          by only six numbers, so the parser read the next arc as
          rx=9 ry=0 rot=0 large=0 sweep=9, and sweep must be 0 or 1. Chrome
          logged `Expected arc flag ('0' or '1')` on every render of the hub
          and dropped the rest of the path. Both arcs now carry both radii. */}
      <path
        d="M12 7v11M7 12H3a9 9 0 0 0 9 9 9 9 0 0 0 9-9h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
};

function MapLandmarkIcon({ stageKey }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {ICON_PATHS[stageKey] || ICON_PATHS.stage1}
    </svg>
  );
}

function FinishFlagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <line x1="4" y1="2" x2="4" y2="22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 3 L18 3 L14 6.5 L18 10 L4 10 Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="6.4" y="3.6" width="2.1" height="2" fill="currentColor" />
      <rect x="10.7" y="3.6" width="2.1" height="2" fill="currentColor" />
      <rect x="8.55" y="5.6" width="2.1" height="2" fill="currentColor" />
      <rect x="12.85" y="5.6" width="2.1" height="2" fill="currentColor" />
    </svg>
  );
}

export function VoyageMapPath({ currentIndex, initialY = 100, onEnterCurrent }) {
  const points = MAP_NODE_POSITIONS.slice(0, MAP_STAGES.length);
  const pathD = buildSnakePath(points);
  const targetY = points[currentIndex]?.y ?? 100;
  const finished = currentIndex >= MAP_STAGES.length - 1;

  const [revealY, setRevealY] = useState(initialY);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRevealY(targetY));
    return () => cancelAnimationFrame(id);
  }, [targetY]);

  return (
    <div className="map-path-wrap">
      <svg className="map-path-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={pathD} className="map-path-bg" />
        <g className="map-path-fg-wrap" style={{ clipPath: `inset(${revealY}% 0 0 0)` }}>
          <path d={pathD} className="map-path-fg" />
        </g>
      </svg>

      {MAP_STAGES.map((s, i) => {
        const p = points[i];
        const status = i < currentIndex ? "done" : i === currentIndex ? "current" : "future";
        const clickable = status === "current" && Boolean(onEnterCurrent);
        const Tag = clickable ? "button" : "div";
        return (
          <Tag
            key={s}
            type={clickable ? "button" : undefined}
            className={`map-pill map-pill-${status}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            onClick={clickable ? onEnterCurrent : undefined}
            aria-label={clickable ? `Continue to ${MAP_LABELS[s]}` : undefined}
          >
            <span className="map-pill-badge"><MapLandmarkIcon stageKey={s} /></span>
            <span className="map-pill-label">{MAP_LABELS[s]}</span>
            {clickable && <span className="map-pill-hint">Tap to enter</span>}
          </Tag>
        );
      })}

      <div
        className={"map-finish-flag-wrap" + (finished ? " map-finish-flag-lit" : "")}
        style={{ left: `${points[points.length - 1].x}%`, top: `${points[points.length - 1].y}%` }}
      >
        <FinishFlagIcon />
      </div>
    </div>
  );
}
