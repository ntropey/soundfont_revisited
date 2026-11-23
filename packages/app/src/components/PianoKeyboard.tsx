import { useEffect, useRef, useState } from "react";
import { midiNoteToName } from "@soundfont/core";

interface PianoKeyboardProps {
  onNoteOn: (midi: number) => void;
  onNoteOff: (midi: number) => void;
  onPanic: () => void;
  activeRange?: { lo: number; hi: number };
}

const KEYBOARD_MAP: Record<string, number> = {
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  q: 12,
  "2": 13,
  w: 14,
  "3": 15,
  e: 16,
  r: 17,
  "5": 18,
  t: 19,
  "6": 20,
  y: 21,
  "7": 22,
  u: 23,
  i: 24,
};

function isBlackKey(midi: number): boolean {
  const n = midi % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

export function PianoKeyboard({
  onNoteOn,
  onNoteOff,
  onPanic,
  activeRange,
}: PianoKeyboardProps) {
  const [baseOctave, setBaseOctave] = useState(4); // C4 = 60
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());
  const pointerDownRef = useRef<number | null>(null);
  const startMidi = (baseOctave + 1) * 12; // baseOctave 4 -> 60 (C4), 3 -> 48 (C3)
  const keys = Array.from({ length: 25 }, (_, i) => startMidi + i).filter((m) => m <= 127);

  const triggerOn = (midi: number) => {
    setPressedNotes((prev) => {
      if (prev.has(midi)) return prev;
      const next = new Set(prev);
      next.add(midi);
      return next;
    });
    onNoteOn(midi);
  };

  const triggerOff = (midi: number) => {
    setPressedNotes((prev) => {
      if (!prev.has(midi)) return prev;
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
    onNoteOff(midi);
  };

  useEffect(() => {
    const downMap = new Map<string, number>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const offset = KEYBOARD_MAP[e.key.toLowerCase()];
      if (offset === undefined) return;
      const midi = startMidi + offset;
      if (midi > 127) return;
      downMap.set(e.key.toLowerCase(), midi);
      triggerOn(midi);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const midi = downMap.get(key);
      if (midi !== undefined) {
        downMap.delete(key);
        triggerOff(midi);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      for (const midi of downMap.values()) {
        onNoteOff(midi);
      }
    };
  }, [startMidi]);

  const whiteKeys = keys.filter((m) => !isBlackKey(m));
  const whiteCount = whiteKeys.length;

  return (
    <section className="piano-dock" aria-label="Audition Piano Keyboard">
      <div className="piano-toolbar">
        <div className="piano-controls">
          <span className="piano-label">Audition Keyboard</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBaseOctave((o) => Math.max(0, o - 1))}
          >
            Oct -
          </button>
          <span className="mono-badge">
            {midiNoteToName(startMidi)} – {midiNoteToName(keys[keys.length - 1] ?? startMidi)}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBaseOctave((o) => Math.min(7, o + 1))}
          >
            Oct +
          </button>
        </div>
        <div className="piano-controls">
          <span className="piano-hint">Keys: Z–M / Q–I</span>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => {
              setPressedNotes(new Set());
              onPanic();
            }}
          >
            Panic (All Off)
          </button>
        </div>
      </div>

      <div
        className="piano-keys"
        onPointerLeave={() => {
          if (pointerDownRef.current !== null) {
            triggerOff(pointerDownRef.current);
            pointerDownRef.current = null;
          }
        }}
      >
        {whiteKeys.map((midi) => {
          const inRange = !activeRange || (midi >= activeRange.lo && midi <= activeRange.hi);
          const isPressed = pressedNotes.has(midi);
          return (
            <button
              key={midi}
              type="button"
              className={`key-white ${isPressed ? "is-pressed" : ""} ${inRange ? "in-range" : "out-range"}`}
              style={{ width: `${100 / whiteCount}%` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                pointerDownRef.current = midi;
                triggerOn(midi);
              }}
              onPointerUp={() => {
                if (pointerDownRef.current === midi) {
                  pointerDownRef.current = null;
                }
                triggerOff(midi);
              }}
              onPointerCancel={() => triggerOff(midi)}
              aria-label={midiNoteToName(midi)}
            >
              {midi % 12 === 0 && <span className="key-note">{midiNoteToName(midi)}</span>}
            </button>
          );
        })}

        {keys.map((midi) => {
          if (!isBlackKey(midi)) return null;
          const prevWhiteIndex = whiteKeys.findIndex((w) => w === midi - 1);
          if (prevWhiteIndex < 0) return null;
          const leftPct = ((prevWhiteIndex + 0.68) / whiteCount) * 100;
          const widthPct = (0.64 / whiteCount) * 100;
          const inRange = !activeRange || (midi >= activeRange.lo && midi <= activeRange.hi);
          const isPressed = pressedNotes.has(midi);

          return (
            <button
              key={midi}
              type="button"
              className={`key-black ${isPressed ? "is-pressed" : ""} ${inRange ? "in-range" : "out-range"}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                pointerDownRef.current = midi;
                triggerOn(midi);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                if (pointerDownRef.current === midi) {
                  pointerDownRef.current = null;
                }
                triggerOff(midi);
              }}
              onPointerCancel={() => triggerOff(midi)}
              aria-label={midiNoteToName(midi)}
            />
          );
        })}
      </div>
    </section>
  );
}
