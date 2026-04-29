import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFile, readdir, readFile, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

type ScriptResult = {
  csvFiles: { name: string; content: string }[];
  jsonFiles: { name: string; content: string }[];
  stdout: string;
  stderr: string;
  error?: string;
};

async function runScript(
  scriptBytes: ArrayBuffer,
  scriptName: string,
  jsonStr: string,
  subdir: string
): Promise<ScriptResult> {
  await mkdir(subdir, { recursive: true });
  const scriptPath = join(subdir, scriptName);
  const jsonPath = join(subdir, "input.json");
  await writeFile(scriptPath, Buffer.from(scriptBytes));
  await writeFile(jsonPath, jsonStr, "utf-8");

  try {
    const { stdout, stderr } = await execAsync(
      `python3 "${scriptPath}" "${jsonPath}"`,
      { cwd: subdir, timeout: 60_000 }
    );
    const files = await readdir(subdir);
    const csvFiles = files.filter((f) => f.endsWith(".csv")).sort();
    const csvResults = await Promise.all(
      csvFiles.map(async (f) => ({
        name: f,
        content: await readFile(join(subdir, f), "utf-8"),
      }))
    );
    const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "input.json").sort();
    const jsonResults = await Promise.all(
      jsonFiles.map(async (f) => ({
        name: f,
        content: await readFile(join(subdir, f), "utf-8"),
      }))
    );
    return { csvFiles: csvResults, jsonFiles: jsonResults, stdout, stderr };
  } catch (err: any) {
    return {
      csvFiles: [],
      jsonFiles: [],
      stdout: err?.stdout ?? "",
      stderr: err?.stderr ?? "",
      error: err?.message ?? "Script execution failed",
    };
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const pacingScript = formData.get("script_pacing") as File | null;
  const assignmentScript = formData.get("script_assignment") as File | null;
  const jsonStr = formData.get("json") as string | null;

  if (!jsonStr || (!pacingScript && !assignmentScript)) {
    return NextResponse.json(
      { error: "Provide json and at least one script" },
      { status: 400 }
    );
  }

  const base = join(tmpdir(), `omnigolf-script-${Date.now()}`);

  try {
    const [pacingResult, assignmentResult] = await Promise.all([
      pacingScript
        ? runScript(
            await pacingScript.arrayBuffer(),
            pacingScript.name,
            jsonStr,
            join(base, "pacing")
          )
        : Promise.resolve(null),
      assignmentScript
        ? runScript(
            await assignmentScript.arrayBuffer(),
            assignmentScript.name,
            jsonStr,
            join(base, "assignment")
          )
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ pacing: pacingResult, assignment: assignmentResult });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
