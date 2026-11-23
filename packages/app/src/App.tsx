import { useId, useMemo, useRef, useState } from "react";
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

  const uid = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef<Record<ExplorerTab, HTMLButtonElement | null>>({
    presets: null,
    instruments: null,
    samples: null,
    info: null,
  });
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

  const explorerTabs: ExplorerTab[] = ["presets", "instruments", "samples", "info"];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (currentIdx + 1) % explorerTabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (currentIdx - 1 + explorerTabs.length) % explorerTabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = explorerTabs.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const nextTab = explorerTabs[nextIdx];
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a href="#workspace-main" className="skip-link visually-hidden">
          Skip to workspace
        </a>
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
            aria-label="Load SoundFont .sf2 file"
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
          <div className="tab-bar" role="tablist" aria-label="Bank Explorer">
            {explorerTabs.map((t, idx) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                id={`${uid}-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                className={`tab-btn ${tab === t ? "is-active" : ""}`}
                onClick={() => setTab(t)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div
            className="explorer-list"
            role="tabpanel"
            aria-labelledby={`${uid}-tab-${tab}`}
          >
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
                <div className="field">
                  <label htmlFor={`${uid}-info-inam`}>Bank Name (INAM)</label>
                  <input
                    id={`${uid}-info-inam`}
                    type="text"
                    value={bank.info.inam}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.inam = e.target.value;
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-info-ieng`}>Author / Engineer (IENG)</label>
                  <input
                    id={`${uid}-info-ieng`}
                    type="text"
                    value={bank.info.ieng ?? ""}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.ieng = e.target.value;
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-info-icop`}>Copyright (ICOP)</label>
                  <input
                    id={`${uid}-info-icop`}
                    type="text"
                    value={bank.info.icop ?? ""}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.icop = e.target.value;
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-info-icmt`}>Comments (ICMT)</label>
                  <textarea
                    id={`${uid}-info-icmt`}
                    rows={3}
                    value={bank.info.icmt ?? ""}
                    onChange={(e) =>
                      mutateBank((d) => {
                        d.info.icmt = e.target.value;
                      })
                    }
                  />
                </div>

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
        <section
          id="workspace-main"
          tabIndex={-1}
          className="panel workspace-panel"
          aria-label="Waveform and Zone Editor"
        >
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
              <div className="field-inline">
                <label htmlFor={`${uid}-preset-name`}>Preset Name</label>
                <input
                  id={`${uid}-preset-name`}
                  type="text"
                  maxLength={20}
                  value={currentPreset.name}
                  onChange={(e) =>
                    mutateBank((d) => {
                      d.presets[selectedPresetIdx].name = e.target.value;
                    })
                  }
                />
              </div>
            )}
            {currentInst && (
              <div className="field-inline">
                <label htmlFor={`${uid}-inst-name`}>Instrument</label>
                <input
                  id={`${uid}-inst-name`}
                  type="text"
                  maxLength={20}
                  value={currentInst.name}
                  onChange={(e) =>
                    mutateBank((d) => {
                      d.instruments[resolvedInstIdx].name = e.target.value;
                    })
                  }
                />
              </div>
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
                  <div className="field">
                    <label htmlFor={`${uid}-key-lo`}>
                      Key Low ({midiNoteToName(activeKeyRange?.lo ?? 0)})
                    </label>
                    <input
                      id={`${uid}-key-lo`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-key-hi`}>
                      Key High ({midiNoteToName(activeKeyRange?.hi ?? 127)})
                    </label>
                    <input
                      id={`${uid}-key-hi`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-vel-lo`}>Vel Low</label>
                    <input
                      id={`${uid}-vel-lo`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-vel-hi`}>Vel High</label>
                    <input
                      id={`${uid}-vel-hi`}
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
                  </div>
                </div>
              </div>

              <div className="editor-card">
                <h3>Pitch &amp; Loop</h3>
                <div className="two-col">
                  <div className="field">
                    <label htmlFor={`${uid}-root-key`}>
                      Root Key ({midiNoteToName(zoneRootKey)})
                    </label>
                    <input
                      id={`${uid}-root-key`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-loop-mode`}>Loop Mode</label>
                    <select
                      id={`${uid}-loop-mode`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-coarse-tune`}>Coarse Tune (st)</label>
                    <input
                      id={`${uid}-coarse-tune`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-fine-tune`}>Fine Tune (cents)</label>
                    <input
                      id={`${uid}-fine-tune`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-loop-start`}>Loop Start (smp)</label>
                    <input
                      id={`${uid}-loop-start`}
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
                  </div>
                  <div className="field">
                    <label htmlFor={`${uid}-loop-end`}>Loop End (smp)</label>
                    <input
                      id={`${uid}-loop-end`}
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
                  </div>
                </div>
              </div>

              <div className="editor-card adsr-card">
                <h3>Volume ADSR Envelope</h3>
                <div className="adsr-sliders">
                  <div className="slider-field">
                    <label htmlFor={`${uid}-adsr-attack`}>
                      Attack: {zoneAdsr.attackSec.toFixed(3)}s
                    </label>
                    <input
                      id={`${uid}-adsr-attack`}
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
                  </div>
                  <div className="slider-field">
                    <label htmlFor={`${uid}-adsr-decay`}>
                      Decay: {zoneAdsr.decaySec.toFixed(3)}s
                    </label>
                    <input
                      id={`${uid}-adsr-decay`}
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
                  </div>
                  <div className="slider-field">
                    <label htmlFor={`${uid}-adsr-sustain`}>
                      Sustain: {Math.round(zoneAdsr.sustainLevel * 100)}%
                    </label>
                    <input
                      id={`${uid}-adsr-sustain`}
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
                  </div>
                  <div className="slider-field">
                    <label htmlFor={`${uid}-adsr-release`}>
                      Release: {zoneAdsr.releaseSec.toFixed(3)}s
                    </label>
                    <input
                      id={`${uid}-adsr-release`}
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
                  </div>
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
        <span className="status-text" role="status" aria-live="polite" aria-atomic="true">
          {statusMsg}
        </span>
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
