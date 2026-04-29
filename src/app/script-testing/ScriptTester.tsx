"use client";

import { useEffect, useRef, useState } from "react";
import { TestCase, loadTestCases, testCaseToExportJson } from "@/lib/testCases";

// ── Types ──────────────────────────────────────────────────────────────────

type CsvResult = { name: string; content: string };
type ScriptResult = {
  csvFiles: CsvResult[];
  jsonFiles: CsvResult[];
  stdout: string;
  stderr: string;
  error?: string;
} | null;

type ScriptSlot = { name: string | null; b64: string | null };

// Pacing rows stored in localStorage for real sessions
type StoredPacingRow = {
  id: string;
  groupId: string;
  eventType: string;
  landmark: string;
  startTime: string;
  endTime: string;
};

type EventMatchRow = {
  eventType: string;
  groupLabel: string | null;
  landmark: string | null;
  caught: boolean;
  detail: string | null;
};

type PacingMatchRow = {
  groupLabel: string;
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

type SessionOption = {
  id: string;
  name: string;
  sessionDate: string | null;
  courseName: string | null;
};

type SessionRunResult = {
  sessionId: string;
  sessionName: string;
  isTestCase: boolean;
  pacing: ScriptResult;
  assignment: ScriptResult;
  pacingMatches: PacingMatchRow[];
  csvAnnotations: CsvAnnotations;
  eventMatches: EventMatchRow[];
  assignmentAnnotations: CsvAnnotations;
};

// ── Constants ──────────────────────────────────────────────────────────────

const MATCH_THRESHOLD_MIN = 2.5;

const LS_KEYS = {
  pacingName: "omnigolf-script-pacing-name",
  pacingB64: "omnigolf-script-pacing-b64",
  assignmentName: "omnigolf-script-assignment-name",
  assignmentB64: "omnigolf-script-assignment-b64",
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

function groupLabelToFilename(label: string): string {
  const slug = label
    .replace(/[^\w\s]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return `${slug}.csv`;
}

function computePacingMetrics(
  storedRows: StoredPacingRow[],
  pacingResult: ScriptResult,
  sessionData: any
): { pacingMatches: PacingMatchRow[]; csvAnnotations: CsvAnnotations } {
  if (!pacingResult || !sessionData) return { pacingMatches: [], csvAnnotations: {} };
  try {
    const groupIdToLabel = new Map<string, string>(
      (sessionData.groups ?? []).map((g: any) => [
        (g.group_id ?? g.id) as string,
        (g.label ?? "") as string,
      ])
    );

    const csvMap = new Map<string, string>(
      (pacingResult.csvFiles ?? []).map((f) => [f.name, f.content])
    );

    const matches: PacingMatchRow[] = [];
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

      const groupLabel = row.groupId
        ? (groupIdToLabel.get(row.groupId) ?? null)
        : null;
      if (!groupLabel) continue;

      const csvFilename = groupLabelToFilename(groupLabel);
      const csvContent = csvMap.get(csvFilename) ?? null;

      let predictedStart: string | null = null;
      let predictedEnd: string | null = null;

      if (csvContent) {
        const { headers, rows: csvRows } = parseCSV(csvContent);
        const tsCol = headers.indexOf("timestamp");
        const phCol = headers.indexOf("predicted_hole");
        if (tsCol !== -1 && phCol !== -1) {
          const holeRows = csvRows.filter((r) => r[phCol] === String(holeNumber));
          if (holeRows.length > 0) {
            predictedStart = holeRows[0][tsCol];
            predictedEnd = holeRows[holeRows.length - 1][tsCol];
          }
        }
      }

      const startDelta =
        row.startTime && predictedStart
          ? absDiffMin(row.startTime, predictedStart)
          : null;
      const endDelta =
        row.endTime && predictedEnd
          ? absDiffMin(row.endTime, predictedEnd)
          : null;
      const startMatch =
        startDelta !== null ? startDelta <= MATCH_THRESHOLD_MIN : null;
      const endMatch =
        endDelta !== null ? endDelta <= MATCH_THRESHOLD_MIN : null;

      matches.push({
        groupLabel,
        holeNumber,
        actualStart: row.startTime || "",
        actualEnd: row.endTime || "",
        predictedStart,
        predictedEnd,
        startDeltaMin: startDelta,
        endDeltaMin: endDelta,
        startMatch,
        endMatch,
      });

      if (predictedStart) {
        addAnnotation(csvFilename, predictedStart, {
          label: `Hole ${holeNumber} start`,
          match: startMatch ?? false,
        });
      }
      if (predictedEnd && predictedEnd !== predictedStart) {
        addAnnotation(csvFilename, predictedEnd, {
          label: `Hole ${holeNumber} end`,
          match: endMatch ?? false,
        });
      }
    }

    return { pacingMatches: matches, csvAnnotations: annotations };
  } catch {
    return { pacingMatches: [], csvAnnotations: {} };
  }
}

function normalizeEventType(s: string): string {
  const n = s.toLowerCase().replace(/[\s_-]/g, "");
  if (n === "leftcourse") return "leavecourse";
  if (n === "behindpace") return "behindpace";
  return n;
}

function computeEventMetrics(
  assignmentResult: ScriptResult,
  pacingResult: ScriptResult,
  sessionData: any
): { eventMatches: EventMatchRow[]; assignmentAnnotations: CsvAnnotations } {
  try {
    // Parse caught_events.json from each script
    const assignmentJsonMap = new Map<string, string>(
      (assignmentResult?.jsonFiles ?? []).map((f) => [f.name, f.content])
    );
    const pacingJsonMap = new Map<string, string>(
      (pacingResult?.jsonFiles ?? []).map((f) => [f.name, f.content])
    );

    let assignmentCaught: any[] = [];
    let pacingCaught: any[] = [];
    try { assignmentCaught = JSON.parse(assignmentJsonMap.get("caught_events.json") ?? "[]"); } catch { /* ignore */ }
    try { pacingCaught = JSON.parse(pacingJsonMap.get("caught_events.json") ?? "[]"); } catch { /* ignore */ }

    const sessionEvents: any[] = sessionData.events ?? [];

    // ── If there are expected events in the session JSON, match against caught ──
    if (sessionEvents.length > 0) {
      const matches: EventMatchRow[] = sessionEvents.map((ev: any) => {
        const evType = normalizeEventType(ev.event_type ?? "");
        const groupLabel: string | null = ev.group_label ?? null;
        const groupId: string | null = ev.group_id ?? null;
        const landmark: string | null = ev.landmark_label ?? ev.landmark ?? null;

        const isAssignment = evType === "groupsplit" || evType === "groupjoin";
        const isPacing = evType === "behindpace" || evType === "leavecourse";

        let caught = false;
        let detail: string | null = null;

        if (isAssignment) {
          const hit = assignmentCaught.find((c: any) =>
            normalizeEventType(c.event ?? "") === evType &&
            (c.group ?? "") === groupLabel
          );
          if (hit) {
            caught = true;
            if (hit.new_group1?.label && hit.new_group2?.label) {
              detail = `→ ${hit.new_group1.label}, ${hit.new_group2.label}`;
            } else if (hit.new_group1?.label) {
              detail = `→ ${hit.new_group1.label}`;
            }
          }
        } else if (isPacing) {
          const hit = pacingCaught.find((c: any) =>
            normalizeEventType(c.event_type ?? "") === evType &&
            (c.group_id === groupId || c.group_label === groupLabel)
          );
          if (hit) {
            caught = true;
            if (hit.hole != null) detail = `Hole ${hit.hole}`;
          }
        }

        return { eventType: ev.event_type ?? "", groupLabel, landmark, caught, detail };
      });

      return { eventMatches: matches, assignmentAnnotations: {} };
    }

    return { eventMatches: [], assignmentAnnotations: {} };
  } catch {
    return { eventMatches: [], assignmentAnnotations: {} };
  }
}


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
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-4 text-center text-sm text-zinc-500 hover:bg-zinc-100"
        >
          Click to upload .py file
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".py"
        className="hidden"
        onChange={onUpload}
      />
    </div>
  );
}

function DeltaCell({
  deltaMin,
  match,
}: {
  deltaMin: number | null;
  match: boolean | null;
}) {
  if (deltaMin === null || match === null)
    return <td className="px-3 py-2 text-xs text-zinc-400">—</td>;
  return (
    <td
      className={`px-3 py-2 text-xs font-medium whitespace-nowrap ${
        match ? "text-green-600" : "text-red-500"
      }`}
    >
      {deltaMin.toFixed(1)} min {match ? "✓" : "✗"}
    </td>
  );
}

function PacingMetrics({ matches }: { matches: PacingMatchRow[] }) {
  if (matches.length === 0) return null;

  const startChecks = matches.filter((m) => m.startMatch !== null);
  const endChecks = matches.filter((m) => m.endMatch !== null);
  const totalChecks = startChecks.length + endChecks.length;
  const totalMatched =
    startChecks.filter((m) => m.startMatch).length +
    endChecks.filter((m) => m.endMatch).length;
  const allGood = totalMatched === totalChecks && totalChecks > 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Pacing Accuracy</h3>
        <span
          className={`text-xs font-medium ${allGood ? "text-green-600" : "text-zinc-600"}`}
        >
          {totalMatched}/{totalChecks} timestamps matched (±{MATCH_THRESHOLD_MIN} min)
        </span>
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="sticky top-0 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
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
              <tr
                key={i}
                className="border-b border-zinc-100 last:border-0 text-sm text-zinc-800"
              >
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
  const jsonFiles = result.jsonFiles ?? [];
  const allFiles: CsvResult[] = [...csvFiles, ...jsonFiles];

  if (result.error) {
    return (
      <div className="space-y-3">
        <PacingMetrics matches={pacingMatches} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {result.error}
          {result.stderr && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{result.stderr}</pre>
          )}
        </div>
      </div>
    );
  }

  if (allFiles.length === 0) {
    return (
      <div className="space-y-3">
        <PacingMetrics matches={pacingMatches} />
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          Script ran successfully but produced no output files.
          {result.stdout && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
              {result.stdout}
            </pre>
          )}
        </div>
      </div>
    );
  }

  const currentFile = allFiles[Math.min(activeTab, allFiles.length - 1)];
  const isJson = currentFile?.name.endsWith(".json");
  const { headers, rows } = isJson ? { headers: [] as string[], rows: [] as string[][] } : parseCSV(currentFile?.content ?? "");
  const fileAnnotations = isJson ? {} : (csvAnnotations[currentFile?.name ?? ""] ?? {});
  const tsIdx = headers.indexOf("timestamp");
  const hasAnnotations = Object.keys(fileAnnotations).length > 0;

  return (
    <div className="space-y-3">
      <PacingMetrics matches={pacingMatches} />
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-3">
          {allFiles.map((f, i) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`-mb-px rounded-t-lg border px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === i
                  ? "border-zinc-200 border-b-white bg-white text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="max-h-[55vh] overflow-auto p-4">
          {isJson ? (
            <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-800">
              {(() => { try { return JSON.stringify(JSON.parse(currentFile.content), null, 2); } catch { return currentFile.content; } })()}
            </pre>
          ) : headers.length === 0 ? (
            <p className="text-sm text-zinc-500">CSV is empty.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 bg-zinc-50">
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 whitespace-nowrap"
                    >
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
                  const ts = tsIdx !== -1 ? row[tsIdx] : null;
                  const anns = ts ? (fileAnnotations[ts] ?? []) : [];
                  const hasAnn = anns.length > 0;
                  return (
                    <tr
                      key={ri}
                      className={`border-b border-zinc-100 last:border-0 ${
                        hasAnn ? "bg-amber-50" : ""
                      }`}
                    >
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-2 text-zinc-800 whitespace-nowrap"
                        >
                          {cell}
                        </td>
                      ))}
                      {hasAnnotations && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {anns.map((a, ai) => (
                            <span
                              key={ai}
                              className={`mr-1 text-xs font-medium ${
                                a.match ? "text-green-600" : "text-red-500"
                              }`}
                            >
                              {a.label} {a.match ? "✓" : "✗"}
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
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">
              Script output
            </summary>
            {result.stdout && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
                {result.stdout}
              </pre>
            )}
            {result.stderr && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-600">
                {result.stderr}
              </pre>
            )}
          </details>
        )}
      </div>
    </div>
  );
}

function AssignmentScriptResultPanel({
  result,
  eventMatches,
  assignmentAnnotations,
}: {
  result: ScriptResult;
  eventMatches: EventMatchRow[];
  assignmentAnnotations: CsvAnnotations;
}) {
  const [activeTab, setActiveTab] = useState(0);
  if (!result) return null;

  const csvFiles = (result.csvFiles ?? []).filter(
    (f) => f.name === "input_teeoff_gatherings.csv"
  );
  const jsonFiles = result.jsonFiles ?? [];
  const allFiles: CsvResult[] = [...csvFiles, ...jsonFiles];

  if (result.error) {
    return (
      <div className="space-y-3">
        <EventMetrics matches={eventMatches} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong>Error:</strong> {result.error}
          {result.stderr && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{result.stderr}</pre>
          )}
        </div>
      </div>
    );
  }

  if (allFiles.length === 0) {
    return (
      <div className="space-y-3">
        <EventMetrics matches={eventMatches} />
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          Script ran successfully but produced no output files.
          {result.stdout && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
              {result.stdout}
            </pre>
          )}
        </div>
      </div>
    );
  }

  const currentFile = allFiles[Math.min(activeTab, allFiles.length - 1)];
  const isJson = currentFile?.name.endsWith(".json");
  const { headers, rows } = isJson ? { headers: [] as string[], rows: [] as string[][] } : parseCSV(currentFile?.content ?? "");
  const fileAnnotations = isJson ? {} : (assignmentAnnotations[currentFile?.name ?? ""] ?? {});
  const tsIdx = headers.findIndex((h) => h === "timestamp" || h === "time");
  const hasAnnotations = Object.keys(fileAnnotations).length > 0;

  return (
    <div className="space-y-3">
      <EventMetrics matches={eventMatches} />
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-3">
          {allFiles.map((f, i) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`-mb-px rounded-t-lg border px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === i
                  ? "border-zinc-200 border-b-white bg-white text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="max-h-[55vh] overflow-auto p-4">
          {isJson ? (
            <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-800">
              {(() => { try { return JSON.stringify(JSON.parse(currentFile.content), null, 2); } catch { return currentFile.content; } })()}
            </pre>
          ) : headers.length === 0 ? (
            <p className="text-sm text-zinc-500">CSV is empty.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 bg-zinc-50">
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 whitespace-nowrap"
                    >
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
                  const ts = tsIdx !== -1 ? row[tsIdx] : null;
                  const anns = ts ? (fileAnnotations[ts] ?? []) : [];
                  const hasAnn = anns.length > 0;
                  return (
                    <tr
                      key={ri}
                      className={`border-b border-zinc-100 last:border-0 ${hasAnn ? "bg-amber-50" : ""}`}
                    >
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-zinc-800 whitespace-nowrap">
                          {cell}
                        </td>
                      ))}
                      {hasAnnotations && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {anns.map((a, ai) => (
                            <span
                              key={ai}
                              className={`mr-1 text-xs font-medium ${a.match ? "text-green-600" : "text-red-500"}`}
                            >
                              {a.label} {a.match ? "✓" : "✗"}
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
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">
              Script output
            </summary>
            {result.stdout && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
                {result.stdout}
              </pre>
            )}
            {result.stderr && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-600">
                {result.stderr}
              </pre>
            )}
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
        {result.stderr && (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{result.stderr}</pre>
        )}
      </div>
    );
  }

  if (csvFiles.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        Script ran successfully but produced no CSV files.
        {result.stdout && (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
            {result.stdout}
          </pre>
        )}
      </div>
    );
  }

  const { headers, rows } = parseCSV(csvFiles[activeTab]?.content ?? "");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-3">
        {csvFiles.map((f, i) => (
          <button
            key={f.name}
            type="button"
            onClick={() => setActiveTab(i)}
            className={`-mb-px rounded-t-lg border px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === i
                ? "border-zinc-200 border-b-white bg-white text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>
      <div className="max-h-[55vh] overflow-auto p-4">
        {headers.length === 0 ? (
          <p className="text-sm text-zinc-500">CSV is empty.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 bg-zinc-50">
                {headers.map((h) => (
                  <th
                    key={h}
                    className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-zinc-100 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-zinc-800 whitespace-nowrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(result.stdout || result.stderr) && (
        <details className="border-t border-zinc-200 px-4 py-3">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700">
            Script output
          </summary>
          {result.stdout && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">
              {result.stdout}
            </pre>
          )}
          {result.stderr && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-600">
              {result.stderr}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ScriptTester({
  completedSessions,
}: {
  completedSessions: SessionOption[];
}) {
  const [pacing, setPacing] = useState<ScriptSlot>({ name: null, b64: null });
  const [assignment, setAssignment] = useState<ScriptSlot>({ name: null, b64: null });
  const pacingRef = useRef<HTMLInputElement>(null);
  const assignmentRef = useRef<HTMLInputElement>(null);

  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);
  const [sessionResults, setSessionResults] = useState<SessionRunResult[]>([]);
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
  const [activeResultType, setActiveResultType] = useState<"pacing" | "assignment">("pacing");
  const [showModal, setShowModal] = useState(false);

  // Load persisted scripts + test cases
  useEffect(() => {
    const pn = localStorage.getItem(LS_KEYS.pacingName);
    const pb = localStorage.getItem(LS_KEYS.pacingB64);
    if (pn && pb) setPacing({ name: pn, b64: pb });

    const an = localStorage.getItem(LS_KEYS.assignmentName);
    const ab = localStorage.getItem(LS_KEYS.assignmentB64);
    if (an && ab) setAssignment({ name: an, b64: ab });

    setTestCases(loadTestCases());
  }, []);

  // ── Script upload helpers ─────────────────────────────────────────────────

  function makeUploadHandler(
    setter: (s: ScriptSlot) => void,
    nameKey: string,
    b64Key: string
  ) {
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

  function makeClearHandler(
    setter: (s: ScriptSlot) => void,
    nameKey: string,
    b64Key: string,
    ref: React.RefObject<HTMLInputElement | null>
  ) {
    return () => {
      setter({ name: null, b64: null });
      localStorage.removeItem(nameKey);
      localStorage.removeItem(b64Key);
      if (ref.current) ref.current.value = "";
    };
  }

  function toFile(slot: ScriptSlot): File {
    const bytes = Uint8Array.from(atob(slot.b64!), (c) => c.charCodeAt(0));
    return new File([bytes], slot.name!, { type: "text/plain" });
  }

  // ── Session selection ─────────────────────────────────────────────────────

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async function runScriptForJson(
    jsonStr: string
  ): Promise<{ pacing: ScriptResult; assignment: ScriptResult }> {
    const fd = new FormData();
    fd.append("json", jsonStr);
    if (pacing.b64) fd.append("script_pacing", toFile(pacing));
    if (assignment.b64) fd.append("script_assignment", toFile(assignment));

    const res = await fetch("/api/run-script", { method: "POST", body: fd });
    return res.json();
  }

  async function handleRun() {
    if (selectedIds.size === 0 || (!pacing.b64 && !assignment.b64)) return;

    setIsRunning(true);
    setRunProgress({ done: 0, total: selectedIds.size });
    setSessionResults([]);

    const results: SessionRunResult[] = [];

    // Resolve each selected ID to a {name, json, pacingRows}
    const queue: Array<{
      id: string;
      name: string;
      isTestCase: boolean;
      jsonStr: string | null;
      pacingRows: StoredPacingRow[];
    }> = [];

    for (const id of selectedIds) {
      const tc = testCases.find((t) => t.id === id);
      if (tc) {
        queue.push({
          id,
          name: tc.name,
          isTestCase: true,
          jsonStr: JSON.stringify(testCaseToExportJson(tc), null, 2),
          pacingRows: tc.pacingRows as unknown as StoredPacingRow[],
        });
      } else {
        const session = completedSessions.find((s) => s.id === id);
        if (!session) continue;
        // Fetch the export JSON
        try {
          const res = await fetch(`/api/sessions/${id}/export`);
          const data = await res.json();
          const jsonStr = JSON.stringify(data, null, 2);
          // Get pacing rows from localStorage
          let pacingRows: StoredPacingRow[] = [];
          try {
            pacingRows = JSON.parse(
              localStorage.getItem(`omnigolf-group-pacing-v1-${id}`) ?? "[]"
            );
          } catch {
            /* ignore */
          }
          queue.push({
            id,
            name: session.name,
            isTestCase: false,
            jsonStr,
            pacingRows,
          });
        } catch {
          const errResult: ScriptResult = {
            csvFiles: [],
            stdout: "",
            stderr: "",
            error: "Failed to load session export",
          };
          results.push({
            sessionId: id,
            sessionName: session.name,
            isTestCase: false,
            pacing: pacing.b64 ? errResult : null,
            assignment: assignment.b64 ? errResult : null,
            pacingMatches: [],
            csvAnnotations: {},
            eventMatches: [],
            assignmentAnnotations: {},
          });
          setRunProgress((p) => p && { ...p, done: p.done + 1 });
          continue;
        }
      }
    }

    // Run scripts sequentially to avoid server overload
    for (const item of queue) {
      try {
        // Normalize Z-suffix ISO timestamps → +00:00 for Python < 3.11 datetime.fromisoformat()
        const normalizedJson = item.jsonStr!.replace(
          /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z"/g,
          '"$1+00:00"'
        );
        const { pacing: pr, assignment: ar } = await runScriptForJson(normalizedJson);
        const sessionData = JSON.parse(normalizedJson);
        const { pacingMatches, csvAnnotations } = computePacingMetrics(
          item.pacingRows,
          pr,
          sessionData
        );
        const { eventMatches, assignmentAnnotations } = computeEventMetrics(
          ar,
          pr,
          sessionData
        );
        results.push({
          sessionId: item.id,
          sessionName: item.name,
          isTestCase: item.isTestCase,
          pacing: pr,
          assignment: ar,
          pacingMatches,
          csvAnnotations,
          eventMatches,
          assignmentAnnotations,
        });
      } catch (err: any) {
        const errResult: ScriptResult = {
          csvFiles: [],
          stdout: "",
          stderr: "",
          error: err?.message ?? "Request failed",
        };
        results.push({
          sessionId: item.id,
          sessionName: item.name,
          isTestCase: item.isTestCase,
          pacing: pacing.b64 ? errResult : null,
          assignment: assignment.b64 ? errResult : null,
          pacingMatches: [],
          csvAnnotations: {},
          eventMatches: [],
          assignmentAnnotations: {},
        });
      }
      setRunProgress((p) => p && { ...p, done: p.done + 1 });
    }

    setSessionResults(results);
    setActiveSessionIdx(0);
    // Default active result type to first available
    if (results[0]) {
      setActiveResultType(results[0].pacing ? "pacing" : "assignment");
    }
    setIsRunning(false);
    setRunProgress(null);
    setShowModal(true);
  }

  const canRun =
    selectedIds.size > 0 && (!!pacing.b64 || !!assignment.b64) && !isRunning;

  const activeResult = sessionResults[activeSessionIdx];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Scripts card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Scripts</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Upload one or both scripts. Each is saved in your browser.
            </p>
          </div>
          <div className="space-y-4">
            <ScriptUploadSlot
              label="Group Pacing"
              slot={pacing}
              inputRef={pacingRef}
              onUpload={makeUploadHandler(setPacing, LS_KEYS.pacingName, LS_KEYS.pacingB64)}
              onClear={makeClearHandler(
                setPacing,
                LS_KEYS.pacingName,
                LS_KEYS.pacingB64,
                pacingRef
              )}
            />
            <ScriptUploadSlot
              label="Group Assignments"
              slot={assignment}
              inputRef={assignmentRef}
              onUpload={makeUploadHandler(
                setAssignment,
                LS_KEYS.assignmentName,
                LS_KEYS.assignmentB64
              )}
              onClear={makeClearHandler(
                setAssignment,
                LS_KEYS.assignmentName,
                LS_KEYS.assignmentB64,
                assignmentRef
              )}
            />
          </div>
        </div>

        {/* Sessions card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Sessions</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Select one or more sessions to run scripts against.
              </p>
            </div>
            {selectedIds.size > 0 && (
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
                {selectedIds.size} selected
              </span>
            )}
          </div>

          <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
            {/* Completed sessions */}
            {completedSessions.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Completed Sessions
                </p>
                <div className="space-y-1">
                  {completedSessions.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleId(s.id)}
                        className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-900">{s.name}</div>
                        {(s.courseName || s.sessionDate) && (
                          <div className="truncate text-xs text-zinc-500">
                            {[s.courseName, s.sessionDate].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Test cases */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Test Cases
              </p>
              {testCases.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  No test cases yet. Create one in the Test Cases tab.
                </p>
              ) : (
                <div className="space-y-1">
                  {testCases.map((tc) => (
                    <label
                      key={tc.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tc.id)}
                        onChange={() => toggleId(tc.id)}
                        className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-900">
                          {tc.name || "Untitled"}
                        </div>
                        {tc.courseName && (
                          <div className="truncate text-xs text-zinc-500">{tc.courseName}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning
            ? runProgress
              ? `Running… (${runProgress.done}/${runProgress.total})`
              : "Running…"
            : selectedIds.size > 1
            ? `Run Script (${selectedIds.size} sessions)`
            : "Run Script"}
        </button>
      </div>

      {/* View Results button */}
      {sessionResults.length > 0 && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
        >
          View Results
        </button>
      )}

      {/* Results modal */}
      {showModal && sessionResults.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div className="flex h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-zinc-200 bg-zinc-50 shadow-xl">
            {/* Modal header */}
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-zinc-900">Results</h2>

                {/* Session tabs (if multiple) */}
                {sessionResults.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {sessionResults.map((r, i) => (
                      <button
                        key={r.sessionId}
                        type="button"
                        onClick={() => {
                          setActiveSessionIdx(i);
                          setActiveResultType(
                            sessionResults[i].pacing ? "pacing" : "assignment"
                          );
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          activeSessionIdx === i
                            ? "bg-zinc-900 text-white shadow-sm"
                            : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {r.sessionName}
                        {r.isTestCase && (
                          <span className="ml-1 opacity-60">(test)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Pacing / Assignment toggle */}
                {activeResult?.pacing && activeResult?.assignment && (
                  <div className="flex gap-2">
                    {(["pacing", "assignment"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveResultType(key)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          activeResultType === key
                            ? "bg-zinc-900 text-white shadow-sm"
                            : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {key === "pacing" ? "Group Pacing" : "Events"}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>

            {/* Modal body */}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {activeResult && activeResultType === "pacing" && activeResult.pacing && (
                <PacingScriptResultPanel
                  result={activeResult.pacing}
                  pacingMatches={activeResult.pacingMatches}
                  csvAnnotations={activeResult.csvAnnotations}
                />
              )}
              {activeResult && activeResultType === "assignment" && (
                <AssignmentScriptResultPanel
                  result={activeResult.assignment}
                  eventMatches={activeResult.eventMatches}
                  assignmentAnnotations={activeResult.assignmentAnnotations}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
