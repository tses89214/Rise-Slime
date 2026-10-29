import Fastify from 'fastify';
import { Kafka } from 'kafkajs';
import { route } from './route';
import { dashboardRoutes } from './dashboard';

const brokers = process.env.KAFKA_BROKERS?.split(',');
const producer = brokers ? new Kafka({ clientId: 'collector', brokers }).producer() : null;
await producer?.connect();

const app = Fastify();
// The browser game posts cross-origin (vite :5173 -> :3000) with a JSON content-type, which triggers a preflight.
app.addHook('onRequest', async (req, reply) => {
  reply.header('access-control-allow-origin', '*').header('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return reply.code(204).send();
});
dashboardRoutes(app);
app.post('/events', async (req, reply) => {
  const m = route(req.body, Date.now());
  const msg = { key: m.key, value: JSON.stringify(m.value) };
  if (producer) await producer.send({ topic: m.topic, messages: [msg] });
  else console.log(m.topic, msg.value); // no broker configured: dev mode
  return reply.code(m.topic === 'events' ? 202 : 422).send({ topic: m.topic });
});
await app.listen({ port: +(process.env.PORT ?? 3000), host: '0.0.0.0' });
