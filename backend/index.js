import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// Store latest LTE status
let cachedStatus = {
  selectedBands: [],
  activeBands: [],
  lastUpdated: null,
  error: null,
};

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
  if (cachedStatus.error) {
    return reply.code(500).send({ error: cachedStatus.error });
  }

  return {
    selectedBands: cachedStatus.selectedBands,
    activeBands: cachedStatus.activeBands,
    lastUpdated: cachedStatus.lastUpdated,
  };
});

async function getLTEStatus() {
  return new Promise((resolve, reject) => {
    const telnet = spawn("telnet", ["192.168.100.1"]);

    let buffer = "";
    let selectedBands = [];
    let activeBands = [];
    let stage = "login";

    const processOutput = (data) => {
      buffer += data;
      const lines = buffer.split("\n").filter((line) => line.trim() !== "");

      const line = lines[lines.length - 1];

      fastify.log.info(`[STATUS][${stage}] ${line}`);

      if (stage === "login" && line.includes("login:")) {
        telnet.stdin.write("root\n");
        stage = "password";
      } else if (stage === "password" && line.includes("Password:")) {
        telnet.stdin.write("gct\n");
        stage = "ready";
      } else if (
        stage === "ready" &&
        line.includes("G C T   L T E   M O D E M")
      ) {
        telnet.stdin.write("lted_cli\n");
        stage = "lted_cli";
      } else if (
        stage === "lted_cli" &&
        line.includes("lted_client_init fail")
      ) {
        reject(new Error("Failed to initialize lted_cli"));
      } else if (stage === "lted_cli" && line.includes("OK")) {
        telnet.stdin.write("arm1log 2\n");
        stage = "arm1log";
      } else if (stage === "arm1log" && line.includes("OK")) {
        telnet.stdin.write("nvm bcfgr 49 0\n");
        stage = "nvm_bcfgr";
      } else if (stage === "nvm_bcfgr") {
        const resultLine = lines.find((line) =>
          /([0-9]{1,2} ){10,}/.test(line)
        );

        if (resultLine) {
          const bands = resultLine
            .split(" ")
            .map((num) => parseInt(num))
            .filter((num) => !isNaN(num))
            .filter((number) => number !== 0);

          if (bands.length > 0) {
            selectedBands = bands;
            stage = "wait_glte";
          }
        }
      } else if (
        stage === "wait_glte" &&
        lines.some((line) => line.includes("%GLTECONNSTATUS:"))
      ) {
        stage = "parse_active";
      } else if (stage === "parse_active") {
        lines.forEach((line) => {
          // Extract active bands
          const bandMatch = line.match(/Band ([0-9]+)/);
          const scellBandMatch = line.match(/scellBand ([0-9]+)/);

          if (bandMatch) {
            activeBands.push(parseInt(bandMatch[1]));
          }
          if (scellBandMatch) {
            activeBands.push(parseInt(scellBandMatch[1]));
          }
        });

        // If we found at least one band, we can complete
        if (activeBands.length > 0) {
          telnet.stdin.write("exit\n");
          telnet.kill();
          resolve({ selectedBands, activeBands: [...new Set(activeBands)] });
        }
      }
    };

    telnet.stdout.on("data", (data) => {
      processOutput(data.toString());
    });

    telnet.stderr.on("data", (data) => {
      fastify.log.error(`Telnet error: ${data}`);
    });

    telnet.on("close", (code) => {
      if (stage === "parse_active" && activeBands.length === 0) {
        // Sometimes we might not get active bands if not connected
        resolve({ selectedBands, activeBands: [] });
      } else if (selectedBands.length === 0) {
        reject(new Error("Failed to retrieve LTE status"));
      }
    });

    telnet.on("error", (error) => {
      reject(error);
    });

    // Set a timeout of 30 seconds
    setTimeout(() => {
      telnet.kill();
      if (selectedBands.length > 0) {
        resolve({ selectedBands, activeBands });
      } else {
        reject(new Error("Timeout waiting for LTE status"));
      }
    }, 30000);
  });
}

// Save endpoint
fastify.post("/save", async (request, reply) => {
  try {
    const { bands } = request.body;

    if (!Array.isArray(bands)) {
      return reply.code(400).send({ error: "bands must be an array" });
    }

    await saveLTEBands(bands);
    return { success: true, bands };
  } catch (error) {
    fastify.log.error(error);
    return reply
      .code(500)
      .send({ error: error.message || "Failed to save LTE bands" });
  }
});

async function saveLTEBands(bands) {
  return new Promise((resolve, reject) => {
    const telnet = spawn("telnet", ["192.168.100.1"]);

    let buffer = "";
    let stage = "login";

    const processOutput = (data) => {
      buffer += data;
      const lines = buffer.split("\n").filter((line) => line.trim() !== "");

      const line = lines[lines.length - 1];

      fastify.log.info(`[SAVE][${stage}] ${line}`);

      if (stage === "login" && line.includes("login:")) {
        telnet.stdin.write("root\n");
        stage = "password";
      } else if (stage === "password" && line.includes("Password:")) {
        telnet.stdin.write("gct\n");
        stage = "ready";
      } else if (
        stage === "ready" &&
        line.includes("G C T   L T E   M O D E M")
      ) {
        telnet.stdin.write("lted_cli\n");
        stage = "lted_cli";
      } else if (
        stage === "lted_cli" &&
        line.includes("lted_client_init fail")
      ) {
        telnet.kill();
        reject(new Error("Failed to initialize lted_cli"));
      } else if (stage === "lted_cli" && line.includes("OK")) {
        telnet.stdin.write("arm1log 2\n");
        stage = "arm1log";
      } else if (stage === "arm1log" && line.includes("OK")) {
        const bandsString = bands.join(" ");
        telnet.stdin.write(`nvm bcfgw 49 0 ${bandsString}\n`);
        stage = "nvm_bcfgw";
      } else if (stage === "nvm_bcfgw" && line.includes("OK")) {
        telnet.stdin.write("nvm bcfgsv 1\n");
        stage = "nvm_bcfgsv";
      } else if (stage === "nvm_bcfgsv" && line.includes("OK")) {
        telnet.stdin.write("shell\n");
        stage = "shell";
      } else if (stage === "shell" && line.includes("#")) {
        telnet.stdin.write("reboot\n");
        stage = "reboot";
        // Give it a moment to send the reboot command
        setTimeout(() => {
          telnet.kill();
          resolve();
        }, 1000);
      }
    };

    telnet.stdout.on("data", (data) => {
      processOutput(data.toString());
    });

    telnet.stderr.on("data", (data) => {
      fastify.log.error(`Telnet error: ${data}`);
    });

    telnet.on("error", (error) => {
      reject(error);
    });

    // Set a timeout of 30 seconds
    setTimeout(() => {
      telnet.kill();
      reject(new Error("Timeout while saving LTE bands"));
    }, 30000);
  });
}

// Serve index.html for all other routes (SPA fallback)
fastify.setNotFoundHandler((request, reply) => {
  reply.sendFile("index.html");
});

// Function to periodically update LTE status
async function updateLTEStatus() {
  try {
    const { selectedBands, activeBands } = await getLTEStatus();
    cachedStatus = {
      selectedBands,
      activeBands,
      lastUpdated: new Date().toISOString(),
      error: null,
    };
    fastify.log.info(
      `LTE status updated: ${selectedBands.length} selected, ${activeBands.length} active`
    );
  } catch (error) {
    fastify.log.error(`Failed to update LTE status: ${error.message}`);
    cachedStatus.error = error.message;
  }
}

// Start server
try {
  await fastify.listen({ port: 3001, host: "0.0.0.0" });

  // Start periodic status updates
  fastify.log.info("Starting periodic LTE status updates (every 30 seconds)");
  updateLTEStatus(); // Initial fetch
  setInterval(updateLTEStatus, 30000); // Every 30 seconds
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
