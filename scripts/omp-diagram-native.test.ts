import { expect, test } from "bun:test";
import { parseDiagramTurn } from "./omp-diagram";

const view = (title: string) => ({
  spec: { type: "system-design" as const, title, nodes: [{ id: "api", label: "API" }], edges: [] },
  skeletons: [{ kind: "frame", id: title, children: [] }],
  rawElements: [],
  summary: { title, nodes: 1, edges: 0, warnings: [] },
});

function stream(...events: unknown[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

test("keeps every native draw_system view instead of rejecting the result", async () => {
  const result = await parseDiagramTurn(
    stream(
      { type: "start", messageId: "assistant-1" },
      { type: "start-step" },
      { type: "tool-input-available", toolCallId: "system-1", toolName: "draw_system", input: {} },
      {
        type: "tool-output-available",
        toolCallId: "system-1",
        output: { views: [view("Overview"), view("Checkout")] },
      },
      { type: "finish-step" },
      { type: "finish" },
    ),
  );
  expect(result.diagrams.map((diagram) => diagram.spec.title)).toEqual(["Overview", "Checkout"]);
  expect(result.message.parts.some((part) => part.type === "tool-draw_system")).toBe(true);
});

test("a failed native revision cannot be reported as a successful unchanged board", async () => {
  const current = { ...view("Existing"), id: "existing" };
  await expect(
    parseDiagramTurn(
      stream(
        { type: "start", messageId: "failed-revision" },
        { type: "start-step" },
        {
          type: "tool-input-available",
          toolCallId: "failed",
          toolName: "draw_diagram",
          input: { ...current.spec, targetId: current.id },
        },
        { type: "tool-output-error", toolCallId: "failed", errorText: "Layout failed" },
        { type: "finish-step" },
        { type: "finish" },
      ),
      [current],
    ),
  ).rejects.toThrow("No completed native draw result");
});
