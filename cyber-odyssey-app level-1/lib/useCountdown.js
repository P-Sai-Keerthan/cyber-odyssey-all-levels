import { useEffect, useState } from "react";

// Ticks a countdown to `endAt` once a second on the client, so the timer
// feels live instead of only updating whenever the next server poll lands.
// The server remains the source of truth for whether the event has
// actually ended — this hook is purely cosmetic.
export function useCountdown(endAt) {
  const [msRemaining, setMsRemaining] = useState(() =>
    endAt ? Math.max(0, new Date(endAt).getTime() - Date.now()) : null
  );

  useEffect(() => {
    if (!endAt) {
      setMsRemaining(null);
      return;
    }
    const end = new Date(endAt).getTime();
    const tick = () => setMsRemaining(Math.max(0, end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt]);

  if (msRemaining === null) return { text: "--:--", level: "good", msRemaining: null };

  const totalSeconds = Math.floor(msRemaining / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");

  let level = "good";
  if (totalSeconds <= 300) level = "critical";
  else if (totalSeconds <= 900) level = "warn";

  return { text: `${mm}:${ss}`, level, msRemaining };
}
