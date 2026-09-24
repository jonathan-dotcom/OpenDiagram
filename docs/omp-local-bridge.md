# Local OMP diagram bridge

This fork adds a local, file-backed path from OMP to OpenDiagram. OMP can create and revise diagrams through the existing AI endpoint, open the result in the Excalidraw editor, and download an editable `.excalidraw` file without clicking through the dashboard.

## Use it

From the repository root, with the local API and web services running:

```bash
bun scripts/omp-diagram.ts create 'Browser calls API; API reads PostgreSQL. Draw three nodes and two arrows.'
bun scripts/omp-diagram.ts revise <id> 'Add a cache between API and PostgreSQL.'
bun scripts/omp-diagram.ts open <id>
bun scripts/omp-diagram.ts export <id> /path/to/diagram.opendiagram.json
bun test scripts/omp-diagram.test.ts
```

For a confidential or multiline prompt, use `create -` or `revise <id> -` and send the prompt on standard input rather than placing it in a command argument. Creation and revision print JSON containing the diagram id, summary, editor URL, and download URL. Open the editor URL using OMP Browser Relay, then inspect the rendered canvas. Open the download URL in that browser to save an editable `.excalidraw` file in its Downloads directory. The JSON export is the semantic spec plus render plan, not an Excalidraw file.

The bridge stores records in `data/agent/` by default. That directory is gitignored. The server reads it only when `LOCAL_AGENT_DATA_DIR` points to it; otherwise `/api/local-agent/:id` returns 404. Set the variable on a loopback-only server. Diagram ids must be UUIDs, and a revision is saved only if the model returns a completed draw for the existing id. The CLI rejects non-local API endpoints.

Opening a record for the first time creates a guest draft in that browser. Opening it again creates a **new** draft so edits made in the browser are not silently overwritten by a CLI revision. Those browser edits do not flow back into the CLI record. Guest drafts belong to the browser profile; use the same profile when returning to one. This fork keeps the rest of the upstream application intact rather than removing its authentication, billing, or project code.
