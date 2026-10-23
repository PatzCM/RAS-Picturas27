const amqp = require('amqplib/callback_api');

const rabbit_host = process.env.RABBITMQ_HOST || 'rabbitmq';
const rabbit_port = process.env.RABBITMQ_PORT || 5672;
const rabbit_username = process.env.RABBITMQ_USER || 'user';
const rabbit_password = process.env.RABBITMQ_PASS || 'password';
const exchange = "picturas";

const rabbit_mq_sv = `amqp://${rabbit_username}:${rabbit_password}@${rabbit_host}:${rabbit_port}`;

function send_rabbit_msg(msg, queue) {
    amqp.connect(rabbit_mq_sv, (err_sv, connection) => {
        if (err_sv) {
            console.error(`[RabbitMQ] Erro ao ligar para enviar para ${queue}:`, err_sv.message);
            return;
        }
        
        connection.createChannel((err_conn, channel) => {
            if (err_conn) {
                console.error(`[RabbitMQ] Erro ao criar canal para ${queue}:`, err_conn.message);
                return;
            }
            
            channel.assertExchange(exchange, 'direct', {
                durable: true
            });

            channel.publish(exchange, queue, Buffer.from(JSON.stringify(msg)));
        });
        
        setTimeout(() => {
            try {
                connection.close();
            } catch (e) {}
        }, 500);
    });
}

function read_rabbit_msg(queue, callback) {
    function connect_with_retry() {
        amqp.connect(rabbit_mq_sv, (err_sv, connection) => {
            if (err_sv) {
                console.error(`[RabbitMQ] Erro ao ligar para escutar fila '${queue}':`, err_sv.message);
                console.log(`[RabbitMQ] A tentar reconectar à fila '${queue}' em 5 segundos...`);
                setTimeout(connect_with_retry, 5000);
                return;
            }

            connection.on("error", (err) => {
                console.error("[RabbitMQ] Erro na ligação:", err.message);
            });
            connection.on("close", () => {
                console.warn(`[RabbitMQ] Ligação fechada. A reconectar à fila '${queue}' em 5s...`);
                setTimeout(connect_with_retry, 5000);
            });

            connection.createChannel((err_conn, channel) => {
                if (err_conn) {
                    console.error("[RabbitMQ] Erro ao criar canal:", err_conn.message);
                    return;
                }

                channel.assertExchange(exchange, 'direct', {
                    durable: true
                });

                channel.assertQueue(queue, { durable: true }, (err_queue, q) => {
                    if (err_queue) {
                        console.error(`[RabbitMQ] Erro ao declarar fila '${queue}':`, err_queue.message);
                        return;
                    }

                    channel.consume(q.queue, (msg) => {
                        if (msg != null) {
                            try {
                                callback(msg);
                            } catch (cb_err) {
                                console.error(`[RabbitMQ] Erro no callback da fila '${queue}':`, cb_err);
                            }
                            // Acknowledge the message
                            channel.ack(msg);
                        }
                    }, {
                        noAck: false
                    });
                });
            });
        });
    }

    connect_with_retry();
}

module.exports = { send_rabbit_msg, read_rabbit_msg };

