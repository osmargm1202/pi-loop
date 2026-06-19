import assert from "node:assert/strict";
import test from "node:test";
import loopExtension, { PI_LOOP_EVENT, parseLoopArgs } from "../extensions/loop.ts";

function createPiStub() {
  const commandHandlers = new Map();
  const eventHandlers = new Map();
  const emitted = [];
  const userMessages = [];

  return {
    commandHandlers,
    eventHandlers,
    emitted,
    userMessages,
    api: {
      setStatus: {},
      events: {
        emit(name, payload) {
          emitted.push({ name, payload });
        },
      },
      on(name, handler) {
        eventHandlers.set(name, handler);
      },
      registerCommand(name, options) {
        commandHandlers.set(name, options);
      },
      sendUserMessage(content, options) {
        userMessages.push({ content, options });
      },
    },
  };
}

test("loop extension registers loop command", async () => {
  const stub = createPiStub();

  assert.doesNotThrow(() => loopExtension(stub.api));
  assert.equal(stub.commandHandlers.has("loop"), true);
  assert.equal(stub.eventHandlers.has("session_start"), true);
  assert.equal(stub.eventHandlers.has("agent_end"), true);
});

test("loop command toggles loop state through emitted events without crashing", async () => {
  const stub = createPiStub();
  loopExtension(stub.api);

  const command = stub.commandHandlers.get("loop");
  assert.ok(command, "expected loop command to be registered");

  const notifications = [];
  const ctx = {
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
    },
  };

  await command.handler("on", ctx);
  await command.handler("status", ctx);
  await command.handler("off", ctx);

  assert.deepEqual(
    stub.emitted.map((entry) => entry.name),
    [PI_LOOP_EVENT, PI_LOOP_EVENT],
  );
  assert.deepEqual(notifications, [
    { message: "Loop mode ON (max 25 iterations)", level: "success" },
    { message: "Loop: ON — iteration 0/25", level: "info" },
    { message: "Loop mode OFF", level: "info" },
  ]);
});

test("parseLoopArgs parses lifecycle commands", () => {
  assert.deepEqual(parseLoopArgs(""), { type: "lifecycle", command: "status" });
  assert.deepEqual(parseLoopArgs("on"), { type: "lifecycle", command: "on" });
  assert.deepEqual(parseLoopArgs("  off  "), { type: "lifecycle", command: "off" });
  assert.deepEqual(parseLoopArgs("status"), { type: "lifecycle", command: "status" });
});

test("parseLoopArgs parses duration values", () => {
  const r1 = parseLoopArgs("30s check logs");
  assert.equal(r1.type, "prompt");
  if (r1.type === "prompt") {
    assert.equal(r1.mode, "duration");
    assert.equal(r1.intervalMs, 30000);
    assert.equal(r1.prompt, "check logs");
  }

  const r2 = parseLoopArgs("2m run tests");
  assert.equal(r2.type, "prompt");
  if (r2.type === "prompt") {
    assert.equal(r2.mode, "duration");
    assert.equal(r2.intervalMs, 120000);
    assert.equal(r2.prompt, "run tests");
  }

  const r3 = parseLoopArgs("1h deploy check");
  assert.equal(r3.type, "prompt");
  if (r3.type === "prompt") {
    assert.equal(r3.mode, "duration");
    assert.equal(r3.intervalMs, 3600000);
    assert.equal(r3.prompt, "deploy check");
  }
});

test("parseLoopArgs parses count values", () => {
  const r = parseLoopArgs("20 verify output");
  assert.equal(r.type, "prompt");
  if (r.type === "prompt") {
    assert.equal(r.mode, "count");
    assert.equal(r.maxChecks, 20);
    assert.equal(r.prompt, "verify output");
  }
});

test("parseLoopArgs rejects missing prompt in duration mode", () => {
  const r = parseLoopArgs("30s");
  assert.equal(r.type, "invalid");
  if (r.type === "invalid") {
    assert.ok(r.error.includes("Missing prompt"));
  }
});

test("parseLoopArgs rejects missing prompt in count mode", () => {
  const r = parseLoopArgs("20");
  assert.equal(r.type, "invalid");
  if (r.type === "invalid") {
    assert.ok(r.error.includes("Missing prompt"));
  }
});

test("parseLoopArgs rejects unrecognized arguments", () => {
  const r = parseLoopArgs("foobar");
  assert.equal(r.type, "invalid");
  if (r.type === "invalid") {
    assert.ok(r.error.includes("Unrecognized loop argument"));
  }
});
