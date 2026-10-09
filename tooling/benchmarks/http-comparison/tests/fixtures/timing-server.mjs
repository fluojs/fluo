import { createServer } from 'node:http';

let requests = 0;
const server = createServer((_request, response) => {
  requests += 1;
  if (process.argv.includes('fail-measurement') && requests > 4) response.statusCode = 500;
  response.end('{"ok":true}');
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`listening on :${process.env.PORT}`);
});
