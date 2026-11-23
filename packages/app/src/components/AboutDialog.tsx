import { useEffect, useRef } from "react";

export const REVISITED_AUDIO_SUITE = [
  {
    name: "CircuitBender 1984",
    url: "https://circuitbender.revisitedlabs.com",
    role: "FM & circuit-bent synth",
  },
  {
    name: "Mockingboard Revisited",
    url: "https://mockingboard.revisitedlabs.com",
    role: "AY-3-8910 chiptune tracker",
  },
  {
    name: "Algorithmic MIDI Companion",
    url: "https://midicompanion.revisitedlabs.com",
    role: "Generative MIDI sequencer",
  },
  {
    name: "Stem Studio",
    url: "https://stemstudio.revisitedlabs.com",
    role: "Multi-track stem mixer",
  },
] as const;

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;

    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = outside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && outside(e)) {
        dialog.close();
      }
    };
    dialog.addEventListener("pointerdown", onDown);
    dialog.addEventListener("pointerup", onUp);
    return () => {
      dialog.removeEventListener("pointerdown", onDown);
      dialog.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="studio-dialog"
      closedby="any"
      aria-labelledby="about-dialog-title"
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
        }
        onClose();
      }}
    >
      <div className="dialog-header">
        <h1 id="about-dialog-title">About SoundFont Revisited</h1>
        <form method="dialog">
          <button type="submit" className="btn btn-sm" autoFocus>
            Close
          </button>
        </form>
      </div>

      <div className="dialog-body">
        <p>
          <strong>SoundFont Revisited</strong> is a 100% client-side, offline{" "}
          <code>.sf2</code> &amp; <code>.sfz</code> SoundFont bank and instrument editor built by{" "}
          <a href="https://revisitedlabs.com/" target="_blank" rel="noopener noreferrer">
            Revisited Labs
          </a>
          .
        </p>

        <h2>Privacy &amp; Offline Guarantee</h2>
        <ul>
          <li>Zero server uploads: all RIFF binary parsing, PCM editing, and WAV/SFZ exports run locally in your browser.</li>
          <li>Zero telemetry, zero accounts, zero tracking cookies.</li>
          <li>Installable as an offline Progressive Web App (PWA).</li>
        </ul>

        <h2>Keyboard Shortcuts</h2>
        <ul>
          <li>
            <code>Z–M</code> &amp; <code>Q–I</code>: Play audition notes across two octaves.
          </li>
          <li>
            <code>Esc</code>: Close dialogs.
          </li>
        </ul>

        <h2>Revisited Audio Suite</h2>
        <ul className="suite-list">
          {REVISITED_AUDIO_SUITE.map((app) => (
            <li key={app.url}>
              <a href={app.url} target="_blank" rel="noopener noreferrer">
                {app.name}
              </a>{" "}
              — {app.role}
            </li>
          ))}
        </ul>

        <p className="license-note">
          Open-source software licensed under <strong>GPL-3.0-or-later</strong>.
        </p>
      </div>
    </dialog>
  );
}
