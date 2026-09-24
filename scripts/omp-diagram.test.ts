import { describe, expect, test } from "bun:test";
import { parseDiagramEvents } from "./omp-diagram";

const id = "4d89a68c-891c-4fea-acad-c350e512dd7f";
const spec = {
  type: "system-design",
  title: "Browser to API",
  nodes: [{ id: "web", label: "Web" }],
  edges: [],
};
const output = {
  skeletons: [{ kind: "text", text: "Web" }],
  rawElements: [],
  summary: { title: "Browser to API", nodes: 1, edges: 0, warnings: [] },
};
function stream(...events: unknown[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

describe("local diagram stream", () => {
  test("pairs a validated spec with its render result", () => {
    const result = parseDiagramEvents(
      stream(
        { type: "tool-input-available", toolCallId: "a", toolName: "draw_diagram", input: spec },
        { type: "tool-output-available", toolCallId: "a", output },
      ),
    );
    expect(result.spec.title).toBe("Browser to API");
    expect(result.skeletons).toHaveLength(1);
  });

  test("revision cannot replace a different diagram", () => {
    expect(() =>
      parseDiagramEvents(
        stream(
          { type: "tool-input-available", toolCallId: "a", toolName: "draw_diagram", input: spec },
          { type: "tool-output-available", toolCallId: "a", output },
        ),
        id,
      ),
    ).toThrow("No completed draw_diagram result");
  });

  test("surfaces the model's question without writing an empty diagram", () => {
    expect(() =>
      parseDiagramEvents(
        stream({
          type: "tool-input-available",
          toolCallId: "a",
          toolName: "ask_user",
          input: { question: "Which cloud?" },
        }),
      ),
    ).toThrow("Which cloud?");
  });
});
