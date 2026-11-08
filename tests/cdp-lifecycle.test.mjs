import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { connect } from '../src/cdp.mjs';

test('real loopback WebSocket disconnect rejects work and a fresh transport can reattach and close', async () => {
  const sockets = new Set();
  let active;
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([{ type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/FIXTURE` }]));
  });
  server.on('upgrade', (request, socket) => {
    active = socket;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        const size = buffer[1] & 127;
        const header = size === 126 ? 4 : 2;
        if (size === 127) { socket.destroy(); return; }
        if (buffer.length < header + 4) return;
        const length = size === 126 ? buffer.readUInt16BE(2) : size;
        if (buffer.length < header + 4 + length) return;
        const mask = buffer.subarray(header, header + 4);
        const payload = Buffer.from(buffer.subarray(header + 4, header + 4 + length));
        buffer = buffer.subarray(header + 4 + length);
        if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        const message = JSON.parse(payload.toString());
        if (message.params.expression === 'hold') continue;
        const result = Buffer.from(JSON.stringify({ id: message.id, result: { result: { value: true } } }));
        socket.write(Buffer.concat([Buffer.from([0x81, result.length]), result]));
      }
    });
  });
  let session;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    session = await connect(server.address().port);
    assert.equal(await session.evaluate('true'), true);
    const failed = assert.rejects(session.evaluate('hold'), { code: 'CDP_TRANSPORT' });
    active.destroy();
    await failed;
    session.close();
    session = await connect(server.address().port);
    assert.equal(await session.evaluate('true'), true);
    session.close();
    await assert.rejects(session.evaluate('true'), { code: 'CDP_TRANSPORT' });
  } finally {
    session?.close();
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
