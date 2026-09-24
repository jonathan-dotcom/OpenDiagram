#!/usr/bin/env bun
/** Local, file-backed bridge from OMP to OpenDiagram's existing diagram engine. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { diagramSpecSchema } from "../packages/harness/src/diagram-schema";

const root = resolve(process.env.LOCAL_AGENT_DATA_DIR ?? join(import.meta.dir, "../data/agent"));
const api = process.env.OPENDIAGRAM_API_URL ?? "http://127.0.0.1:3002";
const idPattern = /^[a-f0-9]{8}-[a-f0-9-]{27,50}$/i;

type RecordData = {
  id: string;
  revision: number;
  spec: ReturnType<typeof diagramSpecSchema.parse>;
  skeletons: unknown[];
  rawElements: unknown[];
  summary: { title: string; nodes: number; edges: number; warnings: string[] };
};

type DiagramEvent = {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export function parseDiagramEvents(
  text: string,
  expectedId?: string,
): Omit<RecordData, "id" | "revision"> {
  const inputs = new Map<string, unknown>();
  const outputs = new Map<string, unknown>();
  let question: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    let event: DiagramEvent;
    try {
      event = JSON.parse(line.slice(6)) as DiagramEvent;
    } catch {
      continue;
    }
    if (!event.toolCallId) continue;
    if (event.type === "tool-input-available" && event.toolName === "draw_diagram") {
      inputs.set(event.toolCallId, event.input);
    } else if (event.type === "tool-output-available") {
      outputs.set(event.toolCallId, event.output);
    } else if (event.type === "tool-input-available" && event.toolName === "ask_user") {
      question = (event.input as { question?: string })?.question;
    }
  }
  for (const [callId, value] of inputs) {
    const input = value as { targetId?: string } | null;
    if (expectedId && input?.targetId !== expectedId) continue;
    const output = outputs.get(callId) as
      | {
          skeletons?: unknown[];
          rawElements?: unknown[];
          summary?: RecordData["summary"];
        }
      | undefined;
    if (!output || !Array.isArray(output.skeletons) || !Array.isArray(output.rawElements)) continue;
    const { targetId: _targetId, ...rawSpec } = input ?? {};
    const spec = diagramSpecSchema.parse(rawSpec);
    if (!output.summary || !spec.nodes.length) throw new Error("No drawable diagram returned");
    return {
      spec,
      skeletons: output.skeletons,
      rawElements: output.rawElements,
      summary: output.summary,
    };
  }
  throw new Error(
    question ? `Diagram needs clarification: ${question}` : "No completed draw_diagram result",
  );
}

async function promptFrom(value?: string): Promise<string> {
  if (!value) throw new Error("Provide a prompt or '-' to read it from stdin");
  const prompt = (value === "-" ? await Bun.stdin.text() : value).trim();
  if (!prompt || prompt.length > 20000)
    throw new Error("Prompt must contain 1 to 20000 characters");
  return prompt;
}

function fileFor(id: string) {
  if (!idPattern.test(id)) throw new Error("Invalid diagram id");
  return join(root, `${id}.json`);
}

async function load(id: string): Promise<RecordData> {
  const data = JSON.parse(await readFile(fileFor(id), "utf8")) as RecordData;
  if (data.id !== id) throw new Error("Diagram id does not match file");
  data.spec = diagramSpecSchema.parse(data.spec);
  return data;
}

async function save(record: RecordData) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = fileFor(record.id);
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
  await rename(tmp, target);
}

async function generate(prompt: string, previous?: RecordData): Promise<RecordData> {
  const endpoint = new URL(api);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("OPENDIAGRAM_API_URL must be local");
  }
  const turnPrompt = previous
    ? `${prompt}\n\nUpdate the existing canvas diagram. Set targetId to ${previous.id} exactly; do not create another diagram.`
    : prompt;
  const response = await fetch(new URL("/api/diagram/chat", endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: turnPrompt }] },
      ],
      diagrams: previous ? [{ id: previous.id, spec: previous.spec }] : [],
      theme: "sketch",
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`OpenDiagram API returned ${response.status}`);
  const result = parseDiagramEvents(await response.text(), previous?.id);
  const record = {
    ...result,
    id: previous?.id ?? crypto.randomUUID(),
    revision: (previous?.revision ?? 0) + 1,
  };
  await save(record);
  return record;
}

function links(id: string) {
  return {
    open: `http://localhost:3001/agent/${id}`,
    download: `http://localhost:3001/agent/${id}?download=excalidraw`,
  };
}

async function main(args: string[]) {
  const [action, first, second] = args;
  if (action === "create") {
    const record = await generate(await promptFrom(first));
    console.log(
      JSON.stringify({
        id: record.id,
        revision: record.revision,
        summary: record.summary,
        ...links(record.id),
      }),
    );
  } else if (action === "revise") {
    const record = await generate(await promptFrom(second), await load(first ?? ""));
    console.log(
      JSON.stringify({
        id: record.id,
        revision: record.revision,
        summary: record.summary,
        ...links(record.id),
      }),
    );
  } else if (action === "open") {
    await load(first ?? "");
    console.log(JSON.stringify(links(first!)));
  } else if (action === "export") {
    if (!second) throw new Error("Provide an output .opendiagram.json path");
    const record = await load(first ?? "");
    await writeFile(resolve(second), JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
    console.log(resolve(second));
  } else {
    throw new Error(
      "Usage: bun scripts/omp-diagram.ts create <prompt|-> | revise <id> <prompt|-> | open <id> | export <id> <output.opendiagram.json>",
    );
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
