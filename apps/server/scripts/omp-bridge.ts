import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import type { DiagramSpec } from "@OpenDiagram/harness";
import { diagramSpecSchema } from "../../../packages/harness/src/diagram-schema";

export type NativeMessage = UIMessage;

export type DiagramView = {
  id: string;
  spec: DiagramSpec;
  skeletons: unknown[];
  rawElements: unknown[];
  summary: { title: string; nodes: number; edges: number; warnings: string[] };
};

export type PendingQuestion = { toolCallId: string; question: string; options: string[] };
export type NativeTurn = {
  diagrams: DiagramView[];
  message: UIMessage;
  question?: PendingQuestion;
};

function viewFrom(spec: unknown, value: unknown): DiagramView {
  const output = value as Partial<DiagramView> | undefined;
  const parsed = diagramSpecSchema.parse(spec);
  if (
    !output ||
    !Array.isArray(output.skeletons) ||
    !Array.isArray(output.rawElements) ||
    !output.summary
  ) {
    throw new Error("Incomplete native diagram output");
  }
  if (!parsed.nodes.length) throw new Error("No drawable diagram returned");
  return {
    id: crypto.randomUUID(),
    spec: parsed,
    skeletons: output.skeletons,
    rawElements: output.rawElements,
    summary: output.summary,
  };
}

/** Decode the native SDK stream and apply the same tool targeting rules as the web canvas. */
export async function parseDiagramTurn(
  text: string,
  current: DiagramView[] = [],
  continuation?: UIMessage,
): Promise<NativeTurn> {
  const chunks = text.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") return [];
    return [JSON.parse(line.slice(6)) as UIMessageChunk];
  });
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let message: UIMessage | undefined;
  for await (const next of readUIMessageStream({
    stream,
    message: continuation ? structuredClone(continuation) : undefined,
    terminateOnError: true,
  }))
    message = next;
  if (!message) throw new Error("OpenDiagram returned no message");

  let diagrams = [...current];
  let completedDraw = false;
  let question: PendingQuestion | undefined;
  const alreadyApplied = new Set(
    continuation?.parts.flatMap((part) =>
      "toolCallId" in part && "state" in part && part.state === "output-available"
        ? [part.toolCallId]
        : [],
    ) ?? [],
  );
  for (const part of message.parts) {
    if (part.type === "tool-ask_user" && part.state === "input-available") {
      const input = part.input as { question: string; options: string[] };
      question = { toolCallId: part.toolCallId, question: input.question, options: input.options };
    }
    if (part.type !== "tool-draw_diagram" && part.type !== "tool-draw_system") continue;
    if (part.state !== "output-available" || alreadyApplied.has(part.toolCallId)) continue;
    completedDraw = true;
    if (part.type === "tool-draw_diagram") {
      const { targetId, ...spec } = part.input as DiagramSpec & { targetId?: string };
      diagrams = diagrams.filter((diagram) => diagram.id !== targetId);
      diagrams.push(viewFrom(spec, part.output));
    } else {
      const replaceIds = (part.input as { replaceIds?: string[] }).replaceIds ?? [];
      const output = part.output as { views: Omit<DiagramView, "id">[] };
      if (!Array.isArray(output.views) || output.views.length === 0) {
        throw new Error("Incomplete native system output");
      }
      diagrams = diagrams.filter((diagram) => !replaceIds.includes(diagram.id));
      diagrams.push(...output.views.map((view) => viewFrom(view.spec, view)));
    }
  }
  if (!completedDraw && !question) throw new Error("No completed native draw result");
  return { diagrams, message, question };
}

/** Answer the pending native client-side tool without inventing a new user turn. */
export function answerQuestion(
  messages: UIMessage[],
  question: PendingQuestion,
  answer: string,
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "tool-ask_user" && part.toolCallId === question.toolCallId
        ? {
            type: "tool-ask_user" as const,
            toolCallId: part.toolCallId,
            state: "output-available" as const,
            input: part.input,
            output: answer,
          }
        : part,
    ),
  }));
}
