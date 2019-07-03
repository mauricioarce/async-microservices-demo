const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const amqp = require('amqplib');

const app = express();

const dbConnString = `${process.env.DATABASE_URL || 'localhost'}`;
const amqpConnString = `amqp://${process.env.RABBITMQ_URL || 'localhost'}`;

const dbConnection = mysql.createConnection({
  host: dbConnString,
  user: 'pokeuser',
  password: '123',
  database: 'pokemondb'
});

let lastRequestId = 1;
let amqpConnection;
let mainChannel;

app.use(bodyParser.json());

app.get('/api/v1/pokemon', async function(req, res) {
  dbConnection.query('SELECT * FROM pokemon', function(err, result) {
    if (err) {
      res.status(500).send(err);
    } else {
      res.status(200).send(result);
    }
  });
});

app.get('/api/v1/pokemon/:pokenumber', async function(req, res) {
  const pokenumber = req.params.pokenumber;

  dbConnection.query(
    `SELECT * FROM pokemon WHERE pokenumber = ${pokenumber} ORDER BY pokenumber LIMIT 1`,
    function(err, result) {
      if (err) {
        res.status(500).send(err);
      } else {
        let requestData = result[0];
        let requestId = requestData.pokenumber;
        console.log('Published a request message, requestId:', requestId);
        publishToChannel({
          routingKey: 'request',
          exchangeName: 'processing',
          data: { requestId, requestData }
        });
        res.status(200).send(requestData);
      }
    }
  );
});

app.post('/api/v1/processData', async function(req, res) {
  let requestId = lastRequestId;
  lastRequestId++;

  amqpConnection = await amqp.connect(amqpConnString);
  mainChannel = await amqpConnection.createConfirmChannel();
  let requestData = req.body.data;

  console.log('Published a request message, requestId:', requestId);
  await publishToChannel({
    routingKey: 'request',
    exchangeName: 'processing',
    data: { requestId, requestData }
  });

  res.status(200).send({ requestId });
});

function publishToChannel({ routingKey, exchangeName, data }) {
  return new Promise((resolve, reject) => {
    mainChannel.publish(
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

async function setupExchangesAndQueues() {
  console.log('Setting up RabbitMQ Exchanges/Queues');
  await mainChannel.assertExchange('processing', 'direct', { durable: true });
  await mainChannel.assertQueue('processing.requests', { durable: true });
  await mainChannel.assertQueue('processing.results', { durable: true });
  await mainChannel.bindQueue('processing.requests', 'processing', 'request');
  await mainChannel.bindQueue('processing.results', 'processing', 'result');
  console.log('Setup DONE');
}

async function listenForResults() {
  amqpConnection = await amqp.connect(amqpConnString);
  mainChannel = await amqpConnection.createChannel();

  await setupExchangesAndQueues(mainChannel);
  await mainChannel.prefetch(1);
  await consume({ mainChannel });
}

async function init() {
  await dbConnection.connect(function(err) {
    if (err) {
      throw err;
    }

    console.log('Connected to DB!');
  });
  listenForResults();
}

function consume({ mainChannel }) {
  return new Promise((resolve, reject) => {
    mainChannel.consume('processing.results', async function(msg) {
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

const PORT = 3000;
server = http.createServer(app);
server.listen(PORT, function(err) {
  if (err) {
    console.error(err);
  } else {
    console.info('Listening on port %s.', PORT);
  }
});

init();
