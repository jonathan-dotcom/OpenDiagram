"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { env } from "@OpenDiagram/env/web";
import { renderAgentElements } from "@/lib/excalidraw-utils";
import {
  createGuestProjectDraft,
  getGuestProjectDraft,
  saveGuestProjectDraft,
} from "@/lib/guest-drafts";

type AgentRecord = {
  id: string;
  revision: number;
  spec: { title: string };
  skeletons: never[];
  rawElements: unknown[];
};

export default function AgentDiagramPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [message, setMessage] = useState("Loading local diagram...");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/local-agent/${id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Diagram unavailable (${response.status})`);
      const record = (await response.json()) as AgentRecord;
      if (
        record.id !== id ||
        !Array.isArray(record.skeletons) ||
        !Array.isArray(record.rawElements)
      ) {
        throw new Error("Invalid local diagram");
      }
      const elements = await renderAgentElements(record.skeletons, record.rawElements);
      if (cancelled) return;
      if (new URLSearchParams(window.location.search).get("download") === "excalidraw") {
        const data = {
          type: "excalidraw",
          version: 2,
          source: "OpenDiagram local",
          elements,
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        };
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data)], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `${record.spec.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "diagram"}.excalidraw`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setMessage(
          `Downloaded ${link.download}. You can open this diagram in the editor using the link below.`,
        );
        return;
      }
      const draft = createGuestProjectDraft(record.spec.title, record.spec.title);
      // A prior browser edit is not the CLI's source of truth. Reopening an
      // updated CLI record creates a new draft rather than erasing those edits.
      if (!(await getGuestProjectDraft(record.id))) draft.id = record.id;
      draft.files[0]!.scene = { elements };
      draft.files[0]!.spec = record.spec;
      saveGuestProjectDraft(draft);
      router.replace(`/project/${draft.id}/workspace/${draft.files[0]!.id}`);
    })().catch((error: unknown) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not open diagram");
    });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <main className="m-8">
      <p>{message}</p>
      <a href={`/agent/${id}`}>Open in editor</a>
    </main>
  );
}
