"use client";

import { useEffect, useRef, useState } from "react";

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

type ScriptSlot = {
  name: string | null;
  b64: string | null;
};

const LS_KEYS = {
  pacingName:     "omnigolf-script-pacing-name",
  pacingB64:      "omnigolf-script-pacing-b64",
  assignmentName: "omnigolf-script-assignment-name",
  assignmentB64:  "omnigolf-script-assignment-b64",
};

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parse = (line: string) =>
    line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return { headers: parse(lines[0]), rows: lines.slice(1).map(parse) };
}

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

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
      <input ref={inputRef} type="file" accept=".py" className="hidden" onChange={onUpload} />
    </div>
  );
}

function ScriptResultPanel({ result }: { result: ScriptResult }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!result) return null;

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

  const csvFiles = result.csvFiles ?? [];

  if (csvFiles.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        Script ran successfully but produced no CSV files.
        {result.stdout && (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>
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

      <div className="overflow-x-auto p-4">
        {headers.length === 0 ? (
          <p className="text-sm text-zinc-500">CSV is empty.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50">
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
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>
          )}
          {result.stderr && (
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-600">{result.stderr}</pre>
          )}
        </details>
      )}
    </div>
  );
}

export default function ScriptTester({ completedSessions }: { completedSessions: SessionOption[] }) {
  const [pacing, setPacing]         = useState<ScriptSlot>({ name: null, b64: null });
  const [assignment, setAssignment] = useState<ScriptSlot>({ name: null, b64: null });
  const pacingRef    = useRef<HTMLInputElement>(null);
  const assignmentRef = useRef<HTMLInputElement>(null);

  const [jsonText, setJsonText]             = useState("");
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults]     = useState<RunResults | null>(null);
  const [activeResult, setActiveResult] = useState<"pacing" | "assignment">("pacing");

  // Load persisted scripts
  useEffect(() => {
    const pn = localStorage.getItem(LS_KEYS.pacingName);
    const pb = localStorage.getItem(LS_KEYS.pacingB64);
    if (pn && pb) setPacing({ name: pn, b64: pb });

    const an = localStorage.getItem(LS_KEYS.assignmentName);
    const ab = localStorage.getItem(LS_KEYS.assignmentB64);
    if (an && ab) setAssignment({ name: an, b64: ab });
  }, []);

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
      if (pacing.b64)     fd.append("script_pacing",     toFile(pacing));
      if (assignment.b64) fd.append("script_assignment",  toFile(assignment));

      const res  = await fetch("/api/run-script", { method: "POST", body: fd });
      const data = await res.json() as RunResults;
      setResults(data);
      setActiveResult(data.pacing ? "pacing" : "assignment");
    } catch (err: any) {
      setResults({
        pacing:     pacing.b64     ? { csvFiles: [], stdout: "", stderr: "", error: err?.message ?? "Request failed" } : null,
        assignment: assignment.b64 ? { csvFiles: [], stdout: "", stderr: "", error: err?.message ?? "Request failed" } : null,
      });
    } finally {
      setIsRunning(false);
    }
  }

  const canRun = !!jsonText.trim() && (!!pacing.b64 || !!assignment.b64) && !isRunning;

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
              onClear={makeClearHandler(setPacing, LS_KEYS.pacingName, LS_KEYS.pacingB64, pacingRef)}
            />
            <ScriptUploadSlot
              label="Group Assignments"
              slot={assignment}
              inputRef={assignmentRef}
              onUpload={makeUploadHandler(setAssignment, LS_KEYS.assignmentName, LS_KEYS.assignmentB64)}
              onClear={makeClearHandler(setAssignment, LS_KEYS.assignmentName, LS_KEYS.assignmentB64, assignmentRef)}
            />
          </div>
        </div>

        {/* Session JSON card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-zinc-900">Session JSON</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Choose a completed session or upload a JSON file.
            </p>
          </div>
          <div className="space-y-2">
            <select
              defaultValue=""
              onChange={(e) => loadSession(e.target.value)}
              disabled={isLoadingSession}
              className={inputClass + " w-full"}
            >
              <option value="">Select a completed session…</option>
              {completedSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.courseName ? ` — ${s.courseName}` : ""}
                  {s.sessionDate ? ` (${s.sessionDate})` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => jsonInputRef.current?.click()}
              disabled={isLoadingSession}
              className="w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
            >
              {jsonText ? "Replace with uploaded file" : "Or upload a .json file"}
            </button>
          </div>
          {jsonText && (
            <p className="mt-2 text-xs text-zinc-500">
              {isLoadingSession ? "Loading…" : "✓ JSON loaded"}
            </p>
          )}
          <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={handleJsonUpload} />
        </div>
      </div>

      {/* Run button */}
      <div>
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? "Running…" : "Run Script"}
        </button>
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          {/* Top-level toggle */}
          {results.pacing && results.assignment && (
            <div className="flex gap-2">
              {(["pacing", "assignment"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveResult(key)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    activeResult === key
                      ? "bg-zinc-900 text-white shadow-sm"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {key === "pacing" ? "Group Pacing" : "Group Assignments"}
                </button>
              ))}
            </div>
          )}

          <ScriptResultPanel
            result={activeResult === "pacing" ? results.pacing : results.assignment}
          />
        </div>
      )}
    </div>
  );
}
