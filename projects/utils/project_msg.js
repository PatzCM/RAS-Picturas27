const { send_rabbit_msg, read_rabbit_msg } = require('./rabbit_mq');

let uuidv4;
try {
  uuidv4 = require("uuid").v4;
} catch (_) {
  uuidv4 = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const queues = {
    'cut': 'cut_queue',
    'scale': 'scale_queue',
    'border': 'border_queue',
    'saturation': 'saturation_queue',
    'brightness': 'brightness_queue',
    'contrast': 'contrast_queue',
    'binarization': 'binarization_queue',
    'resize': 'resize_queue',
    'rotate': 'rotate_queue',
    'cut_ai': 'cut_ai_queue',
    'upgrade_ai': 'upgrade_ai_queue',
    'bg_remove_ai': 'bg_remove_ai_queue',
    'text_ai': 'text_ai_queue',
    'obj_ai': 'obj_ai_queue',
    'people_ai': 'people_ai_queue',
    'expand_ai': 'expand_ai_queue',
    'watermark': 'watermark_queue',
    'video': 'video_queue',
    'project': 'project_queue',
    'ws': 'ws_queue',
    'projects_execution': 'projects_execution_queue'
};

function send_msg_tool(msg_id, timestamp, og_img_uri, new_img_uri, tool, params) {
    const queue = queues[tool];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "procedure": tool,
        "parameters": {
            "inputImageURI": og_img_uri,
            "outputImageURI": new_img_uri,
            ... params
        }
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client(msg_id, timestamp, user) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "user": user,
        "status": 'success'
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client_error(msg_id, timestamp, user, error_code, error_msg) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "user": user,
        "status": "error",
        "errorCode": error_code,
        "errorMsg": error_msg
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client_preview(msg_id, timestamp, user, url) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "status": 'success',
        "user": user,
        "img_url": url
    };

    send_rabbit_msg(msg, queue);
}

function send_msg_client_preview_error(msg_id, timestamp, user, error_code, error_msg) {
    const queue = queues['ws'];
    const msg = {
        "messageId": msg_id,
        "timestamp": timestamp,
        "user": user,
        "status": "error",
        "errorCode": error_code,
        "errorMsg": error_msg
    };

    send_rabbit_msg(msg, queue);
}

function read_msg(callback){
    read_rabbit_msg(queues['project'], callback);
}

function read_execution_msg(callback) {
    read_rabbit_msg(queues['projects_execution'], callback);
}

function send_msg_project_op({ projectId, ownerId, op }) {
  const queue = queues["ws"];
  const msg = {
    type: "project-op",
    projectId,
    ownerId,
    op, // payload da operação 
    timestamp: Date.now(),
    status: "success",
  };
  send_rabbit_msg(msg, queue);
}

function send_msg_execution_update(execution) {
  const queue = queues["ws"];
  const doc = execution && typeof execution.toObject === "function" ? execution.toObject() : execution;
  if (!doc) return;

  const msg = {
    messageId: `update-client-execution-${uuidv4()}`,
    timestamp: new Date().toISOString(),
    user: String(doc.user_id),
    projectId: String(doc.project_id),
    runToken: doc.runToken ?? 0,
    seq: doc.seq ?? 0,
    state: doc.state,
    status: doc.state,
    kind: doc.kind,
    totalSteps: doc.totalSteps ?? 0,
    doneSteps: doc.doneSteps ?? 0,
    percent: doc.percent ?? 0,
    error: doc.error ?? null,
    items: doc.items || [],
    startedAt: doc.startedAt || null,
    finishedAt: doc.finishedAt || null,
  };
  send_rabbit_msg(msg, queue);
}

module.exports = {
  send_msg_tool,
  send_msg_client,
  send_msg_client_error,
  send_msg_client_preview,
  send_msg_client_preview_error,
  read_msg,
  read_execution_msg,
  send_msg_project_op,
  send_msg_execution_update,
};
