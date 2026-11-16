const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

// Mock mongoose if not installed in host environment
class Schema {
  constructor(paths, options) {
    this.paths = paths;
    this.options = options;
  }
  index() {}
}
Schema.Types = {
  Mixed: "Mixed",
  ObjectId: "ObjectId",
};

const models = {};
const mongooseMock = {
  Schema,
  models,
  model(name, schema) {
    if (!models[name]) {
      const Model = function (doc) {
        Object.assign(this, doc);
        this.save = async function () { return this; };
        this.toObject = function () { return { ...this }; };
      };
      Model.schema = schema;
      models[name] = Model;
    }
    return models[name];
  },
  Types: {
    ObjectId: {
      isValid(id) {
        return typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
      },
    },
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "mongoose") return mongooseMock;
  return originalRequire.apply(this, arguments);
};

test("ProjectExecution schema structure and defaults", () => {
  const ProjectExecution = require("../models/projectExecution");
  assert.ok(ProjectExecution.schema, "ProjectExecution should have a schema");
  
  const paths = ProjectExecution.schema.paths;
  assert.ok(paths.project_id, "project_id path exists");
  assert.ok(paths.user_id, "user_id path exists");
  assert.ok(paths.state, "state path exists");
  assert.ok(paths.kind, "kind path exists");
  assert.ok(paths.runToken, "runToken path exists");
  assert.ok(paths.seq, "seq path exists");
  assert.ok(paths.startedAt, "startedAt path exists");
  assert.ok(paths.finishedAt, "finishedAt path exists");
  assert.ok(paths.totalSteps, "totalSteps path exists");
  assert.ok(paths.doneSteps, "doneSteps path exists");
  assert.ok(paths.percent, "percent path exists");
  assert.ok(paths.error, "error path exists");
  assert.ok(paths.items, "items path exists");

  assert.deepEqual(paths.state.enum, ["idle", "running", "completed", "failed", "cancelled"]);
  assert.deepEqual(paths.kind.enum, ["apply", "preview", null]);
});

test("ProjectExecutionController lifecycle: init, progress, cancel, complete", async () => {
  const modelPath = require.resolve("../models/projectExecution");
  const msgPath = require.resolve("../utils/project_msg");
  const controllerPath = require.resolve("../controllers/projectExecution");

  const originalModel = require.cache[modelPath];
  const originalMsg = require.cache[msgPath];
  const originalController = require.cache[controllerPath];

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
  try {
    const ProjectExecutionController = require("../controllers/projectExecution");

    // 1. Initial status query when empty
    const nonExistent = await ProjectExecutionController.getOne("proj-1");
    assert.equal(nonExistent, null);

    // 2. Start apply execution
    const imgs = [{ _id: "img-1" }, { _id: "img-2" }];
    const initApply = await ProjectExecutionController.initExecution({
      projectId: "proj-1",
      userId: "user-1",
      kind: "apply",
      runToken: 1,
      imgs: imgs,
    });

    assert.equal(initApply.project_id, "proj-1");
    assert.equal(initApply.user_id, "user-1");
    assert.equal(initApply.state, "running");
    assert.equal(initApply.kind, "apply");
    assert.equal(initApply.runToken, 1);
    assert.equal(initApply.seq, 1);
    assert.equal(initApply.totalSteps, 2);
    assert.equal(initApply.doneSteps, 0);
    assert.equal(initApply.percent, 0);
    assert.equal(initApply.items.length, 2);
    assert.equal(wsPublished.length, 1);
    assert.equal(wsPublished[0].seq, 1);
    assert.equal(wsPublished[0].runToken, 1);

    // 3. Update progress for img-1 to 50%
    const progress1 = await ProjectExecutionController.updateProgress({
      projectId: "proj-1",
      imgId: "img-1",
      percent: 50,
      status: "running",
    });

    assert.equal(progress1.seq, 2);
    assert.equal(progress1.percent, 25); // (50 + 0) / 2
    assert.equal(progress1.items.find(i => String(i.imgId) === "img-1").percent, 50);

    // 4. Update progress for img-1 to 100% (completed)
    const progress2 = await ProjectExecutionController.updateProgress({
      projectId: "proj-1",
      imgId: "img-1",
      percent: 100,
      status: "completed",
    });

    assert.equal(progress2.seq, 3);
    assert.equal(progress2.doneSteps, 1);
    assert.equal(progress2.percent, 50); // (100 + 0) / 2
    assert.equal(progress2.state, "running");

    // 5. Update progress for img-2 to 100% (completed)
    const progress3 = await ProjectExecutionController.updateProgress({
      projectId: "proj-1",
      imgId: "img-2",
      percent: 100,
      status: "completed",
    });

    assert.equal(progress3.seq, 4);
    assert.equal(progress3.doneSteps, 2);
    assert.equal(progress3.percent, 100);
    assert.equal(progress3.state, "completed");
    assert.ok(progress3.finishedAt);

    // 6. Start new preview execution (seq should increment from 4 to 5)
    const initPreview = await ProjectExecutionController.initExecution({
      projectId: "proj-1",
      userId: "user-1",
      kind: "preview",
      runToken: 2,
      previewImgId: "img-1",
    });

    assert.equal(initPreview.kind, "preview");
    assert.equal(initPreview.runToken, 2);
    assert.equal(initPreview.seq, 5);
    assert.equal(initPreview.totalSteps, 1);
    assert.equal(initPreview.state, "running");

    // 7. Cancel execution
    const cancelled = await ProjectExecutionController.cancelExecution({
      projectId: "proj-1",
      userId: "user-1",
      runToken: 3,
    });

    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.runToken, 3);
    assert.equal(cancelled.seq, 6);
    assert.ok(cancelled.finishedAt);
    assert.equal(cancelled.items[0].state, "cancelled");

    // Check wsPublished has seq and runToken for every update
    assert.equal(wsPublished.length, 6);
    for (const msg of wsPublished) {
      assert.ok(typeof msg.seq === "number");
      assert.ok(typeof msg.runToken === "number");
    }
  } finally {
    if (originalModel) require.cache[modelPath] = originalModel; else delete require.cache[modelPath];
    if (originalMsg) require.cache[msgPath] = originalMsg; else delete require.cache[msgPath];
    if (originalController) require.cache[controllerPath] = originalController; else delete require.cache[controllerPath];
  }
});

test("projects_execution_queue message updates ProjectExecution and publishes to ws_queue", async () => {
  const modelPath = require.resolve("../models/projectExecution");
  const msgPath = require.resolve("../utils/project_msg");
  const controllerPath = require.resolve("../controllers/projectExecution");

  const originalModel = require.cache[modelPath];
  const originalMsg = require.cache[msgPath];
  const originalController = require.cache[controllerPath];

  let store = {
    "proj-10": {
      project_id: "proj-10",
      user_id: "user-10",
      state: "running",
      kind: "apply",
      runToken: 4,
      seq: 1,
      totalSteps: 2,
      doneSteps: 0,
      percent: 0,
      items: [
        { imgId: "v1", state: "running", percent: 0 },
        { imgId: "v2", state: "running", percent: 0 },
      ],
    },
  };

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
      read_execution_msg(callback) {
        callback({
          content: Buffer.from(
            JSON.stringify({
              projectId: "proj-10",
              imgId: "v1",
              percent: 60,
              status: "running",
            })
          ),
        });
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

  try {
    const ProjectExecutionController = require("../controllers/projectExecution");
    const { read_execution_msg } = require("../utils/project_msg");

    read_execution_msg(async (msg) => {
      const content = JSON.parse(msg.content.toString());
      await ProjectExecutionController.updateProgress({
        projectId: content.projectId,
        imgId: content.imgId,
        percent: content.percent,
        status: content.status,
      });
    });

    await new Promise((r) => setTimeout(r, 10));

    const updated = await ProjectExecutionController.getOne("proj-10");
    assert.equal(updated.seq, 2);
    assert.equal(updated.percent, 30); // (60 + 0) / 2
    assert.equal(updated.runToken, 4);

    assert.equal(wsPublished.length, 1);
    assert.equal(wsPublished[0].project_id, "proj-10");
    assert.equal(wsPublished[0].percent, 30);
    assert.equal(wsPublished[0].seq, 2);
    assert.equal(wsPublished[0].runToken, 4);
  } finally {
    if (originalModel) require.cache[modelPath] = originalModel; else delete require.cache[modelPath];
    if (originalMsg) require.cache[msgPath] = originalMsg; else delete require.cache[msgPath];
    if (originalController) require.cache[controllerPath] = originalController; else delete require.cache[controllerPath];
  }
});

test("send_msg_execution_update sends expected payload to ws_queue", () => {
  const rabbitPath = require.resolve("../utils/rabbit_mq");
  const msgPath = require.resolve("../utils/project_msg");

  const originalRabbit = require.cache[rabbitPath];
  const originalMsg = require.cache[msgPath];

  let published = null;
  require.cache[rabbitPath] = {
    id: rabbitPath,
    filename: rabbitPath,
    loaded: true,
    exports: {
      send_rabbit_msg(msg, queue) {
        published = { msg, queue };
      },
      read_rabbit_msg() {},
    },
  };

  delete require.cache[msgPath];
  try {
    const { send_msg_execution_update } = require("../utils/project_msg");
    const execution = {
      project_id: "p123",
      user_id: "u456",
      runToken: 5,
      seq: 7,
      state: "running",
      kind: "apply",
      totalSteps: 3,
      doneSteps: 1,
      percent: 33,
      error: null,
      items: [{ imgId: "i1", state: "completed", percent: 100 }],
    };

    send_msg_execution_update(execution);

    assert.ok(published);
    assert.equal(published.queue, "ws_queue");
    assert.equal(published.msg.projectId, "p123");
    assert.equal(published.msg.user, "u456");
    assert.equal(published.msg.runToken, 5);
    assert.equal(published.msg.seq, 7);
    assert.equal(published.msg.state, "running");
    assert.equal(published.msg.kind, "apply");
    assert.equal(published.msg.percent, 33);
  } finally {
    if (originalRabbit) require.cache[rabbitPath] = originalRabbit; else delete require.cache[rabbitPath];
    if (originalMsg) require.cache[msgPath] = originalMsg; else delete require.cache[msgPath];
  }
});
