"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import type { DiagramSpec, RenderSkeleton } from "@OpenDiagram/harness";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { env } from "@OpenDiagram/env/web";
import { Whiteboard } from "@/components/whiteboard/Whiteboard";
import { sanitizeSceneAppState } from "@/components/whiteboard/workspace-layout/helpers";
import { applyDiagramToCanvas } from "@/lib/excalidraw-utils";
import { serializeCanvasDiagrams, type CanvasDiagram } from "@/lib/canvas-diagrams";
import { uiMessagesToStoredChatHistory } from "@/lib/chat-history";
import {
  createGuestProjectDraft,
  getGuestProjectDraft,
  saveGuestProjectDraft,
} from "@/lib/guest-drafts";

type AgentView = { spec: DiagramSpec; skeletons: RenderSkeleton[]; rawElements: unknown[] };
type AgentRecord = {
  id: string;
  diagrams?: AgentView[];
  messages?: UIMessage[];
  spec?: DiagramSpec;
  skeletons?: RenderSkeleton[];
  rawElements?: unknown[];
};

export default function AgentDiagramPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [api, setAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [message, setMessage] = useState("Loading local diagram...");

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/local-agent/${id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Diagram unavailable (${response.status})`);
      const record = (await response.json()) as AgentRecord;
      if (record.id !== id) throw new Error("Invalid local diagram");
      const views =
        record.diagrams ??
        (record.spec && record.skeletons && record.rawElements
          ? [{ spec: record.spec, skeletons: record.skeletons, rawElements: record.rawElements }]
          : []);
      const diagrams: CanvasDiagram[] = [];
      // The actual canvas uses upstream placement, font loading and element restoration.
      for (const view of views) {
        if (cancelled) return;
        const { frameId } = await applyDiagramToCanvas(api, view.skeletons, view.rawElements);
        if (frameId) diagrams.push({ id: frameId, title: view.spec.title, spec: view.spec });
      }
      if (cancelled) return;
      const title = views[0]?.spec.title ?? "OpenDiagram conversation";
      const scene = {
        elements: api.getSceneElements(),
        appState: sanitizeSceneAppState(api.getAppState()),
        files: api.getFiles(),
      };
      if (new URLSearchParams(window.location.search).get("download") === "excalidraw") {
        const { serializeAsJSON } = await import("@excalidraw/excalidraw");
        const data = serializeAsJSON(scene.elements, api.getAppState(), scene.files, "local");
        const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "diagram"}.excalidraw`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage(`Downloaded ${link.download}.`);
        return;
      }
      const history = uiMessagesToStoredChatHistory(record.messages ?? []);
      const draft = createGuestProjectDraft(title, title, "diagram", undefined, history);
      // Never replace a draft containing browser edits with a CLI revision.
      if (!(await getGuestProjectDraft(record.id))) draft.id = record.id;
      draft.files[0]!.scene = scene;
      draft.files[0]!.spec = serializeCanvasDiagrams(diagrams);
      saveGuestProjectDraft(draft);
      router.replace(`/project/${draft.id}/workspace/${draft.files[0]!.id}`);
    })().catch((error: unknown) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not open diagram");
    });
    return () => {
      cancelled = true;
    };
  }, [id, router, api]);

  return (
    <main className="flex h-screen flex-col">
      <div className="p-4">
        <p>{message}</p>
        <a href={`/agent/${id}`}>Open in editor</a>
      </div>
      <div className="min-h-0 flex-1">
        <Whiteboard onAPIReady={setAPI} />
      </div>
    </main>
  );
}
