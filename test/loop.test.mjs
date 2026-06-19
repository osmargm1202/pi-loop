import assert from "node:assert/strict";
import test from "node:test";
import loopExtension, { PI_LOOP_EVENT } from "../extensions/loop.ts";

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

test("loop extension registers without calling unsupported ExtensionAPI status methods", async () => {
  const stub = createPiStub();

  assert.doesNotThrow(() => loopExtension(stub.api));
  assert.equal(stub.commandHandlers.has("orgm-loop"), true);
  assert.equal(stub.eventHandlers.has("session_start"), true);
  assert.equal(stub.eventHandlers.has("agent_end"), true);
});

test("orgm-loop command toggles loop state through emitted events without crashing", async () => {
  const stub = createPiStub();
  loopExtension(stub.api);

  const command = stub.commandHandlers.get("orgm-loop");
  assert.ok(command, "expected orgm-loop command to be registered");

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
