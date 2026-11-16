const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    imgId: { type: mongoose.Schema.Types.Mixed, required: true },
    state: {
      type: String,
      enum: ["idle", "running", "completed", "failed", "cancelled"],
      default: "idle",
    },
    percent: { type: Number, default: 0 },
  },
  { _id: false }
);

const projectExecutionSchema = new mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      unique: true,
      index: true,
    },
    user_id: { type: mongoose.Schema.Types.Mixed, required: true },
    state: {
      type: String,
      enum: ["idle", "running", "completed", "failed", "cancelled"],
      default: "idle",
    },
    kind: {
      type: String,
      enum: ["apply", "preview", null],
      default: null,
    },
    runToken: { type: Number, default: 0 },
    seq: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    totalSteps: { type: Number, default: 0 },
    doneSteps: { type: Number, default: 0 },
    percent: { type: Number, default: 0 },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    items: { type: [itemSchema], default: [] },
  },
  { collection: "project_executions", versionKey: false, timestamps: true }
);

module.exports =
  mongoose.models.projectExecution ||
  mongoose.models.project_execution ||
  mongoose.model("projectExecution", projectExecutionSchema);
