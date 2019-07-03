const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const amqp = require('amqplib');
const app = express();

// Middleware
app.use(bodyParser.json());

// simulate request ids
let lastRequestId = 1;

// RabbitMQ connection string
const messageQueueConnectionString = `amqp://${process.env.RABBITMQ_URL ||
  'localhost'}`;

// handle the request
app.post('/api/v1/processData', async function(req, res) {
  // save request id and increment
  let requestId = lastRequestId;
  lastRequestId++;

  // connect to Rabbit MQ and create a channel
  let connection = await amqp.connect(messageQueueConnectionString);
  let channel = await connection.createConfirmChannel();

  // publish the data to Rabbit MQ
  let requestData = req.body.data;
  console.log('Published a request message, requestId:', requestId);
  await publishToChannel(channel, {
    routingKey: 'request',
    exchangeName: 'processing',
    data: { requestId, requestData }
  });

  // send the request id in the response
  res.send({ requestId });
});

// utility function to publish messages to a channel
function publishToChannel(channel, { routingKey, exchangeName, data }) {
  return new Promise((resolve, reject) => {
    channel.publish(
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

async function setupExchangesAndQueues(channel) {
  console.log('Setting up RabbitMQ Exchanges/Queues');
  // create exchange
  await channel.assertExchange('processing', 'direct', { durable: true });

  // create queues
  await channel.assertQueue('processing.requests', { durable: true });
  await channel.assertQueue('processing.results', { durable: true });

  // bind queues
  await channel.bindQueue('processing.requests', 'processing', 'request');
  await channel.bindQueue('processing.results', 'processing', 'result');

  console.log('Setup DONE');
}

async function listenForResults() {
  // connect to Rabbit MQ
  let connection = await amqp.connect(messageQueueConnectionString);

  // create a channel and prefetch 1 message at a time
  let channel = await connection.createChannel();
  await setupExchangesAndQueues(channel);
  await channel.prefetch(1);

  // start consuming messages
  await consume({ connection, channel });
}

// consume messages from RabbitMQ
function consume({ connection, channel, resultsChannel }) {
  return new Promise((resolve, reject) => {
    channel.consume('processing.results', async function(msg) {
      // parse message
      let msgBody = msg.content.toString();
      let data = JSON.parse(msgBody);
      let requestId = data.requestId;
      let processingResults = data.processingResults;
      console.log(
        'Received a result message, requestId:',
        requestId,
        'processingResults:',
        processingResults
      );

      // acknowledge message as received
      await channel.ack(msg);
    });

    // handle connection closed
    connection.on('close', err => {
      return reject(err);
    });

    // handle errors
    connection.on('error', err => {
      return reject(err);
    });
  });
}

// Start the server
const PORT = 3000;
server = http.createServer(app);
server.listen(PORT, function(err) {
  if (err) {
    console.error(err);
  } else {
    console.info('Listening on port %s.', PORT);
  }
});

// listen for results on RabbitMQ
listenForResults();
