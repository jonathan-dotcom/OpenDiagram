#!/usr/bin/env bun
/** Local transport for OpenDiagram's native chat, tools and canvas output. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  answerQuestion,
  parseDiagramTurn,
  type DiagramView,
  type PendingQuestion,
  type NativeMessage,
} from "../apps/server/scripts/omp-bridge";
import { diagramSpecSchema } from "../packages/harness/src/diagram-schema";

export { parseDiagramTurn } from "../apps/server/scripts/omp-bridge";

const root = resolve(process.env.LOCAL_AGENT_DATA_DIR ?? join(import.meta.dir, "../data/agent"));
const api = process.env.OPENDIAGRAM_API_URL ?? "http://127.0.0.1:3002";
const idPattern = /^[a-f0-9]{8}-[a-f0-9-]{27,50}$/i;

type RecordData = {
  id: string;
  revision: number;
  diagrams: DiagramView[];
  messages: NativeMessage[];
  question?: PendingQuestion;
  // Retained on disk for existing consumers of a single-diagram export.
  spec?: DiagramView["spec"];
  skeletons?: unknown[];
  rawElements?: unknown[];
};

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
  // Existing local records remain usable without rewriting their source files.
  data.diagrams ??= data.spec
    ? [
        {
          id: data.id,
          spec: data.spec,
          skeletons: data.skeletons ?? [],
          rawElements: data.rawElements ?? [],
          summary: {
            title: data.spec.title,
            nodes: data.spec.nodes.length,
            edges: data.spec.edges.length,
            warnings: [],
          },
        },
      ]
    : [];
  for (const diagram of data.diagrams) diagram.spec = diagramSpecSchema.parse(diagram.spec);
  data.messages ??= [];
  return data;
}

async function save(record: RecordData) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = fileFor(record.id);
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
  await rename(tmp, target);
}

async function generate(
  prompt: string,
  previous?: RecordData,
  answer = false,
): Promise<RecordData> {
  const endpoint = new URL(api);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("OPENDIAGRAM_API_URL must be local");
  }
  if (answer && !previous?.question) throw new Error("This board has no pending question");
  if (!answer && previous?.question)
    throw new Error("Use answer <id> <answer|-> to answer the pending question");
  const messages: NativeMessage[] = answer
    ? answerQuestion(previous!.messages, previous!.question!, prompt)
    : [
        ...(previous?.messages ?? []),
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] },
      ];
  const continuation = messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;
  const response = await fetch(new URL("/api/diagram/chat", endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      diagrams: (previous?.diagrams ?? []).slice(-8).map(({ id, spec }) => ({ id, spec })),
      theme: "sketch",
      conversationId: previous?.id,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`OpenDiagram API returned ${response.status}`);
  const result = await parseDiagramTurn(await response.text(), previous?.diagrams, continuation);
  const history = continuation ? messages.slice(0, -1) : messages;
  const first = result.diagrams[0];
  const record: RecordData = {
    id: previous?.id ?? crypto.randomUUID(),
    revision: (previous?.revision ?? 0) + 1,
    diagrams: result.diagrams,
    messages: [...history, result.message],
    question: result.question,
    spec: first?.spec,
    skeletons: first?.skeletons,
    rawElements: first?.rawElements,
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

function printRecord(record: RecordData) {
  console.log(
    JSON.stringify({
      id: record.id,
      revision: record.revision,
      status: record.question ? "needs_input" : "ready",
      question: record.question,
      views: record.diagrams.map(({ id, summary }) => ({ id, ...summary })),
      ...links(record.id),
    }),
  );
}

async function main(args: string[]) {
  const [action, first, second] = args;
  if (action === "create") {
    printRecord(await generate(await promptFrom(first)));
  } else if (action === "revise" || action === "answer") {
    printRecord(
      await generate(await promptFrom(second), await load(first ?? ""), action === "answer"),
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
      "Usage: bun scripts/omp-diagram.ts create <prompt|-> | revise <id> <prompt|-> | answer <id> <answer|-> | open <id> | export <id> <output.opendiagram.json>",
    );
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
