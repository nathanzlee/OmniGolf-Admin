"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listTestCases } from "@/app/actions";
import {
  TEST_CASE_LABEL_OPTIONS,
  TestCase,
  TestCaseLabel,
  testCaseToExportJson,
} from "@/lib/testCases";

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

type StoredSessionEvent = {
  id: string;
  groupId: string;
  eventType: string;
  landmark: string;
  time: string;
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

const MATCH_THRESHOLD_MIN = 3;

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

function isCaughtEventsFile(file: CsvResult) {
  return file.name.toLowerCase().includes("caught_events") && file.name.toLowerCase().endsWith(".json");
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
  if (n === "skiphole") return "skiphole";
  if (n === "passgroup") return "passgroup";
  return n;
}

function caughtEventType(caught: any) {
  return normalizeEventType(String(caught.event_type ?? caught.event ?? caught.type ?? ""));
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
    try {
      const assignmentKey = [...assignmentJsonMap.keys()].find((k) => k.includes("caught_events")) ?? "";
      assignmentCaught = JSON.parse(assignmentJsonMap.get(assignmentKey) ?? "[]");
    } catch { /* ignore */ }
    try {
      const pacingKey = [...pacingJsonMap.keys()].find((k) => k.includes("caught_events")) ?? "";
      pacingCaught = JSON.parse(pacingJsonMap.get(pacingKey) ?? "[]");
    } catch { /* ignore */ }

    // Build group_id → label from the session JSON groups (same data the scripts see)
    const groupIdToLabel = new Map<string, string>(
      (sessionData.groups ?? []).map((g: any) => [
        String(g.group_id ?? g.id ?? ""),
        String(g.label ?? ""),
      ])
    );

    const sessionEvents: any[] = sessionData.events ?? [];

    // ── If there are expected events in the session JSON, match against caught ──
    if (sessionEvents.length > 0) {
      const matches: EventMatchRow[] = sessionEvents.map((ev: any) => {
        const evType = normalizeEventType(ev.event_type ?? "");
        const groupId: string | null = ev.group_id ?? null;
        // Derive group label from session groups (authoritative) rather than ev.group_label
        const groupLabel: string | null = groupId
          ? (groupIdToLabel.get(groupId) ?? ev.group_label ?? null)
          : (ev.group_label ?? null);
        const landmark: string | null = ev.landmark_label ?? ev.landmark ?? null;

        const isAssignment = evType === "groupsplit" || evType === "groupjoin";
        const isPacing = evType === "behindpace" || evType === "leavecourse";
        const isEitherScriptEvent = evType === "skiphole" || evType === "passgroup";

        let caught = false;
        let detail: string | null = null;

        if (isAssignment) {
          const landmarkHole = ev.landmark?.startsWith?.("hole:")
            ? parseInt(ev.landmark.split(":")[1], 10) : null;
          const hit = assignmentCaught.find((c: any) => {
            if (caughtEventType(c) !== evType) return false;
            // Prefer hole_number match (unambiguous), then fall back to group label
            if (landmarkHole != null && c.hole_number != null) return Number(c.hole_number) === landmarkHole;
            const cGroup = (c.group ?? "").trim().toLowerCase();
            const evGroup = (groupLabel ?? "").trim().toLowerCase();
            return cGroup.length > 0 && evGroup.length > 0 && cGroup === evGroup;
          });
          if (hit) {
            caught = true;
            if (hit.new_group1?.label && hit.new_group2?.label) {
              detail = `→ ${hit.new_group1.label}, ${hit.new_group2.label}`;
            } else if (hit.new_group1?.label) {
              detail = `→ ${hit.new_group1.label}`;
            }
          }
        } else if (isPacing) {
          const hit = pacingCaught.find((c: any) => {
            if (caughtEventType(c) !== evType) return false;
            if (groupId && c.group_id) return c.group_id === groupId;
            const cLabel = (c.group_label ?? "").trim().toLowerCase();
            const evLabel = (groupLabel ?? "").trim().toLowerCase();
            return cLabel && evLabel ? cLabel === evLabel : false;
          });
          if (hit) {
            caught = true;
            if (hit.hole != null) detail = `Hole ${hit.hole}`;
          }
        } else if (isEitherScriptEvent) {
          const landmarkHole = ev.landmark?.startsWith?.("hole:")
            ? parseInt(ev.landmark.split(":")[1], 10) : null;
          const hit = [...assignmentCaught, ...pacingCaught].find((c: any) => {
            if (caughtEventType(c) !== evType) return false;

            const caughtHole = c.hole_number ?? c.hole ?? c.predicted_hole;
            if (landmarkHole != null && caughtHole != null && Number(caughtHole) !== landmarkHole) {
              return false;
            }

            if (groupId && c.group_id && c.group_id === groupId) return true;

            const cLabel = String(c.group_label ?? c.group ?? c.passed_group ?? "").trim().toLowerCase();
            const evLabel = (groupLabel ?? "").trim().toLowerCase();
            if (evLabel && cLabel) return evLabel === cLabel;

            return landmarkHole != null && caughtHole != null && Number(caughtHole) === landmarkHole;
          });
          if (hit) {
            caught = true;
            const caughtHole = hit.hole_number ?? hit.hole ?? hit.predicted_hole;
            if (caughtHole != null) detail = `Hole ${caughtHole}`;
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

function EventMetrics({ matches }: { matches: EventMatchRow[] }) {
  if (matches.length === 0) return null;

  const caughtCount = matches.filter((m) => m.caught).length;
  const allCaught = caughtCount === matches.length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Event Coverage</h3>
        <span className={`text-xs font-medium ${allCaught ? "text-green-600" : "text-zinc-600"}`}>
          {caughtCount}/{matches.length} events caught by script
        </span>
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="sticky top-0 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Event</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Group</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Landmark</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Caught</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 text-sm text-zinc-800">
                <td className="px-3 py-2 whitespace-nowrap capitalize">{m.eventType}</td>
                <td className="px-3 py-2 whitespace-nowrap">{m.groupLabel ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{m.landmark ?? "—"}</td>
                <td className={`px-3 py-2 text-xs font-medium whitespace-nowrap ${m.caught ? "text-green-600" : "text-red-500"}`}>
                  {m.caught ? "✓" : "✗"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{m.detail ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function pacingAccuracyPassed(result: SessionRunResult) {
  if (!result.pacing) return true;
  if (result.pacing.error) return false;

  const checks = result.pacingMatches.flatMap((match) => [
    match.startMatch,
    match.endMatch,
  ]).filter((match): match is boolean => match !== null);

  return checks.length > 0 && checks.every(Boolean);
}

function eventCoveragePassed(result: SessionRunResult) {
  if (result.pacing?.error || result.assignment?.error) return false;
  return result.eventMatches.every((match) => match.caught);
}

function resultPassed(result: SessionRunResult) {
  return pacingAccuracyPassed(result) && eventCoveragePassed(result);
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
  const jsonFiles = (result.jsonFiles ?? []).filter((file) => !isCaughtEventsFile(file));
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
  extraJsonFiles = [],
}: {
  result: ScriptResult;
  eventMatches: EventMatchRow[];
  assignmentAnnotations: CsvAnnotations;
  extraJsonFiles?: CsvResult[];
}) {
  const [activeTab, setActiveTab] = useState(0);
  if (!result) return null;

  const csvFiles = (result.csvFiles ?? []).filter(
    (f) => f.name === "input_teeoff_gatherings.csv"
  );
  const jsonFiles = result.jsonFiles ?? [];
  const existingNames = new Set([...csvFiles, ...jsonFiles].map((file) => file.name));
  const renamedExtraJsonFiles = extraJsonFiles.map((file) => {
    if (!existingNames.has(file.name)) {
      existingNames.add(file.name);
      return file;
    }
    const renamed = { ...file, name: `group_pacing/${file.name}` };
    existingNames.add(renamed.name);
    return renamed;
  });
  const allFiles: CsvResult[] = [...csvFiles, ...jsonFiles, ...renamedExtraJsonFiles];

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
  const [completedSessionsOpen, setCompletedSessionsOpen] = useState(true);
  const [testCasesOpen, setTestCasesOpen] = useState(true);
  const [testCaseCourseFilter, setTestCaseCourseFilter] = useState("");
  const [testCaseLabelFilters, setTestCaseLabelFilters] = useState<TestCaseLabel[]>([]);

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

    void listTestCases()
      .then(setTestCases)
      .catch((e: unknown) => console.error(e));
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

  function toggleTestCaseLabelFilter(label: TestCaseLabel) {
    setTestCaseLabelFilters((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  }

  const testCaseCourseOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const tc of testCases) {
      if (!tc.courseId) continue;
      byId.set(tc.courseId, tc.courseName || "Unnamed Course");
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [testCases]);

  const filteredTestCases = useMemo(
    () =>
      testCases.filter((tc) => {
        if (testCaseCourseFilter && tc.courseId !== testCaseCourseFilter) return false;
        return testCaseLabelFilters.every((label) => tc.labels?.includes(label));
      }),
    [testCaseCourseFilter, testCaseLabelFilters, testCases]
  );

  const visibleTestCaseIds = useMemo(
    () => filteredTestCases.map((tc) => tc.id),
    [filteredTestCases]
  );

  const allVisibleTestCasesSelected =
    visibleTestCaseIds.length > 0 && visibleTestCaseIds.every((id) => selectedIds.has(id));

  function toggleSelectVisibleTestCases() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleTestCasesSelected) {
        visibleTestCaseIds.forEach((id) => next.delete(id));
      } else {
        visibleTestCaseIds.forEach((id) => next.add(id));
      }
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
          // Get pacing rows from localStorage
          let pacingRows: StoredPacingRow[] = [];
          try {
            pacingRows = JSON.parse(
              localStorage.getItem(`omnigolf-group-pacing-v1-${id}`) ?? "[]"
            );
          } catch {
            /* ignore */
          }
          try {
            const events = JSON.parse(
              localStorage.getItem(`omnigolf-session-events-v1-${id}`) ?? "[]"
            ) as StoredSessionEvent[];
            const groupLabelMap = new Map<string, string>(
              (data.groups ?? []).map((g: any) => [
                String(g.group_id ?? g.id ?? ""),
                String(g.label ?? ""),
              ])
            );
            data.events = events
              .filter((event) => event.eventType)
              .map((event) => ({
                group_id: event.groupId || null,
                group_label: event.groupId ? (groupLabelMap.get(event.groupId) ?? null) : null,
                event_type: event.eventType,
                landmark: event.landmark || null,
                landmark_label: event.landmark || null,
                time: event.time || null,
              }));
          } catch {
            data.events = data.events ?? [];
          }
          const jsonStr = JSON.stringify(data, null, 2);
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
            jsonFiles: [],
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
          jsonFiles: [],
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
  const activeResultTypeAvailable =
    activeResultType === "pacing" ? !!activeResult?.pacing : !!activeResult?.assignment;
  const visibleResultType = activeResultTypeAvailable
    ? activeResultType
    : activeResult?.pacing
    ? "pacing"
    : "assignment";

  function handleResultSessionClick(index: number) {
    const next = sessionResults[index];
    setActiveSessionIdx(index);
    if (activeResultType === "pacing" && !next.pacing) {
      setActiveResultType("assignment");
    } else if (activeResultType === "assignment" && !next.assignment) {
      setActiveResultType("pacing");
    }
  }

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
                <button
                  type="button"
                  onClick={() => setCompletedSessionsOpen((open) => !open)}
                  className="mb-2 flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:bg-zinc-50"
                >
                  <span>Completed Sessions</span>
                  <span>{completedSessionsOpen ? "▲" : "▼"}</span>
                </button>
                {completedSessionsOpen && (
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
                )}
              </div>
            )}

            {/* Test cases */}
            <div>
              <button
                type="button"
                onClick={() => setTestCasesOpen((open) => !open)}
                className="mb-2 flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:bg-zinc-50"
              >
                <span>Test Cases</span>
                <span>{testCasesOpen ? "▲" : "▼"}</span>
              </button>
              {testCasesOpen && (
                <div className="space-y-3">
                  {testCases.length > 0 && (
                    <div className="space-y-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-zinc-600">Course</label>
                          <select
                            value={testCaseCourseFilter}
                            onChange={(e) => setTestCaseCourseFilter(e.target.value)}
                            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-zinc-400"
                          >
                            <option value="">All courses</option>
                            {testCaseCourseOptions.map(([id, name]) => (
                              <option key={id} value={id}>{name}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={toggleSelectVisibleTestCases}
                          disabled={visibleTestCaseIds.length === 0}
                          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {allVisibleTestCasesSelected ? "Clear visible" : "Select all"}
                        </button>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600">Labels</label>
                        <div className="flex flex-wrap gap-1.5">
                          {TEST_CASE_LABEL_OPTIONS.map((label) => {
                            const selected = testCaseLabelFilters.includes(label);
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => toggleTestCaseLabelFilter(label)}
                                className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                                  selected
                                    ? "border-zinc-900 bg-zinc-900 text-white"
                                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  {testCases.length === 0 ? (
                    <p className="text-xs text-zinc-400">
                      No test cases yet. Create one in the Test Cases tab.
                    </p>
                  ) : filteredTestCases.length === 0 ? (
                    <p className="text-xs text-zinc-400">
                      No test cases match the current filters.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filteredTestCases.map((tc) => (
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
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <h2 className="shrink-0 text-sm font-semibold text-zinc-900">Results</h2>

                  {/* Session tabs (if multiple) */}
                  {sessionResults.length > 1 && (
                    <div className="max-w-full flex-1 overflow-x-auto pb-3">
                      <div className="flex w-max gap-1">
                        {sessionResults.map((r, i) => {
                          const passed = resultPassed(r);
                          return (
                            <button
                              key={r.sessionId}
                              type="button"
                              onClick={() => handleResultSessionClick(i)}
                              className={`flex max-w-56 shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                activeSessionIdx === i
                                  ? "bg-zinc-900 text-white shadow-sm"
                                  : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                            >
                              <span className={passed ? "text-green-500" : "text-red-500"}>
                                {passed ? "✓" : "✕"}
                              </span>
                              <span className="truncate">{r.sessionName}</span>
                              {r.isTestCase && (
                                <span className="shrink-0 opacity-60">(test)</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Pacing / Assignment toggle */}
                {activeResult?.pacing && activeResult?.assignment && (
                  <div className="flex gap-2">
                    {(["pacing", "assignment"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveResultType(key)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          visibleResultType === key
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
              {activeResult && visibleResultType === "pacing" && activeResult.pacing && (
                <PacingScriptResultPanel
                  result={activeResult.pacing}
                  pacingMatches={activeResult.pacingMatches}
                  csvAnnotations={activeResult.csvAnnotations}
                />
              )}
              {activeResult && visibleResultType === "assignment" && (
                <AssignmentScriptResultPanel
                  result={activeResult.assignment}
                  eventMatches={activeResult.eventMatches}
                  assignmentAnnotations={activeResult.assignmentAnnotations}
                  extraJsonFiles={(activeResult.pacing?.jsonFiles ?? []).filter(isCaughtEventsFile)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
