const amqp = require('amqplib/callback_api');

const rabbit_host = process.env.RABBITMQ_HOST;
const rabbit_port = process.env.RABBITMQ_PORT;
const rabbit_username = process.env.RABBITMQ_USER;
const rabbit_password = process.env.RABBITMQ_PASS;
const exchange = "picturas";

const rabbit_mq_sv = `amqp://${rabbit_username}:${rabbit_password}@${rabbit_host}:${rabbit_port}`;

function send_rabbit_msg(msg, queue) {
    amqp.connect(rabbit_mq_sv, (err_sv, connection) => {
        if (err_sv) {
            console.error(`[RABBIT] Error connecting to send to ${queue}:`, err_sv.message);
            return;
        }
        
        connection.createChannel((err_conn, channel) => {
            if (err_conn) {
                console.error(`[RABBIT] Error creating channel to send to ${queue}:`, err_conn.message);
                try { connection.close(); } catch (_) {}
                return;
            }
            
            channel.assertExchange(exchange, 'direct', {
                durable: true
            });

            channel.publish(exchange, queue, Buffer.from(JSON.stringify(msg)));
        });
        
        setTimeout(() => {
            try { connection.close(); } catch (_) {}
        }, 500);
    });
}

function read_rabbit_msg(queue, callback) {
    amqp.connect(rabbit_mq_sv, (err_sv, connection) => {
        if (err_sv) {
            console.error(`[RABBIT] Connection error on ${queue}:`, err_sv.message);
            setTimeout(() => read_rabbit_msg(queue, callback), 3000);
            return;
        }

        connection.on("error", (err) => {
            console.error(`[RABBIT] Connection error on ${queue}:`, err.message);
        });

        connection.on("close", () => {
            console.warn(`[RABBIT] Connection closed on ${queue}, reconnecting...`);
            setTimeout(() => read_rabbit_msg(queue, callback), 3000);
        });

        connection.createChannel((err_conn, channel) => {
            if (err_conn) {
                console.error(`[RABBIT] Channel error on ${queue}:`, err_conn.message);
                try { connection.close(); } catch (_) {}
                return;
            }

            channel.assertExchange(exchange, 'direct', {
                durable: true
            });

            channel.assertQueue(queue, { durable: true }, (err_queue, q) => {
                if (err_queue) {
                    console.error(`[RABBIT] Assert queue error on ${queue}:`, err_queue.message);
                    try { connection.close(); } catch (_) {}
                    return;
                }

                channel.bindQueue(q.queue, exchange, queue, {}, (err_bind) => {
                    if (err_bind) {
                        console.error(`[RABBIT] Bind queue error on ${queue}:`, err_bind.message);
                    }

                    channel.consume(q.queue, (msg) => {
                        if (msg != null) {
                            try {
                                callback(msg);
                            } catch (e) {
                                console.error(`[RABBIT] Error in consumer callback for ${queue}:`, e);
                            }
                            // Acknowledge the message
                            try {
                                channel.ack(msg);
                            } catch (_) {}
                        }
                    }, {
                        noAck: false
                    });
                });
            });
        });
    });
}

module.exports = { send_rabbit_msg, read_rabbit_msg };
