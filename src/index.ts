import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateRequest } from "./auth.js";
import { registerTools } from "./tools.js";

const PORT = parseInt(
  process.env.PORT || process.env.MCP_SERVER_PORT || "3000",
  10
);

const app = express();
app.use(express.json());

// Health check endpoint (Railway uses this)
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// MCP endpoint — POST only (stateless mode)
app.post("/mcp", async (req: Request, res: Response) => {
  // Authenticate
  const apiKey = await authenticateRequest(req.headers.authorization);
  if (!apiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Create a fresh MCP server and transport per request (stateless mode)
  const server = new McpServer({
    name: "second-brain",
    version: "1.0.0",
  });

  registerTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// GET and DELETE not supported in stateless mode
app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({ error: "Method not allowed in stateless mode" });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({ error: "Method not allowed in stateless mode" });
});

app.listen(PORT, () => {
  console.log(`Second Brain MCP server listening on port ${PORT}`);
});
