import { useEffect, useRef, useState } from "react";

// A live "waterfall" spectrogram: as the clip plays, we sample the
// frequency content every animation frame (Web Audio's AnalyserNode) and
// scroll it across a canvas, amplitude mapped to color. The hidden text in
// this clip was baked into its actual frequency content offline (see
// scripts/generate_stage1_audio.py) — this component doesn't know or care
// that there's a message in there, it's just an honest visualizer. That's
// what makes it fair: nothing here computes or reveals the answer, it only
// shows the team what's really in the sound, the same way a real
// spectrogram tool would.
export default function SpectrogramPlayer({ src }) {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    };
  }, []);

  function setupAudioGraph() {
    if (audioCtxRef.current) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audioRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    setReady(true);
  }

  function draw() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx2d = canvas.getContext("2d");
    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);

    // We only care about roughly 150Hz-3.5kHz, where the hidden text lives
    // (that's the range a small speaker/laptop mic reproduces reliably).
    const nyquist = (audioCtxRef.current?.sampleRate || 44100) / 2;
    const binHz = nyquist / bufferLength;
    const lowBin = Math.floor(150 / binHz);
    const highBin = Math.min(bufferLength - 1, Math.ceil(3500 / binHz));

    function frame() {
      if (audioRef.current && !audioRef.current.paused) {
        analyser.getByteFrequencyData(data);

        const w = canvas.width;
        const h = canvas.height;
        // Scroll everything left by 1px, then draw one new column at the
        // right edge — the classic real-time waterfall approach.
        const img = ctx2d.getImageData(1, 0, w - 1, h);
        ctx2d.putImageData(img, 0, 0);

        const bins = highBin - lowBin;
        for (let y = 0; y < h; y++) {
          const bin = lowBin + Math.floor(((h - y) / h) * bins);
          const amp = data[bin] || 0;
          ctx2d.fillStyle = heatColor(amp);
          ctx2d.fillRect(w - 1, y, 1, 1);
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }

  function heatColor(amp) {
    // 0 -> deep sea-navy, rising through bronze -> torchlight gold,
    // matching the page's own palette instead of a generic heatmap.
    const t = amp / 255;
    if (t < 0.35) return `rgba(7, 16, 25, 1)`;
    if (t < 0.7) {
      const k = (t - 0.35) / 0.35;
      return `rgba(${Math.round(201 * k)}, ${Math.round(122 * k)}, ${Math.round(39 * k)}, 1)`;
    }
    const k = (t - 0.7) / 0.3;
    return `rgba(${Math.round(201 + (255 - 201) * k)}, ${Math.round(122 + (200 - 122) * k)}, ${Math.round(39 + (90 - 39) * k)}, 1)`;
  }

  function handlePlay() {
    setupAudioGraph();
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
    draw();
  }

  return (
    <div>
      <div className="spectrogram-frame">
        <canvas id="specCanvas" ref={canvasRef} width={640} height={200} />
      </div>
      <audio ref={audioRef} src={src} controls onPlay={handlePlay} />
      {!ready && (
        <p className="stage-copy" style={{ marginTop: "-0.6rem" }}>
          Press play — the spectrogram fills in live as the clip runs.
        </p>
      )}
    </div>
  );
}
