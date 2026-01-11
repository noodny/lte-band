import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// Enable CORS for frontend communication
await fastify.register(cors, {
  origin: true,
});

// Serve static files from frontend build
const frontendPath = path.join(__dirname, "../frontend/dist");
await fastify.register(fastifyStatic, {
  root: frontendPath,
  prefix: "/",
});

// Status endpoint
fastify.get("/status", async (request, reply) => {
  // TODO: Implement status logic
  return { status: "ok" };
});

// Save endpoint
fastify.post("/save", async (request, reply) => {
  // TODO: Implement save logic
  const data = request.body;
  return { success: true, received: data };
});

// Serve index.html for all other routes (SPA fallback)
fastify.setNotFoundHandler((request, reply) => {
  reply.sendFile("index.html");
});

// Start server
try {
  await fastify.listen({ port: 3001, host: "0.0.0.0" });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
