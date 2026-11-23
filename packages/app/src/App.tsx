import { useMemo, useRef, useState } from "react";
import {
  cloneZone,
  createDemoBank,
  exportPresetToSfz,
  getZoneAdsr,
  getZoneGenerator,
  getZoneRange,
  getZoneScalar,
  midiNoteToName,
  parseSf2,
  setZoneAdsr,
  setZoneRange,
  setZoneScalar,
  type Sf2Bank,
  SF2_GENERATOR,
  validateBank,
  writeSf2,
} from "@soundfont/core";
import { AuditionEngine } from "./audio/auditionEngine";
import { AboutDialog } from "./components/AboutDialog";
import { PianoKeyboard } from "./components/PianoKeyboard";
import { WaveformCanvas } from "./components/WaveformCanvas";

type ExplorerTab = "presets" | "instruments" | "samples" | "info";

function downloadBlob(data: Uint8Array | string, filename: string, mime: string): void {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: mime })
      : new Blob([new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeSlug(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "soundfont";
}

export function App() {
  const [bank, setBank] = useState<Sf2Bank>(() => createDemoBank());
  const [tab, setTab] = useState<ExplorerTab>("presets");
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(0);
  const [selectedInstIdx, setSelectedInstIdx] = useState(0);
  const [selectedZoneIdx, setSelectedZoneIdx] = useState(0);
  const [selectedSampleIdx, setSelectedSampleIdx] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Loaded Retro GM Starter Bank (offline).");
  const [aboutOpen, setAboutOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<AuditionEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AuditionEngine();
  }

  const diagnostics = useMemo(() => validateBank(bank), [bank]);

  const currentPreset = bank.presets[selectedPresetIdx] ?? null;

  // Resolve active instrument & zone from either Preset view or Instrument view
  const resolvedInstIdx = useMemo(() => {
    if (tab === "instruments") return selectedInstIdx;
    if (currentPreset) {
      for (const pz of currentPreset.zones) {
        const g = getZoneGenerator(pz, SF2_GENERATOR.instrument);
        if (g && typeof g.amount === "number") return g.amount;
      }
    }
    return selectedInstIdx;
  }, [tab, currentPreset, selectedInstIdx]);

  const currentInst = bank.instruments[resolvedInstIdx] ?? null;
  const currentZone = currentInst?.zones[selectedZoneIdx] ?? currentInst?.zones[0] ?? null;
  const activeZoneIdx = currentInst?.zones[selectedZoneIdx] ? selectedZoneIdx : 0;

  const resolvedSampleIdx = useMemo(() => {
    if (tab === "samples") return selectedSampleIdx;
    if (currentZone) {
      const sg = getZoneGenerator(currentZone, SF2_GENERATOR.sampleID);
      if (sg && typeof sg.amount === "number") return sg.amount;
    }
    return selectedSampleIdx;
  }, [tab, currentZone, selectedSampleIdx]);

  const currentSample = bank.samples[resolvedSampleIdx] ?? null;

  const mutateBank = (updater: (draft: Sf2Bank) => void) => {
    setBank((prev) => {
      const next: Sf2Bank = {
        info: { ...prev.info },
        samples: prev.samples.map((s) => ({ ...s })),
        instruments: prev.instruments.map((inst) => ({
          ...inst,
          zones: inst.zones.map((z) => cloneZone(z)),
        })),
        presets: prev.presets.map((p) => ({
          ...p,
          zones: p.zones.map((z) => cloneZone(z)),
        })),
      };
      updater(next);
      return next;
    });
  };

  const handleLoadFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSf2(buf);
      engineRef.current?.allNotesOff();
      setBank(parsed);
      setSelectedPresetIdx(0);
      setSelectedInstIdx(0);
      setSelectedZoneIdx(0);
      setSelectedSampleIdx(0);
      setStatusMsg(
        `Loaded "${parsed.info.inam}" (${parsed.presets.length} presets, ${parsed.samples.length} samples).`
      );
    } catch (err) {
      setStatusMsg(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportSf2 = () => {
    const bytes = writeSf2(bank);
    downloadBlob(bytes, `${safeSlug(bank.info.inam)}.sf2`, "application/octet-stream");
    setStatusMsg(`Exported ${safeSlug(bank.info.inam)}.sf2 (${(bytes.length / 1024).toFixed(1)} KB).`);
  };

  const handleExportSfz = () => {
    if (!currentPreset) return;
    const { sfzText, wavFiles } = exportPresetToSfz(bank, selectedPresetIdx);
    const slug = safeSlug(currentPreset.name);
    downloadBlob(sfzText, `${slug}.sfz`, "text/plain;charset=utf-8");
    for (const wav of wavFiles) {
      downloadBlob(wav.data, wav.filename, "audio/wav");
    }
    setStatusMsg(`Exported ${slug}.sfz + ${wavFiles.length} WAV sample(s).`);
  };

  const activeKeyRange = currentZone
    ? getZoneRange(currentZone, SF2_GENERATOR.keyRange)
    : undefined;

  const zoneVelRange = currentZone
    ? getZoneRange(currentZone, SF2_GENERATOR.velRange)
    : { lo: 0, hi: 127 };

  const zoneRootKey = currentZone
    ? getZoneScalar(
        currentZone,
        SF2_GENERATOR.overridingRootKey,
        currentSample && currentSample.originalPitch <= 127 ? currentSample.originalPitch : 60
      )
    : 60;

  const zoneCoarse = currentZone ? getZoneScalar(currentZone, SF2_GENERATOR.coarseTune, 0) : 0;
  const zoneFine = currentZone ? getZoneScalar(currentZone, SF2_GENERATOR.fineTune, 0) : 0;
  const zoneLoopMode = currentZone ? getZoneScalar(currentZone, SF2_GENERATOR.sampleModes, 0) : 0;
  const zoneAdsr = currentZone
    ? getZoneAdsr(currentZone)
    : { delaySec: 0, attackSec: 0.01, holdSec: 0, decaySec: 0.2, sustainLevel: 0.8, releaseSec: 0.25 };

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="brand-group">
          <img src="/icon.svg" alt="" className="brand-icon" width={28} height={28} />
          <div>
            <h1 className="brand-title">SoundFont Revisited</h1>
            <p className="brand-subtitle">
              {bank.info.inam} · {bank.presets.length} Presets · {bank.samples.length} Samples
            </p>
          </div>
        </div>

        <div className="header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".sf2,.SF2"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleLoadFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            Load .sf2
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              engineRef.current?.allNotesOff();
              setBank(createDemoBank());
              setSelectedPresetIdx(0);
              setSelectedInstIdx(0);
              setSelectedZoneIdx(0);
              setSelectedSampleIdx(0);
              setStatusMsg("Reset to Retro GM Starter Bank.");
            }}
          >
            Demo Bank
          </button>
          <button type="button" className="btn btn-accent" onClick={handleExportSf2}>
            Export .sf2
          </button>
          <button
            type="button"
            className="btn"
            disabled={!currentPreset}
            onClick={handleExportSfz}
          >
            Export .sfz
          </button>
          <button type="button" className="btn" onClick={() => setAboutOpen(true)}>
            About
          </button>
        </div>
      </header>

      <main className="studio-main">
        {/* Left Explorer */}
        <aside className="panel explorer-panel" aria-label="Bank Explorer">
          <div className="tab-bar" role="tablist">
            {(["presets", "instruments", "samples", "info"] as ExplorerTab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`tab-btn ${tab === t ? "is-active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="explorer-list">
            {tab === "presets" &&
              bank.presets.map((p, idx) => (
                <button
                  key={`${p.bank}-${p.preset}-${idx}`}
                  type="button"
                  className={`list-item ${idx === selectedPresetIdx ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedPresetIdx(idx);
                    setSelectedZoneIdx(0);
                  }}
                >
                  <span className="mono-tag">
                    {String(p.bank).padStart(3, "0")}:{String(p.preset).padStart(3, "0")}
                  </span>
                  <span className="item-name">{p.name}</span>
                </button>
              ))}

            {tab === "instruments" &&
              bank.instruments.map((inst, idx) => (
                <button
                  key={`${inst.name}-${idx}`}
                  type="button"
                  className={`list-item ${idx === resolvedInstIdx ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedInstIdx(idx);
                    setSelectedZoneIdx(0);
                  }}
                >
                  <span className="mono-tag">#{idx}</span>
                  <span className="item-name">{inst.name}</span>
                  <span className="item-meta">{inst.zones.length}z</span>
                </button>
              ))}

            {tab === "samples" &&
              bank.samples.map((s, idx) => (
                <button
                  key={`${s.name}-${idx}`}
                  type="button"
                  className={`list-item ${idx === resolvedSampleIdx ? "is-selected" : ""}`}
                  onClick={() => setSelectedSampleIdx(idx)}
                >
                  <span className="mono-tag">{midiNoteToName(s.originalPitch)}</span>
                  <span className="item-name">{s.name}</span>
                  <span className="item-meta">{s.sampleRate}Hz</span>
                </button>
              ))}

            {tab === "info" && (
              <div className="info-pane">
                <label className="field">
                  <span>Bank Name (INAM)</span>
                  <input
                    type="text"
                    value={bank.info.inam}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.inam = e.target.value;
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Author / Engineer (IENG)</span>
                  <input
                    type="text"
                    value={bank.info.ieng ?? ""}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.ieng = e.target.value;
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Copyright (ICOP)</span>
                  <input
                    type="text"
                    value={bank.info.icop ?? ""}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.icop = e.target.value;
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Comments (ICMT)</span>
                  <textarea
                    rows={3}
                    value={bank.info.icmt ?? ""}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.icmt = e.target.value;
                      })
                    }
                  />
                </label>

                <h3 className="subhead">Symbolic Bank Diagnostics</h3>
                <ul className="diag-list">
                  {diagnostics.map((d, i) => (
                    <li key={i} className={`diag-item diag-${d.severity}`}>
                      <strong>[{d.severity.toUpperCase()}]</strong> {d.targetName}: {d.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>

        {/* Center: Waveform + Zone Inspector */}
        <section className="panel workspace-panel" aria-label="Waveform and Zone Editor">
          <div className="section-header">
            <h2>
              {currentSample ? `Sample: ${currentSample.name}` : "Waveform Visualizer"}
            </h2>
            {currentSample && (
              <button
                type="button"
                className="btn btn-sm btn-accent"
                onClick={() => {
                  const midi = currentSample.originalPitch <= 127 ? currentSample.originalPitch : 60;
                  engineRef.current?.playSampleNote(currentSample, midi, 110);
                  setTimeout(() => engineRef.current?.noteOff(midi), 450);
                }}
              >
                Audition Sample ({midiNoteToName(currentSample.originalPitch)})
              </button>
            )}
          </div>

          <WaveformCanvas sample={currentSample} />

          {/* Preset / Instrument Header Editor */}
          <div className="meta-row">
            {currentPreset && (
              <label className="field-inline">
                <span>Preset Name</span>
                <input
                  type="text"
                  maxLength={20}
                  value={currentPreset.name}
                  onChange={(e) =>
                    mutateBank((d) => {
                      d.presets[selectedPresetIdx].name = e.target.value;
                    })
                  }
                />
              </label>
            )}
            {currentInst && (
              <label className="field-inline">
                <span>Instrument</span>
                <input
                  type="text"
                  maxLength={20}
                  value={currentInst.name}
                  onChange={(e) =>
                    mutateBank((d) => {
                      d.instruments[resolvedInstIdx].name = e.target.value;
                    })
                  }
                />
              </label>
            )}
          </div>

          {/* Instrument Zones Bar */}
          {currentInst && (
            <div className="zone-strip">
              <div className="zone-pills">
                {currentInst.zones.map((z, idx) => {
                  const kr = getZoneRange(z, SF2_GENERATOR.keyRange);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`zone-pill ${idx === activeZoneIdx ? "is-active" : ""}`}
                      onClick={() => setSelectedZoneIdx(idx)}
                    >
                      Zone {idx + 1} ({midiNoteToName(kr.lo)}–{midiNoteToName(kr.hi)})
                    </button>
                  );
                })}
              </div>
              <div className="zone-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!currentZone}
                  onClick={() => {
                    if (!currentZone) return;
                    mutateBank((d) => {
                      d.instruments[resolvedInstIdx].zones.push(cloneZone(currentZone));
                    });
                    setSelectedZoneIdx(currentInst.zones.length);
                  }}
                >
                  + Duplicate Zone
                </button>
              </div>
            </div>
          )}

          {/* Zone & Sample Parameters Grid */}
          {currentZone && currentSample && (
            <div className="editor-grid">
              <div className="editor-card">
                <h3>Key &amp; Velocity Mapping</h3>
                <div className="two-col">
                  <label className="field">
                    <span>Key Low ({midiNoteToName(activeKeyRange?.lo ?? 0)})</span>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      value={activeKeyRange?.lo ?? 0}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneRange(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.keyRange,
                            Number(e.target.value),
                            activeKeyRange?.hi ?? 127
                          );
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Key High ({midiNoteToName(activeKeyRange?.hi ?? 127)})</span>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      value={activeKeyRange?.hi ?? 127}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneRange(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.keyRange,
                            activeKeyRange?.lo ?? 0,
                            Number(e.target.value)
                          );
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Vel Low</span>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      value={zoneVelRange.lo}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneRange(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.velRange,
                            Number(e.target.value),
                            zoneVelRange.hi
                          );
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Vel High</span>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      value={zoneVelRange.hi}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneRange(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.velRange,
                            zoneVelRange.lo,
                            Number(e.target.value)
                          );
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="editor-card">
                <h3>Pitch &amp; Loop</h3>
                <div className="two-col">
                  <label className="field">
                    <span>Root Key ({midiNoteToName(zoneRootKey)})</span>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      value={zoneRootKey}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneScalar(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.overridingRootKey,
                            Number(e.target.value)
                          );
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Loop Mode</span>
                    <select
                      value={zoneLoopMode}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneScalar(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.sampleModes,
                            Number(e.target.value)
                          );
                        })
                      }
                    >
                      <option value={0}>0 — No Loop</option>
                      <option value={1}>1 — Continuous Loop</option>
                      <option value={3}>3 — Loop + Release</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Coarse Tune (st)</span>
                    <input
                      type="number"
                      min={-48}
                      max={48}
                      value={zoneCoarse}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneScalar(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.coarseTune,
                            Number(e.target.value)
                          );
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Fine Tune (cents)</span>
                    <input
                      type="number"
                      min={-99}
                      max={99}
                      value={zoneFine}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneScalar(
                            d.instruments[resolvedInstIdx].zones[activeZoneIdx],
                            SF2_GENERATOR.fineTune,
                            Number(e.target.value)
                          );
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Loop Start (smp)</span>
                    <input
                      type="number"
                      min={0}
                      max={currentSample.pcmData.length}
                      value={currentSample.loopStart}
                      onChange={(e) =>
                        mutateBank((d) => {
                          const s = d.samples[resolvedSampleIdx];
                          s.loopStart = Math.max(0, Math.min(s.loopEnd, Number(e.target.value)));
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Loop End (smp)</span>
                    <input
                      type="number"
                      min={0}
                      max={currentSample.pcmData.length}
                      value={currentSample.loopEnd}
                      onChange={(e) =>
                        mutateBank((d) => {
                          const s = d.samples[resolvedSampleIdx];
                          s.loopEnd = Math.max(
                            s.loopStart,
                            Math.min(s.pcmData.length, Number(e.target.value))
                          );
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="editor-card adsr-card">
                <h3>Volume ADSR Envelope</h3>
                <div className="adsr-sliders">
                  <label className="slider-field">
                    <span>Attack: {zoneAdsr.attackSec.toFixed(3)}s</span>
                    <input
                      type="range"
                      min={0.001}
                      max={2}
                      step={0.005}
                      value={zoneAdsr.attackSec}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneAdsr(d.instruments[resolvedInstIdx].zones[activeZoneIdx], {
                            ...zoneAdsr,
                            attackSec: Number(e.target.value),
                          });
                        })
                      }
                    />
                  </label>
                  <label className="slider-field">
                    <span>Decay: {zoneAdsr.decaySec.toFixed(3)}s</span>
                    <input
                      type="range"
                      min={0.005}
                      max={3}
                      step={0.01}
                      value={zoneAdsr.decaySec}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneAdsr(d.instruments[resolvedInstIdx].zones[activeZoneIdx], {
                            ...zoneAdsr,
                            decaySec: Number(e.target.value),
                          });
                        })
                      }
                    />
                  </label>
                  <label className="slider-field">
                    <span>Sustain: {Math.round(zoneAdsr.sustainLevel * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={zoneAdsr.sustainLevel}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneAdsr(d.instruments[resolvedInstIdx].zones[activeZoneIdx], {
                            ...zoneAdsr,
                            sustainLevel: Number(e.target.value),
                          });
                        })
                      }
                    />
                  </label>
                  <label className="slider-field">
                    <span>Release: {zoneAdsr.releaseSec.toFixed(3)}s</span>
                    <input
                      type="range"
                      min={0.005}
                      max={4}
                      step={0.01}
                      value={zoneAdsr.releaseSec}
                      onChange={(e) =>
                        mutateBank((d) => {
                          setZoneAdsr(d.instruments[resolvedInstIdx].zones[activeZoneIdx], {
                            ...zoneAdsr,
                            releaseSec: Number(e.target.value),
                          });
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <PianoKeyboard
        activeRange={activeKeyRange}
        onNoteOn={(midi) => {
          if (tab === "samples" && currentSample) {
            engineRef.current?.playSampleNote(currentSample, midi, 105);
          } else {
            engineRef.current?.playPresetNote(bank, selectedPresetIdx, midi, 105);
          }
        }}
        onNoteOff={(midi) => engineRef.current?.noteOff(midi)}
        onPanic={() => engineRef.current?.allNotesOff()}
      />

      <footer className="studio-footer">
        <span className="status-text">{statusMsg}</span>
        <span className="revisited-badge">
          100% Client-Side &amp; Offline ·{" "}
          <a href="https://revisitedlabs.com/" target="_blank" rel="noopener noreferrer">
            Revisited Labs
          </a>{" "}
          · GPL-3.0
        </span>
      </footer>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
