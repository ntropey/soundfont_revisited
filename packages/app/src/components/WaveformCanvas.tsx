import { useEffect, useRef } from "react";
import { type Sf2Sample } from "@soundfont/core";

interface WaveformCanvasProps {
  sample: Sf2Sample | null;
}

export function WaveformCanvas({ sample }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(120, Math.floor(rect.height));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "#080C14";
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    for (let x = width / 4; x < width; x += width / 4) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();

    if (!sample || sample.pcmData.length === 0) {
      ctx.fillStyle = "#64748B";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("No sample selected", width / 2, height / 2 + 4);
      return;
    }

    const pcm = sample.pcmData;
    const len = pcm.length;

    // Loop region highlight
    if (sample.loopEnd > sample.loopStart && len > 0) {
      const lx1 = (sample.loopStart / len) * width;
      const lx2 = (sample.loopEnd / len) * width;
      ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), height);

      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(lx1, 0);
      ctx.lineTo(lx1, height);
      ctx.moveTo(lx2, 0);
      ctx.lineTo(lx2, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw min/max envelope waveform
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    const midY = height / 2;
    const amp = height * 0.44;
    const step = Math.max(1, Math.floor(len / width));

    for (let x = 0; x < width; x++) {
      const startIdx = Math.floor((x / width) * len);
      const endIdx = Math.min(len, startIdx + step);
      let min = 1;
      let max = -1;
      for (let i = startIdx; i < endIdx; i++) {
        const v = pcm[i] / 32768;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = midY - max * amp;
      const y2 = midY - min * amp;
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, Math.max(y1 + 1, y2));
    }
    ctx.stroke();

    // Overlay metadata badge
    ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
    ctx.fillRect(8, 8, 220, 22);
    ctx.fillStyle = "#E2E8F0";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    const durMs = ((len / (sample.sampleRate || 44100)) * 1000).toFixed(1);
    ctx.fillText(`${sample.sampleRate} Hz · ${len} smp (${durMs} ms)`, 14, 23);
  }, [sample, sample?.loopStart, sample?.loopEnd, sample?.pcmData]);

  return (
    <div className="waveform-wrap">
      <canvas ref={canvasRef} className="waveform-canvas" aria-label="Sample waveform visualizer" />
    </div>
  );
}
