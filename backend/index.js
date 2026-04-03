import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
// import speedtest from "speedtest-net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// ── Persistent telnet connection ──────────────────────────────────────

const telnetConn = {
  process: null,
  // disconnected → login → password → ready → lted_cli → arm1log → idle
  stage: "disconnected",
  buffer: "",
  // Queue of { sendFn, onData, resolve, reject, timeoutMs }
  commandQueue: [],
  currentCommand: null,
  reconnectTimer: null,
};

function telnetWrite(command, context) {
  const proc = telnetConn.process;
  if (!proc?.stdin || proc.stdin.destroyed || !proc.stdin.writable) {
    fastify.log.warn(`[${context}] telnet stdin is not writable`);
    return false;
  }
  try {
    fastify.log.info(`[TELNET IN] ${command.trimEnd()}`);
    proc.stdin.write(command);
    return true;
  } catch (error) {
    fastify.log.warn(`[${context}] telnet write failed: ${error.message}`);
    return false;
  }
}

function connect() {
  if (telnetConn.stage !== "disconnected") return;
  telnetConn.stage = "login";
  telnetConn.buffer = "";

  fastify.log.info("Opening telnet connection to 192.168.100.1");
  const proc = spawn("telnet", ["192.168.100.1"]);
  telnetConn.process = proc;

  proc.stdout.on("data", (data) => {
    const text = data.toString();
    fastify.log.info(`[TELNET OUT] ${text.trimEnd()}`);
    onTelnetData(text);
  });

  proc.stderr.on("data", (data) => {
    fastify.log.error(`Telnet stderr: ${data}`);
  });

  proc.stdin.on("error", (error) => {
    fastify.log.warn(`Telnet stdin error: ${error.message}`);
  });

  proc.on("close", (code) => {
    fastify.log.warn(`Telnet connection closed (code ${code})`);
    handleDisconnect();
  });

  proc.on("error", (error) => {
    fastify.log.error(`Telnet process error: ${error.message}`);
    handleDisconnect();
  });
}

function handleDisconnect() {
  if (telnetConn.stage === "shutting_down") return;
  telnetConn.process = null;
  telnetConn.stage = "disconnected";
  telnetConn.buffer = "";

  // Reject in-flight command
  if (telnetConn.currentCommand) {
    telnetConn.currentCommand.reject(
      new Error("Telnet connection lost during command"),
    );
    clearTimeout(telnetConn.currentCommand.timer);
    telnetConn.currentCommand = null;
  }

  // Reject all queued commands
  for (const cmd of telnetConn.commandQueue) {
    cmd.reject(new Error("Telnet connection lost"));
  }
  telnetConn.commandQueue = [];

  // Schedule reconnect
  clearTimeout(telnetConn.reconnectTimer);
  telnetConn.reconnectTimer = setTimeout(() => {
    fastify.log.info("Attempting telnet reconnect...");
    connect();
  }, 5000);
}

function onTelnetData(data) {
  telnetConn.buffer += data;
  const lines = telnetConn.buffer
    .split("\n")
    .filter((line) => line.trim() !== "");
  const line = lines[lines.length - 1] || "";

  // ── Connection setup stages ──

  if (telnetConn.stage === "login" && line.includes("login:")) {
    telnetWrite("root\n", "CONN/login");
    telnetConn.stage = "password";
    telnetConn.buffer = "";
    return;
  }

  if (telnetConn.stage === "password" && line.includes("Password:")) {
    telnetWrite("gct\n", "CONN/password");
    telnetConn.stage = "ready";
    telnetConn.buffer = "";
    return;
  }

  if (
    telnetConn.stage === "ready" &&
    (line.includes("G C T   L T E   M O D E M") || line.includes("#"))
  ) {
    telnetWrite("lted_cli\n", "CONN/ready");
    telnetConn.stage = "lted_cli";
    telnetConn.buffer = "";
    return;
  }

  if (
    telnetConn.stage === "lted_cli" &&
    (line.includes("lted_client_init fail") ||
      line.includes("fail: lted_client_connect_server"))
  ) {
    fastify.log.warn("lted_cli init failed, retrying in 3s...");
    telnetConn.stage = "lted_cli_retry";
    telnetConn.buffer = "";
    setTimeout(() => {
      if (telnetConn.stage === "lted_cli_retry" && telnetConn.process) {
        telnetWrite("lted_cli\n", "CONN/retry_lted_cli");
        telnetConn.stage = "lted_cli";
        telnetConn.buffer = "";
      }
    }, 3000);
    return;
  }

  if (telnetConn.stage === "lted_cli" && line.includes("OK")) {
    telnetWrite("arm1log 2\n", "CONN/lted_cli");
    telnetConn.stage = "arm1log";
    telnetConn.buffer = "";
    return;
  }

  if (telnetConn.stage === "arm1log" && line.includes("OK")) {
    fastify.log.info("Telnet connection ready (idle)");
    telnetConn.stage = "idle";
    telnetConn.buffer = "";
    drainQueue();
    return;
  }

  // ── Pass data to active command handler ──
  if (telnetConn.currentCommand) {
    telnetConn.currentCommand.onData(data, telnetConn.buffer, lines);
  }
}

/** Queue a command to run on the shared telnet connection. */
function enqueueCommand(sendFn, onData, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    telnetConn.commandQueue.push({
      sendFn,
      onData,
      resolve,
      reject,
      timeoutMs,
    });

    if (telnetConn.stage === "idle" && !telnetConn.currentCommand) {
      drainQueue();
    } else if (telnetConn.stage === "disconnected") {
      connect();
    }
  });
}

function drainQueue() {
  if (telnetConn.currentCommand || telnetConn.stage !== "idle") return;

  const entry = telnetConn.commandQueue.shift();
  if (!entry) return;

  telnetConn.buffer = "";

  const originalResolve = entry.resolve;
  const originalReject = entry.reject;

  function finish(fn, val) {
    clearTimeout(entry.timer);
    if (telnetConn.currentCommand === entry) {
      telnetConn.currentCommand = null;
      telnetConn.buffer = "";
      fn(val);
      drainQueue();
    }
  }

  const resolve = (val) => finish(originalResolve, val);
  const reject = (err) => finish(originalReject, err);

  entry.timer = setTimeout(() => {
    finish(originalReject, new Error("Command timed out"));
  }, entry.timeoutMs);

  // Wrap onData so the handler receives resolve/reject
  const userOnData = entry.onData;
  entry.onData = (chunk, fullBuffer, lines) => {
    userOnData(chunk, fullBuffer, lines, resolve, reject);
  };

  telnetConn.currentCommand = entry;
  entry.sendFn();
}

// ── Application state ─────────────────────────────────────────────────

let cachedStatus = {
  selectedBands: [],
  activeBands: [],
  rssi: null,
  rsrp: null,
  cinr: null,
  rsrq: null,
  lastUpdated: null,
  error: null,
};

let speedtestResults = {
  download: null,
  upload: null,
  ping: null,
  timestamp: null,
  isRunning: false,
  error: null,
};

// ── Fastify setup ─────────────────────────────────────────────────────

await fastify.register(cors, { origin: true });

const frontendPath = path.join(__dirname, "../frontend/dist");
await fastify.register(fastifyStatic, { root: frontendPath, prefix: "/" });

fastify.get("/status", async (request, reply) => {
  if (cachedStatus.error) {
    return reply.code(500).send({ error: cachedStatus.error });
  }
  return {
    selectedBands: cachedStatus.selectedBands,
    activeBands: cachedStatus.activeBands,
    rssi: cachedStatus.rssi,
    rsrp: cachedStatus.rsrp,
    cinr: cachedStatus.cinr,
    rsrq: cachedStatus.rsrq,
    lastUpdated: cachedStatus.lastUpdated,
    speedtest: speedtestResults,
  };
});

fastify.post("/save", async (request, reply) => {
  try {
    const { bands } = request.body;
    if (!Array.isArray(bands)) {
      return reply.code(400).send({ error: "bands must be an array" });
    }

    await saveLTEBands(bands);

    fastify.log.info("Save successful, triggering immediate status update");
    setTimeout(() => updateLTEStatus(), 5000);

    return { success: true, bands };
  } catch (error) {
    fastify.log.error(error);
    return reply
      .code(500)
      .send({ error: error.message || "Failed to save LTE bands" });
  }
});

fastify.post("/speedtest", async (request, reply) => {
  if (speedtestResults.isRunning) {
    return reply.code(409).send({ error: "Speedtest already running" });
  }
  runSpeedtest();
  return { success: true, message: "Speedtest started" };
});

fastify.setNotFoundHandler((request, reply) => {
  reply.sendFile("index.html");
});

// ── LTE commands ──────────────────────────────────────────────────────

async function getLTEStatus() {
  let stage = "nvm_bcfgr";
  const d = {
    selectedBands: [],
    activeBands: [],
    rssi: null,
    rsrp: null,
    cinr: null,
    rsrq: null,
  };

  return enqueueCommand(
    () => {
      telnetWrite("nvm bcfgr 49 0\n", "STATUS/nvm_bcfgr");
    },
    (_chunk, _fullBuffer, lines, resolve, _reject) => {
      if (stage === "nvm_bcfgr") {
        const resultLine = lines.find((l) => /([0-9]{1,2} ){10,}/.test(l));
        if (resultLine) {
          d.selectedBands = resultLine
            .split(" ")
            .map((n) => parseInt(n))
            .filter((n) => !isNaN(n) && n !== 0);
          if (d.selectedBands.length > 0) {
            stage = "wait_glte";
          }
        }
      } else {
        lines.forEach((l) => {
          const bandMatch = l.match(/Band ([0-9]+)/);
          const scellBandMatch = l.match(/scellBand ([0-9]+)/);
          if (bandMatch) d.activeBands.push(parseInt(bandMatch[1]));
          if (scellBandMatch) d.activeBands.push(parseInt(scellBandMatch[1]));

          const rssiMatch = l.match(/pccrxmRSSI \(([^)]*)\)/);
          if (rssiMatch) d.rssi = rssiMatch[1];

          const rsrpMatch = l.match(/PrxMrsrp \(([^,]*),/);
          if (rsrpMatch) d.rsrp = rsrpMatch[1];

          const cinrMatch = l.match(/Sinr ([0-9]+)/);
          if (cinrMatch) d.cinr = parseInt(cinrMatch[1]);

          const rsrqMatch = l.match(/Rsrq \(([^,]*),/);
          if (rsrqMatch) d.rsrq = rsrqMatch[1];
        });

        if (d.activeBands.length > 0) {
          resolve({ ...d, activeBands: [...new Set(d.activeBands)] });
        }
      }
    },
    30000,
  );
}

async function saveLTEBands(bands) {
  const bandsString = bands.join(" ");
  let stage = "nvm_bcfgw";

  return enqueueCommand(
    () => {
      telnetWrite(`nvm bcfgw 49 0 ${bandsString}\n`, "SAVE/nvm_bcfgw");
    },
    (_chunk, _fullBuffer, lines, resolve, _reject) => {
      const line = lines[lines.length - 1] || "";

      if (stage === "nvm_bcfgw" && line.includes("OK")) {
        telnetWrite("nvm bcfgsv 1\n", "SAVE/nvm_bcfgsv");
        stage = "nvm_bcfgsv";
        telnetConn.buffer = "";
      } else if (stage === "nvm_bcfgsv" && line.includes("OK")) {
        telnetWrite("shell\n", "SAVE/shell");
        stage = "shell";
        telnetConn.buffer = "";
      } else if (stage === "shell" && line.includes("#")) {
        telnetWrite("reboot\n", "SAVE/reboot");
        // Modem reboots → connection drops → auto-reconnect
        resolve();
      }
    },
    30000,
  );
}

// ── Periodic updates ──────────────────────────────────────────────────

async function updateLTEStatus() {
  try {
    const { selectedBands, activeBands, rssi, rsrp, cinr, rsrq } =
      await getLTEStatus();
    cachedStatus = {
      selectedBands,
      activeBands,
      rssi,
      rsrp,
      cinr,
      rsrq,
      lastUpdated: new Date().toISOString(),
      error: null,
    };
    fastify.log.info(
      `LTE status updated: ${selectedBands.length} selected, ${activeBands.length} active, RSSI: ${rssi}, RSRP: ${rsrp}, CINR: ${cinr}, RSRQ: ${rsrq}`,
    );
  } catch (error) {
    fastify.log.error(`Failed to update LTE status: ${error.message}`);
    cachedStatus.error = error.message;
  }
}

async function runSpeedtest() {}

// ── Start ─────────────────────────────────────────────────────────────

try {
  const port = Number(process.env.PORT) || 3001;
  await fastify.listen({ port, host: "0.0.0.0" });

  // Open persistent telnet connection
  fastify.log.info("Opening persistent telnet connection");
  connect();

  // Clean up telnet on shutdown
  function shutdown() {
    clearTimeout(telnetConn.reconnectTimer);
    telnetConn.reconnectTimer = null;
    if (telnetConn.process) {
      fastify.log.info("Shutting down telnet connection");
      telnetConn.stage = "shutting_down";
      telnetWrite("exit\n", "SHUTDOWN");
      telnetConn.process.on("close", () => {
        telnetConn.process = null;
        process.exit(0);
      });
      // Force kill if it doesn't close within 3s
      setTimeout(() => {
        telnetConn.process?.kill();
        process.exit(0);
      }, 3000);
    } else {
      process.exit(0);
    }
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start periodic status updates (initial delay to let connection establish)
  fastify.log.info("Starting periodic LTE status updates (every 60 seconds)");
  updateLTEStatus();
  setInterval(updateLTEStatus, 60000);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
