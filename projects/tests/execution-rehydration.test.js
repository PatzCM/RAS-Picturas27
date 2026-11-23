const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

/**
 * Test 1: Authorization (execution-status)
 * Confirms that requests without proper permission (checkSharePermission / caller mismatch)
 * return 403, whereas authorized requests (owner or valid share permission) receive
 * the persisted execution status.
 */
test("authorization on execution-status: unauthorized user is rejected (403) and authorized user receives execution state", async (t) => {
  const projectControllerPath = require.resolve("../controllers/project");
  const executionControllerPath = require.resolve("../controllers/projectExecution");
  const routesPath = require.resolve("../routes/projects");

  const originalProjectController = require.cache[projectControllerPath];
  const originalExecutionController = require.cache[executionControllerPath];
  const originalRoutes = require.cache[routesPath];

  t.after(() => {
    if (originalProjectController) require.cache[projectControllerPath] = originalProjectController;
    else delete require.cache[projectControllerPath];

    if (originalExecutionController) require.cache[executionControllerPath] = originalExecutionController;
    else delete require.cache[executionControllerPath];

    if (originalRoutes) require.cache[routesPath] = originalRoutes;
    else delete require.cache[routesPath];
  });

  const persistedExecution = {
    project_id: "proj-auth",
    user_id: "owner-1",
    state: "running",
    kind: "apply",
    runToken: 2,
    seq: 3,
    totalSteps: 2,
    doneSteps: 1,
    percent: 50,
    error: null,
    items: [
      { imgId: "img-1", state: "completed", percent: 100 },
      { imgId: "img-2", state: "running", percent: 0 },
    ],
  };

  require.cache[projectControllerPath] = {
    id: projectControllerPath,
    filename: projectControllerPath,
    loaded: true,
    exports: {
      getOne: async (user, project) => {
        if (user === "owner-1" && project === "proj-auth") {
          return { _id: "proj-auth", user_id: "owner-1", name: "Auth Test Project" };
        }
        return null;
      },
      getOneByShareId: async (shareId) => {
        if (shareId === "valid-share") {
          return {
            _id: "proj-auth",
            user_id: "owner-1",
            sharedLinks: [{ id: "valid-share", permission: "read", revoked: false }],
          };
        }
        return null;
      },
    },
  };

  require.cache[executionControllerPath] = {
    id: executionControllerPath,
    filename: executionControllerPath,
    loaded: true,
    exports: {
      getOne: async (projectId) => {
        if (projectId === "proj-auth") return persistedExecution;
        return null;
      },
    },
  };

  delete require.cache[routesPath];
  const { router } = require("../routes/projects");

  const app = express();
  app.use(router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Unauthorized caller (not owner, no share link) receives 403
  const unauthorizedRes = await fetch(`${baseUrl}/owner-1/proj-auth/execution-status`, {
    headers: { "x-caller-id": "stranger-99" },
  });
  assert.equal(unauthorizedRes.status, 403);
  const unauthorizedBody = await unauthorizedRes.json();
  assert.equal(unauthorizedBody, "Not allowed");

  // 2. Share request where URL owner does not match the project owner returns 403
  const mismatchRes = await fetch(
    `${baseUrl}/wrong-owner/proj-auth/execution-status?share=valid-share`,
    {
      headers: { authorization: "Bearer some-token" },
    }
  );
  assert.equal(mismatchRes.status, 403);
  const mismatchBody = await mismatchRes.json();
  assert.equal(mismatchBody, "Share link does not match this project owner");

  // 3. Authorized project owner receives 200 and the persisted execution state
  const ownerRes = await fetch(`${baseUrl}/owner-1/proj-auth/execution-status`, {
    headers: { "x-caller-id": "owner-1" },
  });
  assert.equal(ownerRes.status, 200);
  const ownerData = await ownerRes.json();
  assert.equal(ownerData.project_id, "proj-auth");
  assert.equal(ownerData.state, "running");
  assert.equal(ownerData.percent, 50);
  assert.equal(ownerData.runToken, 2);

  // 4. Authorized user via valid share link receives 200 and execution state
  const shareRes = await fetch(
    `${baseUrl}/owner-1/proj-auth/execution-status?share=valid-share`,
    {
      headers: { authorization: "Bearer guest-token" },
    }
  );
  assert.equal(shareRes.status, 200);
  const shareData = await shareRes.json();
  assert.equal(shareData.project_id, "proj-auth");
  assert.equal(shareData.state, "running");
  assert.equal(shareData.percent, 50);
});

/**
 * Test 2: Rehydration after reload (F5)
 * Confirms that querying execution-status returns all persisted progress fields
 * (state, percent, doneSteps, totalSteps, items, runToken, seq, kind) needed by
 * ProcessingProvider and UI components to rebuild the progress bar and status.
 */
test("post-reload (F5) rehydration: execution-status returns persisted progress fields (state, percent, doneSteps, totalSteps, items)", async (t) => {
  const projectControllerPath = require.resolve("../controllers/project");
  const executionControllerPath = require.resolve("../controllers/projectExecution");
  const routesPath = require.resolve("../routes/projects");

  const originalProjectController = require.cache[projectControllerPath];
  const originalExecutionController = require.cache[executionControllerPath];
  const originalRoutes = require.cache[routesPath];

  t.after(() => {
    if (originalProjectController) require.cache[projectControllerPath] = originalProjectController;
    else delete require.cache[projectControllerPath];

    if (originalExecutionController) require.cache[executionControllerPath] = originalExecutionController;
    else delete require.cache[executionControllerPath];

    if (originalRoutes) require.cache[routesPath] = originalRoutes;
    else delete require.cache[routesPath];
  });

  const inProgressExecution = {
    project_id: "proj-reload",
    user_id: "owner-reload",
    state: "running",
    kind: "apply",
    runToken: 7,
    seq: 15,
    totalSteps: 4,
    doneSteps: 2,
    percent: 62,
    error: null,
    items: [
      { imgId: "img-a", state: "completed", percent: 100 },
      { imgId: "img-b", state: "completed", percent: 100 },
      { imgId: "img-c", state: "running", percent: 48 },
      { imgId: "img-d", state: "running", percent: 0 },
    ],
  };

  require.cache[projectControllerPath] = {
    id: projectControllerPath,
    filename: projectControllerPath,
    loaded: true,
    exports: {
      getOne: async (user, project) => {
        if (project === "proj-reload" || project === "proj-idle") {
          return { _id: project, user_id: user, name: "Reload Test Project" };
        }
        return null;
      },
    },
  };

  require.cache[executionControllerPath] = {
    id: executionControllerPath,
    filename: executionControllerPath,
    loaded: true,
    exports: {
      getOne: async (projectId) => {
        if (projectId === "proj-reload") return inProgressExecution;
        if (projectId === "proj-idle") return null;
        return null;
      },
    },
  };

  delete require.cache[routesPath];
  const { router } = require("../routes/projects");

  const app = express();
  app.use(router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Query execution status simulating browser rehydration on reload
  const reloadRes = await fetch(`${baseUrl}/owner-reload/proj-reload/execution-status`, {
    headers: { "x-caller-id": "owner-reload" },
  });
  assert.equal(reloadRes.status, 200);

  const data = await reloadRes.json();

  // Validate all key progress attributes required for UI progress bar reconstruction
  assert.equal(data.state, "running");
  assert.equal(data.percent, 62);
  assert.equal(data.doneSteps, 2);
  assert.equal(data.totalSteps, 4);
  assert.equal(data.runToken, 7);
  assert.equal(data.seq, 15);
  assert.equal(data.kind, "apply");

  assert.ok(Array.isArray(data.items));
  assert.equal(data.items.length, 4);
  assert.deepEqual(data.items[0], { imgId: "img-a", state: "completed", percent: 100 });
  assert.deepEqual(data.items[1], { imgId: "img-b", state: "completed", percent: 100 });
  assert.deepEqual(data.items[2], { imgId: "img-c", state: "running", percent: 48 });
  assert.deepEqual(data.items[3], { imgId: "img-d", state: "running", percent: 0 });

  // When no execution exists yet, defaults to idle schema
  const idleRes = await fetch(`${baseUrl}/owner-reload/proj-idle/execution-status`, {
    headers: { "x-caller-id": "owner-reload" },
  });
  assert.equal(idleRes.status, 200);
  const idleData = await idleRes.json();
  assert.equal(idleData.state, "idle");
  assert.equal(idleData.percent, 0);
  assert.equal(idleData.doneSteps, 0);
  assert.equal(idleData.totalSteps, 0);
  assert.deepEqual(idleData.items, []);
});

/**
 * Test 3: Cancellation and state protection
 * Confirms that once an execution is cancelled (state === "cancelled"),
 * late progress updates from background workers do NOT revert the state to "running",
 * and verifies execution re-initialization behavior on the backend controller.
 */
test("cancellation and state protection: late progress updates do not revert cancelled state to running", async (t) => {
  const modelPath = require.resolve("../models/projectExecution");
  const msgPath = require.resolve("../utils/project_msg");
  const controllerPath = require.resolve("../controllers/projectExecution");

  const originalModel = require.cache[modelPath];
  const originalMsg = require.cache[msgPath];
  const originalController = require.cache[controllerPath];

  t.after(() => {
    if (originalModel) require.cache[modelPath] = originalModel;
    else delete require.cache[modelPath];

    if (originalMsg) require.cache[msgPath] = originalMsg;
    else delete require.cache[msgPath];

    if (originalController) require.cache[controllerPath] = originalController;
    else delete require.cache[controllerPath];
  });

  let store = {};
  const wsPublished = [];

  require.cache[msgPath] = {
    id: msgPath,
    filename: msgPath,
    loaded: true,
    exports: {
      send_msg_execution_update(execution) {
        const doc = execution && execution.toObject ? execution.toObject() : execution;
        wsPublished.push(doc);
      },
    },
  };

  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: {
      findOne(filter) {
        return {
          exec: async () => {
            const pid = filter.project_id || filter.$or?.[0]?.project_id;
            return store[String(pid)] ? { ...store[String(pid)] } : null;
          },
        };
      },
      findOneAndUpdate(filter, update, options) {
        return {
          exec: async () => {
            const pid = filter.project_id || filter.$or?.[0]?.project_id;
            const current = store[String(pid)] || {};
            const updated = { ...current, ...(update.$set || update) };
            store[String(pid)] = updated;
            return { ...updated };
          },
        };
      },
    },
  };

  delete require.cache[controllerPath];
  const ProjectExecutionController = require("../controllers/projectExecution");

  // 1. Initialize an active execution
  const init = await ProjectExecutionController.initExecution({
    projectId: "proj-cancel-protect",
    userId: "user-test",
    kind: "apply",
    runToken: 1,
    imgs: [{ _id: "img-1" }, { _id: "img-2" }],
  });
  assert.equal(init.state, "running");
  assert.equal(init.percent, 0);

  // 2. Report partial progress on first image
  const progress1 = await ProjectExecutionController.updateProgress({
    projectId: "proj-cancel-protect",
    imgId: "img-1",
    percent: 60,
    status: "running",
  });
  assert.equal(progress1.state, "running");
  assert.equal(progress1.percent, 30); // (60 + 0) / 2

  // 3. User cancels the execution
  const cancelled = await ProjectExecutionController.cancelExecution({
    projectId: "proj-cancel-protect",
    userId: "user-test",
    runToken: 2,
  });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.runToken, 2);
  assert.ok(cancelled.finishedAt);
  assert.equal(cancelled.items.find((i) => String(i.imgId) === "img-1").state, "cancelled");
  assert.equal(cancelled.items.find((i) => String(i.imgId) === "img-2").state, "cancelled");

  const wsMessagesBeforeLateUpdate = wsPublished.length;

  // 4. Late worker progress arrives after cancellation
  const lateProgress = await ProjectExecutionController.updateProgress({
    projectId: "proj-cancel-protect",
    imgId: "img-2",
    percent: 100,
    status: "completed",
  });

  // 5. Verify late updates are ignored and do NOT revert state to "running"
  assert.equal(lateProgress.state, "cancelled");
  const persistedState = await ProjectExecutionController.getOne("proj-cancel-protect");
  assert.equal(persistedState.state, "cancelled");
  assert.notEqual(persistedState.state, "running");
  // No new execution update published to ws_queue for the ignored late progress
  assert.equal(wsPublished.length, wsMessagesBeforeLateUpdate);

  // 6. Verify backend re-initialization:
  // Unlike the frontend which prevents new apply clicks while isProcessing is true,
  // when a fresh apply is dispatched to the backend, it initiates a new run with bumped runToken/seq
  const reinitiated = await ProjectExecutionController.initExecution({
    projectId: "proj-cancel-protect",
    userId: "user-test",
    kind: "apply",
    runToken: 3,
    imgs: [{ _id: "img-1" }],
  });
  assert.equal(reinitiated.state, "running");
  assert.equal(reinitiated.runToken, 3);
  assert.equal(reinitiated.seq, cancelled.seq + 1);
});
