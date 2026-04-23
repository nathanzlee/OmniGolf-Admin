"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type CsvResult = { name: string; content: string };
type ScriptResult = {
  csvFiles: CsvResult[];
  stdout: string;
  stderr: string;
  error?: string;
} | null;
type RunResults = { pacing: ScriptResult; assignment: ScriptResult };

type SessionOption = {
  id: string;
  name: string;
  sessionDate: string | null;
  courseName: string | null;
};

type ScriptSlot = { name: string | null; b64: string | null };

// Shape of rows stored in omnigolf-group-pacing-v1-<sessionId>
type StoredPacingRow = {
  id: string;
  groupId: string;
  eventType: string;
  landmark: string;  // e.g. "hole:3"
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
};

type PacingMatchRow = {
  groupLabel: string;
  csvFilename: string;
  holeNumber: number;
  actualStart: string;
  actualEnd: string;
  predictedStart: string | null;
  predictedEnd: string | null;
  startDeltaMin: number | null;
  endDeltaMin: number | null;
  startMatch: boolean | null;
  endMatch: boolean | null;
};

type RowAnnotation = { label: string; match: boolean };
type CsvAnnotations = Record<string, Record<string, RowAnnotation[]>>;

// ── Constants ──────────────────────────────────────────────────────────────

const MATCH_THRESHOLD_MIN = 2.5;

const LS_KEYS = {
  pacingName:     "omnigolf-script-pacing-name",
  pacingB64:      "omnigolf-script-pacing-b64",
  assignmentName: "omnigolf-script-assignment-name",
  assignmentB64:  "omnigolf-script-assignment-b64",
  json:           "omnigolf-script-json",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parse = (line: string) =>
    line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return { headers: parse(lines[0]), rows: lines.slice(1).map(parse) };
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function absDiffMin(a: string, b: string): number {
  return Math.abs(hhmmToMin(a) - hhmmToMin(b));
}

// Mirrors Python's group_label_to_filename()
function groupLabelToFilename(label: string): string {
  const slug = label
    .replace(/[^\w\s]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return `${slug}.csv`;
}

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

// ── Sub-components ─────────────────────────────────────────────────────────

function ScriptUploadSlot({
  label,
  slot,
  inputRef,
  onUpload,
  onClear,
}: {
  label: string;
  slot: ScriptSlot;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-700">{label}</p>
      {slot.name ? (
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <span className="truncate font-mono text-xs text-zinc-800">{slot.name}</span>
          <div className="ml-2 flex shrink-0 gap-1.5">
            <button type="button" onClick={() => inputRef.current?.click()}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50">
              Replace
            </button>
            <button type="button" onClick={onClear}
              className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-center text-sm text-zinc-500 hover:bg-zinc-100">
          Click to upload .py file
        </button>
      )}
      <input ref={inputRef} type="file" accept=".py" className="hidden" onChange={onUpload} />
    </div>
  );
}

function DeltaCell({ deltaMin, match }: { deltaMin: number | null; match: boolean | null }) {
  if (deltaMin === null || match === null) return <td className="px-3 py-2 text-xs text-zinc-400">—</td>;
  return (
    <td className={`px-3 py-2 text-xs font-medium whitespace-nowrap ${match ? "text-green-600" : "text-red-500"}`}>
      {deltaMin.toFixed(1)} min {match ? "✓" : "✗"}
    </td>
  );
}

function PacingMetrics({ matches }: { matches: PacingMatchRow[] }) {
  if (matches.length === 0) return null;

  const startChecks  = matches.filter((m) => m.startMatch !== null);
  const endChecks    = matches.filter((m) => m.endMatch !== null);
  const totalChecks  = startChecks.length + endChecks.length;
  const totalMatched = startChecks.filter((m) => m.startMatch).length
                     + endChecks.filter((m) => m.endMatch).length;

  const allGood = totalMatched === totalChecks && totalChecks > 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Pacing Accuracy</h3>
        <span className={`text-xs font-medium ${allGood ? "text-green-600" : "text-zinc-600"}`}>
          {totalMatched}/{totalChecks} timestamps matched (±{MATCH_THRESHOLD_MIN} min)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Group</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Hole</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Actual Start</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Pred. Start</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Δ</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Actual End</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Pred. End</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Δ</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 text-sm text-zinc-800">
                <td className="px-3 py-2 whitespace-nowrap">{m.groupLabel}</td>
                <td className="px-3 py-2">{m.holeNumber}</td>
                <td className="px-3 py-2">{m.actualStart || "—"}</td>
                <td className="px-3 py-2">{m.predictedStart ?? "—"}</td>
                <DeltaCell deltaMin={m.startDeltaMin} match={m.startMatch} />
                <td className="px-3 py-2">{m.actualEnd || "—"}</td>
                <td className="px-3 py-2">{m.predictedEnd ?? "—"}</td>
                <DeltaCell deltaMin={m.endDeltaMin} match={m.endMatch} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PacingScriptResultPanel({
  result,
  pacingMatches,
  csvAnnotations,
}: {
  result: ScriptResult;
  pacingMatches: PacingMatchRow[];
  csvAnnotations: CsvAnnotations;
}) {
  const [activeTab, setActiveTab] = useState(0);
  if (!result) return null;

  const csvFiles = result.csvFiles ?? [];

  if (result.error) {
    return (
      <div className="space-y-3">
        <PacingMetrics matches={pacingMatches} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {result.error}
          {result.stderr && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{result.stderr}</pre>}
        </div>
      </div>
    );
  }

  if (csvFiles.length === 0) {
    return (
      <div className="space-y-3">
        <PacingMetrics matches={pacingMatches} />
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          Script ran successfully but produced no CSV files.
          {result.stdout && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>}
        </div>
      </div>
    );
  }

  const currentFile      = csvFiles[activeTab];
  const { headers, rows } = parseCSV(currentFile?.content ?? "");
  const fileAnnotations  = csvAnnotations[currentFile?.name ?? ""] ?? {};
  const tsIdx            = headers.indexOf("timestamp");
  const hasAnnotations   = Object.keys(fileAnnotations).length > 0;

  return (
    <div className="space-y-3">
      <PacingMetrics matches={pacingMatches} />

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        {/* File tabs */}
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-3">
          {csvFiles.map((f, i) => (
            <button key={f.name} type="button" onClick={() => setActiveTab(i)}
              className={`-mb-px rounded-t-lg border px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === i
                  ? "border-zinc-200 border-b-white bg-white text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}>
              {f.name}
            </button>
          ))}
        </div>

        {/* Annotated CSV table */}
        <div className="overflow-x-auto p-4">
          {headers.length === 0 ? (
            <p className="text-sm text-zinc-500">CSV is empty.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50">
                  {headers.map((h) => (
                    <th key={h} className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                  {hasAnnotations && (
                    <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 whitespace-nowrap">
                      Actual
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const ts   = tsIdx >= 0 ? row[tsIdx] : null;
                  const anns = ts ? (fileAnnotations[ts] ?? []) : [];
                  return (
                    <tr key={ri} className={`border-b border-zinc-100 last:border-0 ${anns.length > 0 ? "bg-amber-50" : ""}`}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-zinc-800 whitespace-nowrap">{cell}</td>
                      ))}
                      {hasAnnotations && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {anns.map((ann, ai) => (
                            <span key={ai} className={`text-xs font-medium ${ann.match ? "text-green-600" : "text-red-500"}`}>
                              {ann.label} {ann.match ? "✓" : "✗"}
                            </span>
                          ))}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {(result.stdout || result.stderr) && (
          <details className="border-t border-zinc-200 px-4 py-3">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">Script output</summary>
            {result.stdout && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>}
            {result.stderr && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-600">{result.stderr}</pre>}
          </details>
        )}
      </div>
    </div>
  );
}

function ScriptResultPanel({ result }: { result: ScriptResult }) {
  const [activeTab, setActiveTab] = useState(0);
  if (!result) return null;

  const csvFiles = result.csvFiles ?? [];

  if (result.error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <strong>Error:</strong> {result.error}
        {result.stderr && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{result.stderr}</pre>}
      </div>
    );
  }

  if (csvFiles.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        Script ran successfully but produced no CSV files.
        {result.stdout && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>}
      </div>
    );
  }

  const { headers, rows } = parseCSV(csvFiles[activeTab]?.content ?? "");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-3">
        {csvFiles.map((f, i) => (
          <button key={f.name} type="button" onClick={() => setActiveTab(i)}
            className={`-mb-px rounded-t-lg border px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === i
                ? "border-zinc-200 border-b-white bg-white text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}>
            {f.name}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto p-4">
        {headers.length === 0 ? (
          <p className="text-sm text-zinc-500">CSV is empty.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50">
                {headers.map((h) => (
                  <th key={h} className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-zinc-100 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-zinc-800 whitespace-nowrap">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(result.stdout || result.stderr) && (
        <details className="border-t border-zinc-200 px-4 py-3">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">Script output</summary>
          {result.stdout && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>}
          {result.stderr && <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-600">{result.stderr}</pre>}
        </details>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ScriptTester({ completedSessions }: { completedSessions: SessionOption[] }) {
  const [pacing,     setPacing]     = useState<ScriptSlot>({ name: null, b64: null });
  const [assignment, setAssignment] = useState<ScriptSlot>({ name: null, b64: null });
  const pacingRef     = useRef<HTMLInputElement>(null);
  const assignmentRef = useRef<HTMLInputElement>(null);

  const [jsonText,          setJsonText]          = useState("");
  const [isLoadingSession,  setIsLoadingSession]  = useState(false);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const [isRunning,    setIsRunning]    = useState(false);
  const [results,      setResults]      = useState<RunResults | null>(null);
  const [activeResult, setActiveResult] = useState<"pacing" | "assignment">("pacing");

  // ── Load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    const pn = localStorage.getItem(LS_KEYS.pacingName);
    const pb = localStorage.getItem(LS_KEYS.pacingB64);
    if (pn && pb) setPacing({ name: pn, b64: pb });

    const an = localStorage.getItem(LS_KEYS.assignmentName);
    const ab = localStorage.getItem(LS_KEYS.assignmentB64);
    if (an && ab) setAssignment({ name: an, b64: ab });

    const savedJson = localStorage.getItem(LS_KEYS.json);
    if (savedJson) setJsonText(savedJson);
  }, []);

  useEffect(() => {
    if (!jsonText) return;
    try { localStorage.setItem(LS_KEYS.json, jsonText); } catch { /* quota */ }
  }, [jsonText]);

  // ── Pacing accuracy metrics ───────────────────────────────────────────────
  const { pacingMatches, csvAnnotations } = useMemo<{
    pacingMatches: PacingMatchRow[];
    csvAnnotations: CsvAnnotations;
  }>(() => {
    if (!results?.pacing || !jsonText) return { pacingMatches: [], csvAnnotations: {} };
    try {
      const sessionData = JSON.parse(jsonText);
      const sessionId   = sessionData?.session_id as string | undefined;
      if (!sessionId) return { pacingMatches: [], csvAnnotations: {} };

      const pacingRaw = localStorage.getItem(`omnigolf-group-pacing-v1-${sessionId}`);
      if (!pacingRaw) return { pacingMatches: [], csvAnnotations: {} };
      const storedRows: StoredPacingRow[] = JSON.parse(pacingRaw);

      const groupIdToLabel = new Map<string, string>(
        (sessionData.groups ?? []).map((g: any) => [g.group_id as string, g.label as string])
      );

      const csvMap = new Map<string, string>(
        (results.pacing.csvFiles ?? []).map((f) => [f.name, f.content])
      );

      const matches: PacingMatchRow[]  = [];
      const annotations: CsvAnnotations = {};

      const addAnnotation = (filename: string, ts: string, ann: RowAnnotation) => {
        if (!annotations[filename]) annotations[filename] = {};
        if (!annotations[filename][ts]) annotations[filename][ts] = [];
        annotations[filename][ts].push(ann);
      };

      for (const row of storedRows) {
        if (row.eventType !== "hole") continue;
        if (!row.landmark?.startsWith("hole:")) continue;
        const holeNumber = parseInt(row.landmark.split(":")[1], 10);
        if (isNaN(holeNumber)) continue;

        const groupLabel = row.groupId ? (groupIdToLabel.get(row.groupId) ?? null) : null;
        if (!groupLabel) continue;

        const csvFilename = groupLabelToFilename(groupLabel);
        const csvContent  = csvMap.get(csvFilename) ?? null;

        let predictedStart: string | null = null;
        let predictedEnd:   string | null = null;

        if (csvContent) {
          const { headers, rows: csvRows } = parseCSV(csvContent);
          const tsCol = headers.indexOf("timestamp");
          const phCol = headers.indexOf("predicted_hole");
          if (tsCol !== -1 && phCol !== -1) {
            const holeRows = csvRows.filter((r) => r[phCol] === String(holeNumber));
            if (holeRows.length > 0) {
              predictedStart = holeRows[0][tsCol];
              predictedEnd   = holeRows[holeRows.length - 1][tsCol];
            }
          }
        }

        const startDelta = row.startTime && predictedStart ? absDiffMin(row.startTime, predictedStart) : null;
        const endDelta   = row.endTime   && predictedEnd   ? absDiffMin(row.endTime,   predictedEnd)   : null;
        const startMatch = startDelta !== null ? startDelta <= MATCH_THRESHOLD_MIN : null;
        const endMatch   = endDelta   !== null ? endDelta   <= MATCH_THRESHOLD_MIN : null;

        matches.push({
          groupLabel, csvFilename, holeNumber,
          actualStart: row.startTime || "",
          actualEnd:   row.endTime   || "",
          predictedStart, predictedEnd,
          startDeltaMin: startDelta, endDeltaMin: endDelta,
          startMatch, endMatch,
        });

        if (predictedStart) {
          addAnnotation(csvFilename, predictedStart, { label: `Hole ${holeNumber} start`, match: startMatch ?? false });
        }
        if (predictedEnd && predictedEnd !== predictedStart) {
          addAnnotation(csvFilename, predictedEnd, { label: `Hole ${holeNumber} end`, match: endMatch ?? false });
        }
      }

      return { pacingMatches: matches, csvAnnotations: annotations };
    } catch {
      return { pacingMatches: [], csvAnnotations: {} };
    }
  }, [results, jsonText]);

  // ── Script upload helpers ─────────────────────────────────────────────────
  function makeUploadHandler(setter: (s: ScriptSlot) => void, nameKey: string, b64Key: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(",")[1];
        setter({ name: file.name, b64 });
        localStorage.setItem(nameKey, file.name);
        localStorage.setItem(b64Key, b64);
      };
      reader.readAsDataURL(file);
    };
  }

  function makeClearHandler(setter: (s: ScriptSlot) => void, nameKey: string, b64Key: string, ref: React.RefObject<HTMLInputElement | null>) {
    return () => {
      setter({ name: null, b64: null });
      localStorage.removeItem(nameKey);
      localStorage.removeItem(b64Key);
      if (ref.current) ref.current.value = "";
    };
  }

  async function loadSession(sessionId: string) {
    if (!sessionId) return;
    setIsLoadingSession(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      setJsonText(JSON.stringify(await res.json(), null, 2));
    } catch (err: any) {
      window.alert(`Failed to load session: ${err?.message ?? "unknown error"}`);
    } finally {
      setIsLoadingSession(false);
    }
  }

  function handleJsonUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJsonText(reader.result as string);
    reader.readAsText(file);
  }

  function toFile(slot: ScriptSlot): File {
    const bytes = Uint8Array.from(atob(slot.b64!), (c) => c.charCodeAt(0));
    return new File([bytes], slot.name!, { type: "text/plain" });
  }

  async function handleRun() {
    if (!jsonText.trim() || (!pacing.b64 && !assignment.b64)) return;
    setIsRunning(true);
    setResults(null);
    try {
      const fd = new FormData();
      fd.append("json", jsonText.trim());
      if (pacing.b64)     fd.append("script_pacing",    toFile(pacing));
      if (assignment.b64) fd.append("script_assignment", toFile(assignment));

      const res  = await fetch("/api/run-script", { method: "POST", body: fd });
      const data = await res.json() as RunResults;
      setResults(data);
      setActiveResult(data.pacing ? "pacing" : "assignment");
    } catch (err: any) {
      const errResult = { csvFiles: [], stdout: "", stderr: "", error: err?.message ?? "Request failed" };
      setResults({
        pacing:     pacing.b64     ? errResult : null,
        assignment: assignment.b64 ? errResult : null,
      });
    } finally {
      setIsRunning(false);
    }
  }

  const canRun = !!jsonText.trim() && (!!pacing.b64 || !!assignment.b64) && !isRunning;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Scripts card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Scripts</h2>
            <p className="mt-1 text-xs text-zinc-500">Upload one or both scripts. Each is saved in your browser.</p>
          </div>
          <div className="space-y-4">
            <ScriptUploadSlot label="Group Pacing" slot={pacing} inputRef={pacingRef}
              onUpload={makeUploadHandler(setPacing, LS_KEYS.pacingName, LS_KEYS.pacingB64)}
              onClear={makeClearHandler(setPacing, LS_KEYS.pacingName, LS_KEYS.pacingB64, pacingRef)} />
            <ScriptUploadSlot label="Group Assignments" slot={assignment} inputRef={assignmentRef}
              onUpload={makeUploadHandler(setAssignment, LS_KEYS.assignmentName, LS_KEYS.assignmentB64)}
              onClear={makeClearHandler(setAssignment, LS_KEYS.assignmentName, LS_KEYS.assignmentB64, assignmentRef)} />
          </div>
        </div>

        {/* Session JSON card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-zinc-900">Session JSON</h2>
            <p className="mt-1 text-xs text-zinc-500">Choose a completed session or upload a JSON file.</p>
          </div>
          <div className="space-y-2">
            <select defaultValue="" onChange={(e) => loadSession(e.target.value)} disabled={isLoadingSession}
              className={inputClass + " w-full"}>
              <option value="">Select a completed session…</option>
              {completedSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.courseName ? ` — ${s.courseName}` : ""}{s.sessionDate ? ` (${s.sessionDate})` : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => jsonInputRef.current?.click()} disabled={isLoadingSession}
              className="w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-50">
              {jsonText ? "Replace with uploaded file" : "Or upload a .json file"}
            </button>
          </div>
          {jsonText && (
            <p className="mt-2 text-xs text-zinc-500">{isLoadingSession ? "Loading…" : "✓ JSON loaded"}</p>
          )}
          <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={handleJsonUpload} />
        </div>
      </div>

      {/* Run button */}
      <div>
        <button type="button" onClick={handleRun} disabled={!canRun}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
          {isRunning ? "Running…" : "Run Script"}
        </button>
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          {results.pacing && results.assignment && (
            <div className="flex gap-2">
              {(["pacing", "assignment"] as const).map((key) => (
                <button key={key} type="button" onClick={() => setActiveResult(key)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    activeResult === key
                      ? "bg-zinc-900 text-white shadow-sm"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}>
                  {key === "pacing" ? "Group Pacing" : "Group Assignments"}
                </button>
              ))}
            </div>
          )}

          {activeResult === "pacing" && results.pacing && (
            <PacingScriptResultPanel
              result={results.pacing}
              pacingMatches={pacingMatches}
              csvAnnotations={csvAnnotations}
            />
          )}
          {activeResult === "assignment" && (
            <ScriptResultPanel result={results.assignment} />
          )}
        </div>
      )}
    </div>
  );
}
