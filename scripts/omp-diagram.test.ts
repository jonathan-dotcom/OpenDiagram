import { describe, expect, test } from "bun:test";
import { parseDiagramTurn } from "./omp-diagram";
import { answerQuestion } from "../apps/server/scripts/omp-bridge";

const spec = {
  type: "flowchart",
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
  return [
    { type: "start", messageId: "a" },
    { type: "start-step" },
    ...events,
    { type: "finish-step" },
    { type: "finish" },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

describe("native local diagram stream", () => {
  test("pairs the native spec and render output", async () => {
    const result = await parseDiagramTurn(
      stream(
        { type: "tool-input-available", toolCallId: "a", toolName: "draw_diagram", input: spec },
        { type: "tool-output-available", toolCallId: "a", output },
      ),
    );
    expect(result.diagrams[0]?.spec.title).toBe("Browser to API");
    expect(result.diagrams[0]?.skeletons).toHaveLength(1);
  });

  test("a targeted revision retains unrelated views", async () => {
    const first = await parseDiagramTurn(
      stream(
        { type: "tool-input-available", toolCallId: "a", toolName: "draw_diagram", input: spec },
        { type: "tool-output-available", toolCallId: "a", output },
      ),
    );
    const original = first.diagrams[0]!;
    const second = await parseDiagramTurn(
      stream(
        {
          type: "tool-input-available",
          toolCallId: "b",
          toolName: "draw_diagram",
          input: { ...spec, title: "Revised", targetId: original.id },
        },
        { type: "tool-output-available", toolCallId: "b", output },
      ),
      [original, { ...original, id: "unrelated" }],
    );
    expect(second.diagrams).toHaveLength(2);
    expect(second.diagrams[0]?.id).toBe("unrelated");
    expect(second.diagrams[1]?.spec.title).toBe("Revised");
  });

  test("a clarification is resumable rather than an error or an empty diagram", async () => {
    const result = await parseDiagramTurn(
      stream({
        type: "tool-input-available",
        toolCallId: "question-1",
        toolName: "ask_user",
        input: { question: "Which cloud?", options: ["AWS", "GCP"] },
      }),
    );
    expect(result.diagrams).toHaveLength(0);
    expect(result.question?.question).toBe("Which cloud?");
    const messages = answerQuestion([result.message], result.question!, "AWS");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts.find((part) => part.type === "tool-ask_user")).toMatchObject({
      type: "tool-ask_user",
      state: "output-available",
      output: "AWS",
      toolCallId: "question-1",
    });
  });
});
