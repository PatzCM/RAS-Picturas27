const { send_rabbit_msg, read_rabbit_msg } = require('./rabbit_mq')

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
    'project': 'project_queue',
    'ws': 'ws_queue',
    'video_convert': 'video_convert_queue',
    'video_convert_cancel': 'video_convert_cancel_queue',
    'video_convert_result': 'video_convert_result_queue'
}

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

function send_msg_video_convert_cancel(correlation_id) {
    const queue = queues['video_convert_cancel'];
    const msg = {
        "correlationId": correlation_id,
        "action": "cancel",
        "timestamp": new Date().toISOString()
    };
    send_rabbit_msg(msg, queue);
}

function read_video_result_msg(callback){
    read_rabbit_msg(queues['video_convert_result'], callback);
}

function send_msg_video_convert(msg_id, correlation_id, timestamp, bucket, input_key, project_id, target_format, target_resolution) {
    const queue = queues['video_convert'];
    const msg = {
        "schemaVersion": 1,
        "messageId": msg_id,
        "correlationId": correlation_id,
        "timestamp": timestamp,
        "procedure": "video_convert",
        "resource": {
            "input": { 
                "bucket": bucket, 
                "key": input_key, 
                "mediaType": "video" 
            },
            "output": { 
                "bucket": bucket, 
                "projectId": project_id, 
                "stage": "out" 
            }
        },
        "parameters": {
            "targetFormat": target_format,
            "targetResolution": target_resolution
        }
    };

    send_rabbit_msg(msg, queue);
}

module.exports = { send_msg_tool, send_msg_client, send_msg_client_error, send_msg_client_preview, send_msg_client_preview_error, read_msg, send_msg_project_op, send_msg_video_convert_cancel, read_video_result_msg, send_msg_video_convert };