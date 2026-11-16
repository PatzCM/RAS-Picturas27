const http = require("http");
const socketIo = require('socket.io');
const jwt = require("jsonwebtoken");

const { read_rabbit_msg, send_rabbit_msg } = require("./utils/rabbit_mq.js");

const PROJECTS_URL = process.env.PROJECTS_URL || "http://projects:9001";
const PROJECTS_EXECUTION_QUEUE = "projects_execution_queue";

const httpServer = http.createServer();
httpServer.listen(4000);

const io = socketIo(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
    // options
});

async function fetchExecutionSnapshot(socket, { projectId, ownerId, share }) {
    const targetOwner = ownerId || socket.userId;
    if (!targetOwner || !projectId) return null;

    const query = share ? `?share=${encodeURIComponent(share)}` : "";
    const url = `${PROJECTS_URL}/${encodeURIComponent(targetOwner)}/${encodeURIComponent(projectId)}/execution-status${query}`;

    const headers = {};
    if (socket.authToken) {
        headers["Authorization"] = `Bearer ${socket.authToken}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    return await response.json();
}

io.on("connection", (socket) => {
    console.log("a user connected");

    const token = socket.handshake.auth.token;
    if (token != null) {
        jwt.verify(token, process.env.JWT_SECRET_KEY, (e, payload) => {
            if (e) {
                socket.emit('authError', e);
                return;
            }

            socket.userId = String(payload.id);
            socket.authToken = token;
            console.log("Connecting to room:", payload.id)
            socket.join(payload.id);
        });
    }

    socket.on("join-project", async (data, ack) => {
        const params = typeof data === "string" ? { projectId: data } : (data || {});
        const { projectId, ownerId, share } = params;

        if (typeof projectId === "string" && projectId.length > 0) {
            socket.join(`project:${projectId}`);

            try {
                const snapshot = await fetchExecutionSnapshot(socket, { projectId, ownerId, share });
                if (snapshot) {
                    socket.emit("execution-snapshot", snapshot);
                }
                if (typeof ack === "function") ack({ ok: true, snapshot });
            } catch (err) {
                console.error("Failed to fetch execution snapshot:", err.message);
                if (typeof ack === "function") ack({ ok: true, snapshot: null });
            }
        } else if (typeof ack === "function") {
            ack({ ok: false, error: "Invalid projectId" });
        }
    });


    socket.on("leave-project", (data) => {
        const projectId = typeof data === "string" ? data : data?.projectId;
        if (typeof projectId === "string" && projectId.length > 0) {
            socket.leave(`project:${projectId}`);
        }
    });
        
    socket.on("disconnect", () => {
        console.log("A user disconnected");
    });

});

// User ID as room ID

function process_msg() {
    read_rabbit_msg('ws_queue', (msg) => {
        const msg_content = JSON.parse(msg.content.toString());
        const msg_id = msg_content.messageId;
        const timestamp = msg_content.timestamp
        const status = msg_content.status;
        const user = msg_content.user;

        console.log('Received msg:', JSON.stringify(msg_content));

        // Persisted execution status updates emitted by projects service
        if (/update-client-execution-/.test(msg_id)) {
            if (user) {
                io.to(String(user)).emit("execution-update", msg_content);
            }
            if (msg_content.projectId) {
                io.to(`project:${msg_content.projectId}`).emit("execution-update", msg_content);
            }
        }

        // Video editing progress, as a percentage
        else if (/update-client-video-progress/.test(msg_id)) {
            send_rabbit_msg(msg_content, PROJECTS_EXECUTION_QUEUE);

            io.to(user).emit("video-progress", {
                projectId: msg_content.projectId,
                imgId: msg_content.imgId,
                preview: msg_content.preview,
                percent: msg_content.percent,
            });
        }

        else if (/update-client-preview/.test(msg_id)) {
            if (status == "error") {
                const error_code = msg_content.errorCode;
                const error_msg = msg_content.errorMsg;

                io.to(user).emit("preview-error", { error_code, error_msg }); 

                return;
            }

            const img_url = msg_content.img_url;

            io.to(user).emit("preview-ready", img_url);
        }

        else if (/update-client-process/.test(msg_id)) {
            send_rabbit_msg(msg_content, PROJECTS_EXECUTION_QUEUE);

            if (status == "error") {
                const error_code = msg_content.errorCode;
                const error_msg = msg_content.errorMsg;

                io.to(user).emit("process-error", { error_code, error_msg }); 

                return;
            }

            io.to(user).emit("process-update", msg_id);
        }

        else if (msg_content.type === "project-op") {
            const projectId = msg_content.projectId;
            const op = msg_content.op;

            if (projectId && op) {
                io.to(`project:${projectId}`).emit("project-op", { projectId, op });
            }
            }

        //  project updated
        else if (/project-updated/.test(msg_id) || msg_content.type === "project-updated") {
            const projectId = msg_content.projectId;
            const version = msg_content.version;

            if (projectId) {
                io.to(`project:${projectId}`).emit("project-updated", { projectId, version });
            }
        }
    })
}

process_msg();