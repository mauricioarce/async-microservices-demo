const amqp = require('amqplib');

const amqpConnString = `amqp://${process.env.RABBITMQ_URL || 'localhost'}`;

let amqpConnection;
let mainChannel;
let resultsChannel;

async function setupExchangesAndQueues(resolveChannel) {
  console.log('Setting up RabbitMQ Exchanges/Queues');
  await resolveChannel.assertExchange('processing', 'direct', {
    durable: true
  });
  await resolveChannel.assertQueue('processing.requests', { durable: true });
  await resolveChannel.assertQueue('processing.results', { durable: true });
  await resolveChannel.bindQueue(
    'processing.requests',
    'processing',
    'request'
  );
  await resolveChannel.bindQueue('processing.results', 'processing', 'result');
  console.log('Setup DONE');
}

async function listenForMessages() {
  amqpConnection = await amqp.connect(amqpConnString);
  mainChannel = await amqpConnection.createChannel();
  resultsChannel = await amqpConnection.createConfirmChannel();

  await setupExchangesAndQueues(mainChannel);
  await mainChannel.prefetch(1);

  await consume();
}

function publishToChannel(resolveChannel, { routingKey, exchangeName, data }) {
  return new Promise((resolve, reject) => {
    resolveChannel.publish(
      exchangeName,
      routingKey,
      Buffer.from(JSON.stringify(data), 'utf-8'),
      { persistent: true },
      function(err, ok) {
        if (err) {
          return reject(err);
        }

        resolve();
      }
    );
  });
}

function consume() {
  return new Promise((resolve, reject) => {
    mainChannel.consume('processing.requests', async function(msg) {
      let msgBody = msg.content.toString();
      let data = JSON.parse(msgBody);
      let requestId = data.requestId;
      let requestData = data.requestData;
      console.log('Received a request message, requestId:', requestId);

      let processingResults = await processMessage(requestData);

      await publishToChannel(resultsChannel, {
        exchangeName: 'processing',
        routingKey: 'result',
        data: { requestId, processingResults }
      });
      console.log('Published results for requestId:', requestId);

      await mainChannel.ack(msg);
    });

    amqpConnection.on('close', err => {
      return reject(err);
    });

    amqpConnection.on('error', err => {
      return reject(err);
    });
  });
}

function processMessage(requestData) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(requestData + '-processed');
    }, 5000);
  });
}

listenForMessages();
