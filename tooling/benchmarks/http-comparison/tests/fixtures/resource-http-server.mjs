import { createServer } from 'node:http';

process.once('message', (message) => {
  if (message !== 'listen') throw new Error('Unexpected fixture command');
  const failed = process.argv[2] === 'failure';
  const server = createServer((_request, response) => {
    response.statusCode = failed ? 503 : 200;
    response.end(failed ? 'first' : '{"ok":true}');
  });
  server.listen(0, '127.0.0.1', () => {
    process.send({ port: server.address().port });
  });
});
