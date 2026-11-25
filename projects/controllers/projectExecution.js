const mongoose = require("mongoose");
const ProjectExecution = require("../models/projectExecution");
const ProjectModel = require("../models/project");
const { send_msg_execution_update } = require("../utils/project_msg");

function normalizeState(s) {
  if (!s) return "running";
  const str = String(s).toLowerCase();
  if (["idle", "running", "completed", "failed", "cancelled"].includes(str)) {
    return str;
  }
  if (str === "in_progress" || str === "processing" || str === "pending") {
    return "running";
  }
  if (str === "success" || str === "done" || str === "finished") {
    return "completed";
  }
  if (str === "error" || str === "fail") {
    return "failed";
  }
  if (str === "cancel" || str === "canceled" || str === "abort") {
    return "cancelled";
  }
  return "running";
}

function buildProjectQuery(projectId) {
  if (mongoose.Types.ObjectId.isValid(projectId)) {
    return {
      $or: [
        { project_id: projectId },
        { project_id: new mongoose.Types.ObjectId(String(projectId)) },
        { project_id: String(projectId) },
      ],
    };
  }
  return { project_id: projectId };
}

async function getOne(projectId) {
  const query = buildProjectQuery(projectId);
  return await ProjectExecution.findOne(query).exec();
}

async function initExecution({ projectId, userId, kind, runToken, imgs, previewImgId }) {
  const existing = await getOne(projectId);
  const nextSeq = (existing?.seq || 0) + 1;

  let items = [];
  if (kind === "preview") {
    items = [{ imgId: previewImgId, state: "running", percent: 0 }];
  } else {
    items = (imgs || []).map((img) => ({
      imgId: img._id,
      state: "running",
      percent: 0,
    }));
  }

  const totalSteps = items.length || 1;

  const update = {
    project_id: projectId,
    user_id: userId,
    state: "running",
    kind: kind || "apply",
    runToken: Number(runToken) || 0,
    seq: nextSeq,
    startedAt: new Date(),
    finishedAt: null,
    totalSteps: totalSteps,
    doneSteps: 0,
    percent: 0,
    error: null,
    items: items,
  };

  const saved = await ProjectExecution.findOneAndUpdate(
    { project_id: projectId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();

  send_msg_execution_update(saved);
  return saved;
}

async function updateProgress(
  { projectId, imgId, percent, status, error, allowComplete = true },
  options = {}
) {
  const effectiveAllowComplete =
    options && typeof options.allowComplete === "boolean"
      ? options.allowComplete
      : allowComplete;
  let execution = await getOne(projectId);

  if (!execution) {
    let project = null;
    try {
      project =
        (await ProjectModel.findById(projectId).exec()) ||
        (await ProjectModel.findOne({ _id: projectId }).exec());
    } catch (_) {}

    const userId = project ? project.user_id : "unknown";
    const items = (project?.imgs || []).map((img) => ({
      imgId: img._id,
      state: "idle",
      percent: 0,
    }));

    execution = new ProjectExecution({
      project_id: projectId,
      user_id: userId,
      state: "running",
      kind: "apply",
      runToken: project?.activeToken || 0,
      seq: 0,
      startedAt: new Date(),
      finishedAt: null,
      totalSteps: items.length || 1,
      doneSteps: 0,
      percent: 0,
      error: null,
      items: items,
    });
  }

  // Se já estiver cancelado, ignorar atualizações de progresso
  if (execution.state === "cancelled") {
    return execution;
  }

  const numericPercent = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  const normStatus = normalizeState(
    status || (numericPercent >= 100 ? "completed" : "running")
  );

  if (!execution.items) execution.items = [];

  let itemFound = false;
  for (let it of execution.items) {
    if (String(it.imgId) === String(imgId)) {
      it.percent = numericPercent;
      it.state = normStatus;
      itemFound = true;
      break;
    }
  }

  if (!itemFound && imgId) {
    execution.items.push({
      imgId: imgId,
      state: normStatus,
      percent: numericPercent,
    });
  }

  // Recalcular percent global
  if (execution.items.length > 0) {
    const totalItemPercent = execution.items.reduce(
      (sum, it) => sum + (it.percent || 0),
      0
    );
    execution.percent = Math.round(totalItemPercent / execution.items.length);
  } else {
    execution.percent = numericPercent;
  }

  // Recalcular doneSteps e totalSteps
  execution.doneSteps = execution.items.filter(
    (it) => it.state === "completed" || it.percent >= 100
  ).length;

  if (execution.items.length > (execution.totalSteps || 0)) {
    execution.totalSteps = execution.items.length;
  }

  // Transições de estado
  if (normStatus === "failed" || error) {
    execution.state = "failed";
    execution.error = error || "Processing failed";
    execution.finishedAt = new Date();
  } else if (
    effectiveAllowComplete &&
    execution.doneSteps >= execution.totalSteps &&
    execution.totalSteps > 0 &&
    execution.percent >= 100
  ) {
    execution.state = "completed";
    execution.finishedAt = new Date();
  } else if (normStatus === "cancelled") {
    execution.state = "cancelled";
    execution.finishedAt = new Date();
  } else {
    execution.state = "running";
  }

  execution.seq = (execution.seq || 0) + 1;

  const saved = await ProjectExecution.findOneAndUpdate(
    { project_id: execution.project_id },
    {
      $set: {
        project_id: execution.project_id,
        user_id: execution.user_id,
        state: execution.state,
        kind: execution.kind,
        runToken: execution.runToken,
        seq: execution.seq,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
        totalSteps: execution.totalSteps,
        doneSteps: execution.doneSteps,
        percent: execution.percent,
        error: execution.error,
        items: execution.items,
      },
    },
    { upsert: true, new: true }
  ).exec();

  send_msg_execution_update(saved);
  return saved;
}

async function cancelExecution({ projectId, userId, runToken }) {
  const existing = await getOne(projectId);
  const nextSeq = (existing?.seq || 0) + 1;
  const token = runToken != null ? Number(runToken) : (existing?.runToken || 0);

  const updatedItems = (existing?.items || []).map((it) => {
    const itemObj = it.toObject ? it.toObject() : it;
    if (itemObj.state !== "completed") {
      itemObj.state = "cancelled";
    }
    return itemObj;
  });

  const update = {
    project_id: projectId,
    user_id: userId || existing?.user_id || "unknown",
    state: "cancelled",
    kind: existing?.kind || null,
    runToken: token,
    seq: nextSeq,
    startedAt: existing?.startedAt || new Date(),
    finishedAt: new Date(),
    totalSteps: existing?.totalSteps || 0,
    doneSteps: existing?.doneSteps || 0,
    percent: existing?.percent || 0,
    error: existing?.error || null,
    items: updatedItems,
  };

  const saved = await ProjectExecution.findOneAndUpdate(
    { project_id: projectId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();

  send_msg_execution_update(saved);
  return saved;
}

async function completeExecution({ projectId, runToken }) {
  const existing = await getOne(projectId);
  if (!existing) return null;

  if (runToken != null && existing.runToken !== Number(runToken)) {
    return null;
  }

  const nextSeq = (existing.seq || 0) + 1;
  const updatedItems = (existing.items || []).map((it) => {
    const itemObj = it.toObject ? it.toObject() : it;
    itemObj.state = "completed";
    itemObj.percent = 100;
    return itemObj;
  });

  const totalSteps = existing.totalSteps || updatedItems.length || 1;

  const update = {
    state: "completed",
    percent: 100,
    totalSteps: totalSteps,
    doneSteps: totalSteps,
    finishedAt: new Date(),
    seq: nextSeq,
    items: updatedItems,
  };

  const saved = await ProjectExecution.findOneAndUpdate(
    { project_id: existing.project_id },
    { $set: update },
    { new: true }
  ).exec();

  send_msg_execution_update(saved);
  return saved;
}

async function failExecution({ projectId, runToken, error }) {
  const existing = await getOne(projectId);
  if (!existing) return null;

  if (runToken != null && existing.runToken !== Number(runToken)) {
    return null;
  }

  const nextSeq = (existing.seq || 0) + 1;

  const update = {
    state: "failed",
    error: error || "Processing error",
    finishedAt: new Date(),
    seq: nextSeq,
  };

  const saved = await ProjectExecution.findOneAndUpdate(
    { project_id: existing.project_id },
    { $set: update },
    { new: true }
  ).exec();

  send_msg_execution_update(saved);
  return saved;
}

async function updateItemProgress(
  { projectId, imgId, percent, status, allowComplete = true },
  options = {}
) {
  const effectiveAllowComplete =
    options && typeof options.allowComplete === "boolean"
      ? options.allowComplete
      : allowComplete;
  return await updateProgress({
    projectId,
    imgId,
    percent,
    status,
    allowComplete: effectiveAllowComplete,
  });
}

module.exports = {
  getOne,
  initExecution,
  startExecution: initExecution,
  updateProgress,
  updateItemProgress,
  completeExecution,
  failExecution,
  cancelExecution,
};
