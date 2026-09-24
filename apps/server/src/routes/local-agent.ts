import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";

export const localAgentRoute = new Hono();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Only the local deployment opts in. The web client cannot access the private
// directory directly, and every id is an opaque file name rather than a path.
localAgentRoute.get("/:id", async (c) => {
  const dir = process.env.LOCAL_AGENT_DATA_DIR;
  const id = c.req.param("id");
  if (!dir || !uuid.test(id)) return c.notFound();
  try {
    const data = await readFile(join(dir, `${id}.json`), "utf8");
    return c.body(data, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return c.notFound();
    throw error;
  }
});
