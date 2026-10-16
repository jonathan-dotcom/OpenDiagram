# Local OMP diagram bridge

The bridge transports OMP requests through OpenDiagram's native chat endpoint. The upstream agent chooses tools, plans views, validates specs, lays out diagrams, and renders them. The bridge does not choose coordinates or replace the system prompt, layout engine, or renderer.

## Use it

Run these commands from the repository root while the API and web services are running:

```bash
bun scripts/omp-diagram.ts create -
bun scripts/omp-diagram.ts revise <id> -
bun scripts/omp-diagram.ts answer <id> -
bun scripts/omp-diagram.ts open <id>
bun scripts/omp-diagram.ts export <id> /path/to/diagram.opendiagram.json
bun test scripts/omp-diagram.test.ts scripts/omp-diagram-native.test.ts
```

Send the brief or answer on standard input. Describe components, relationships, intent, and constraints. Do not supply hand-authored element coordinates or force an architecture into one diagram. The native agent selects `draw_system` for architecture and `draw_diagram` for standalone flowcharts, ERDs, BPMN, and sequences. A system can produce an overview and several flow views; the bridge retains all of them.

Creation, revision, and answers print JSON with `id`, `revision`, `status`, `views`, `open`, and `download`. When `status` is `needs_input`, present `question.question` and `question.options`, then use `answer` with the response. This resumes the native `ask_user` tool in the same conversation. Do not retry creation or invent an answer. Revisions retain the native message history and send the most recent eight diagram specs, matching the web client.

Open `open` using OMP Browser Relay and inspect the rendered canvas. The import page uses the actual native Whiteboard and `applyDiagramToCanvas` for every view. It transfers diagram metadata and chat history into a guest draft so the native editor can continue the conversation. The `download` URL uses Excalidraw's serializer to export the complete canvas as an editable `.excalidraw` file. Verify the real download before claiming export. The CLI JSON export contains semantic specs, render plans, and conversation data; it is not an Excalidraw file.

## Persistence boundary

Records and prompts stay in gitignored `data/agent/`. The API serves them only when `LOCAL_AGENT_DATA_DIR` is configured. Keep the API on loopback; the CLI rejects non-local endpoints. Existing single-diagram records remain readable.

Opening an existing record creates a new guest draft when one already exists, rather than overwriting browser edits. Browser edits do not synchronize back to the CLI record. After making browser edits, continue in that native workspace, or explicitly reopen the CLI branch as a separate draft. Use the same browser profile to retain guest drafts.

## Local scene storage

Current upstream stores signed-in canvas scenes in an S3-compatible object store, not PostgreSQL. `compose.local-storage.yml` runs RustFS on `127.0.0.1:19000` using the persistent `opendiagram_local_s3data` Docker volume and private credentials from gitignored `.env.storage.local`. The API's private `apps/server/.env` contains matching `S3_*` settings. The bucket is `opendiagram-scenes`; browser read CORS permits only the local web origins. Do not commit either environment file.

Start storage with `docker compose -f compose.local-storage.yml up -d`. The compose service uses Docker's existing bridge, avoiding allocation of another private subnet. Guest drafts still use the upstream browser-local IndexedDB store. Before applying database migrations to an older installation, back up PostgreSQL and migrate any existing scene data to object storage before the upstream migration drops the old scene column.
