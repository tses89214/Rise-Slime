import Fastify from 'fastify';
import { Kafka } from 'kafkajs';
import { route } from './route';

const brokers = process.env.KAFKA_BROKERS?.split(',');
const producer = brokers ? new Kafka({ clientId: 'collector', brokers }).producer() : null;
await producer?.connect();

const app = Fastify();
app.post('/events', async (req, reply) => {
  const m = route(req.body, Date.now());
  const msg = { key: m.key, value: JSON.stringify(m.value) };
  if (producer) await producer.send({ topic: m.topic, messages: [msg] });
  else console.log(m.topic, msg.value); // no broker configured: dev mode
  return reply.code(m.topic === 'events' ? 202 : 422).send({ topic: m.topic });
});
await app.listen({ port: +(process.env.PORT ?? 3000), host: '0.0.0.0' });
