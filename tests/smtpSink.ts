import net from 'net';

interface SinkMessage {
  headers: Record<string, string>;
  body: string;
  text: string;
  raw: string;
}

interface SmtpSink {
  port: number;
  host: string;
  messages: SinkMessage[];
  lastTo(address: string): SinkMessage | null;
  clear(): void;
  stop(): Promise<unknown>;
}

function startSmtpSink(
  { port = 2525, host = '127.0.0.1' }: { port?: number; host?: string } = {}
): Promise<SmtpSink> {
  const messages: SinkMessage[] = [];

  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let dataLines: string[] = [];
    let expecting: string | null = null;

    const say = (line: string) => socket.write(line + '\r\n');
    say('220 smtp-sink ready');

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');

      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(parseMessage(dataLines.join('\n')));
            dataLines = [];
            say('250 2.0.0 Ok: queued');
          } else {
            dataLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        if (expecting) {
          expecting = expecting === 'username' ? 'password' : null;
          say(expecting ? '334 UGFzc3dvcmQ6' : '235 2.7.0 Authentication successful');
          continue;
        }

        const command = line.split(' ')[0].toUpperCase();
        switch (command) {
          case 'EHLO':
            socket.write('250-smtp-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
            break;
          case 'HELO':
            say('250 smtp-sink');
            break;
          case 'AUTH':
            if (/^AUTH\s+LOGIN\s*$/i.test(line)) {
              expecting = 'username';
              say('334 VXNlcm5hbWU6');
            } else {
              say('235 2.7.0 Authentication successful');
            }
            break;
          case 'MAIL':
          case 'RCPT':
          case 'RSET':
          case 'NOOP':
            say('250 2.1.0 Ok');
            break;
          case 'DATA':
            inData = true;
            say('354 End data with <CR><LF>.<CR><LF>');
            break;
          case 'QUIT':
            say('221 2.0.0 Bye');
            socket.end();
            break;
          default:
            say('250 2.0.0 Ok');
        }
      }
    });

    socket.on('error', () => {  });
  });

  function parseHeaders(headerText: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of headerText.replace(/\n[ \t]+/g, ' ').split('\n')) {
      const at = line.indexOf(':');
      if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
    return headers;
  }

  function decodePart(body: string, encoding: string | undefined): string {
    const how = String(encoding || '').toLowerCase();
    if (how === 'base64') {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    if (how === 'quoted-printable') {
      return body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
    }
    return body;
  }

  function parseMessage(raw: string): SinkMessage {
    const split = raw.indexOf('\n\n');
    const headerText = split === -1 ? raw : raw.slice(0, split);
    const body = split === -1 ? '' : raw.slice(split + 2);
    const headers = parseHeaders(headerText);

    const boundaryMatch = /boundary="?([^";\s]+)"?/i.exec(headers['content-type'] || '');
    let text: string;

    if (boundaryMatch) {
      const marker = '--' + boundaryMatch[1];
      text = body
        .split(marker)
        .slice(1, -1)
        .map((part) => {
          const at = part.indexOf('\n\n');
          if (at === -1) return part;
          const partHeaders = parseHeaders(part.slice(0, at));
          return decodePart(part.slice(at + 2), partHeaders['content-transfer-encoding']);
        })
        .join('\n');
    } else {
      text = decodePart(body, headers['content-transfer-encoding']);
    }

    return { headers, body, text, raw };
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        port,
        host,
        messages,
        lastTo(address: string) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if ((messages[i].headers.to || '').includes(address)) return messages[i];
          }
          return null;
        },
        clear() { messages.length = 0; },
        stop() { return new Promise((done) => server.close(done)); },
      });
    });
  });
}

export { startSmtpSink };
export type { SmtpSink, SinkMessage };
