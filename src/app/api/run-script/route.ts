import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFile, readdir, readFile, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const scriptFile = formData.get("script") as File | null;
  const jsonStr = formData.get("json") as string | null;

  if (!scriptFile || !jsonStr) {
    return NextResponse.json(
      { error: "Missing script or json" },
      { status: 400 }
    );
  }

  const dir = join(tmpdir(), `omnigolf-script-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  const scriptPath = join(dir, "script.py");
  const jsonPath = join(dir, "input.json");

  try {
    await writeFile(scriptPath, Buffer.from(await scriptFile.arrayBuffer()));
    await writeFile(jsonPath, jsonStr, "utf-8");

    const { stdout, stderr } = await execAsync(
      `python3 "${scriptPath}" "${jsonPath}"`,
      { cwd: dir, timeout: 60_000 }
    );

    const files = await readdir(dir);
    const csvFiles = files.filter((f) => f.endsWith(".csv")).sort();

    const csvResults = await Promise.all(
      csvFiles.map(async (f) => ({
        name: f,
        content: await readFile(join(dir, f), "utf-8"),
      }))
    );

    return NextResponse.json({ csvFiles: csvResults, stdout, stderr });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: err?.message ?? "Script execution failed",
        stderr: err?.stderr ?? "",
        stdout: err?.stdout ?? "",
      },
      { status: 500 }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
