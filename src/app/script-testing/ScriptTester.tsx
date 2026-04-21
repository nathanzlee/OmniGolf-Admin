"use client";

import { useEffect, useRef, useState } from "react";

type CsvResult = { name: string; content: string };

type SessionOption = {
  id: string;
  name: string;
  sessionDate: string | null;
  courseName: string | null;
};
type RunResult = {
  csvFiles: CsvResult[];
  stdout: string;
  stderr: string;
  error?: string;
};

const SCRIPT_NAME_KEY = "omnigolf-script-name";
const SCRIPT_B64_KEY = "omnigolf-script-b64";

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parse = (line: string) =>
    line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const headers = parse(lines[0]);
  const rows = lines.slice(1).map(parse);
  return { headers, rows };
}

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400";

export default function ScriptTester({ completedSessions }: { completedSessions: SessionOption[] }) {
  // Script state (persisted in localStorage)
  const [scriptName, setScriptName] = useState<string | null>(null);
  const [scriptB64, setScriptB64] = useState<string | null>(null);
  const scriptInputRef = useRef<HTMLInputElement>(null);

  // JSON input state
  const [jsonText, setJsonText] = useState("");
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const [isLoadingSession, setIsLoadingSession] = useState(false);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  // Load persisted script
  useEffect(() => {
    const name = localStorage.getItem(SCRIPT_NAME_KEY);
    const b64 = localStorage.getItem(SCRIPT_B64_KEY);
    if (name && b64) {
      setScriptName(name);
      setScriptB64(b64);
    }
  }, []);

  function handleScriptUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(",")[1];
      setScriptName(file.name);
      setScriptB64(b64);
      localStorage.setItem(SCRIPT_NAME_KEY, file.name);
      localStorage.setItem(SCRIPT_B64_KEY, b64);
    };
    reader.readAsDataURL(file);
  }

  function handleJsonUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJsonText(reader.result as string);
    reader.readAsText(file);
  }

  async function loadSession(sessionId: string) {
    if (!sessionId) return;
    setIsLoadingSession(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const data = await res.json();
      setJsonText(JSON.stringify(data, null, 2));
    } catch (err: any) {
      window.alert(`Failed to load session: ${err?.message ?? "unknown error"}`);
    } finally {
      setIsLoadingSession(false);
    }
  }

  function clearScript() {
    setScriptName(null);
    setScriptB64(null);
    localStorage.removeItem(SCRIPT_NAME_KEY);
    localStorage.removeItem(SCRIPT_B64_KEY);
    if (scriptInputRef.current) scriptInputRef.current.value = "";
  }

  async function handleRun() {
    if (!scriptB64 || !scriptName || !jsonText.trim()) return;
    setIsRunning(true);
    setResult(null);

    try {
      // Reconstruct File from base64
      const bytes = Uint8Array.from(atob(scriptB64), (c) => c.charCodeAt(0));
      const scriptFile = new File([bytes], scriptName, { type: "text/plain" });

      const fd = new FormData();
      fd.append("script", scriptFile);
      fd.append("json", jsonText.trim());

      const res = await fetch("/api/run-script", { method: "POST", body: fd });
      const data: RunResult = await res.json();
      setResult(data);
      setActiveTab(0);
    } catch (err: any) {
      setResult({ csvFiles: [], stdout: "", stderr: "", error: err?.message ?? "Request failed" });
    } finally {
      setIsRunning(false);
    }
  }

  const canRun = !!scriptB64 && !!jsonText.trim() && !isRunning;

  return (
    <div className="space-y-6">
      {/* Upload row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Script upload */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-zinc-900">Python Script</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Upload your .py file. It will be saved in your browser and persist between sessions.
            </p>
          </div>
          {scriptName ? (
            <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
              <span className="text-sm text-zinc-800 font-mono">{scriptName}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => scriptInputRef.current?.click()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearScript}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => scriptInputRef.current?.click()}
              className="w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500 hover:bg-zinc-100"
            >
              Click to upload .py file
            </button>
          )}
          <input
            ref={scriptInputRef}
            type="file"
            accept=".py"
            className="hidden"
            onChange={handleScriptUpload}
          />
        </div>

        {/* JSON upload */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-zinc-900">Session JSON</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Choose a completed session, upload a file, or paste JSON directly.
            </p>
          </div>

          {/* Session picker */}
          <div className="mb-3 flex gap-2">
            <select
              defaultValue=""
              onChange={(e) => loadSession(e.target.value)}
              disabled={isLoadingSession}
              className={inputClass + " flex-1"}
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
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50 whitespace-nowrap"
            >
              Upload file
            </button>
          </div>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder={isLoadingSession ? "Loading…" : "Paste session JSON here, or use the options above…"}
            rows={6}
            className={inputClass + " w-full font-mono text-xs resize-y"}
          />
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleJsonUpload}
          />
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
          {isRunning ? "Running..." : "Run Script"}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {result.error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <strong>Error:</strong> {result.error}
              {result.stderr && (
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{result.stderr}</pre>
              )}
            </div>
          )}

          {!result.error && (result.csvFiles ?? []).length === 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
              Script ran successfully but produced no CSV files.
              {result.stdout && (
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-700">{result.stdout}</pre>
              )}
            </div>
          )}

          {(result.csvFiles ?? []).length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              {/* Tabs */}
              <div className="flex flex-wrap gap-1 border-b border-zinc-200 px-4 pt-3">
                {result.csvFiles.map((f, i) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => setActiveTab(i)}
                    className={`rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ${
                      activeTab === i
                        ? "border border-b-white border-zinc-200 bg-white text-zinc-900 -mb-px"
                        : "text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>

              {/* Table */}
              {result.csvFiles[activeTab] && (() => {
                const { headers, rows } = parseCSV(result.csvFiles[activeTab].content);
                return (
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
                );
              })()}

              {/* stdout/stderr accordion */}
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
          )}
        </div>
      )}
    </div>
  );
}
