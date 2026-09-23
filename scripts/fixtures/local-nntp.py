#!/usr/bin/env python3
"""Serve only the public Alice EPUB/MP3/M4B articles to disposable SABnzbd."""
import pathlib
import socketserver
import zlib


def article_for(extension):
    payload = pathlib.Path(f'/fixture/alice.{extension}').read_bytes()
    encoded = bytearray()
    lines = []
    for original in payload:
        value = (original + 42) % 256
        encoded.extend((61, (value + 64) % 256) if value in (0, 10, 13, 61) else (value,))
        if len(encoded) >= 128:
            lines.append(bytes(encoded))
            encoded.clear()
    if encoded:
        lines.append(bytes(encoded))
    body = [f'=ybegin line=128 size={len(payload)} name=alice.{extension}'.encode(), *lines,
            f'=yend size={len(payload)} crc32={zlib.crc32(payload):08x}'.encode()]
    return b'\r\n'.join(b'.' + line if line.startswith(b'.') else line for line in body)


articles = {f'<aldus-{ext}@fixture.invalid>': article_for(ext) for ext in ('epub', 'mp3', 'm4b')}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'200 Aldus local fixture ready\r\n')
        for raw in self.rfile:
            parts = raw.decode('ascii', 'replace').strip().split()
            if not parts:
                continue
            command = parts[0].upper()
            message = parts[1] if len(parts) > 1 else ''
            if command == 'CAPABILITIES':
                self.wfile.write(b'101 Capabilities\r\nVERSION 2\r\nREADER\r\n.\r\n')
            elif command == 'MODE':
                self.wfile.write(b'200 Reader mode\r\n')
            elif command == 'GROUP':
                self.wfile.write(b'211 3 1 3 alt.test\r\n')
            elif command in ('STAT', 'BODY', 'ARTICLE'):
                if message not in articles:
                    self.wfile.write(b'430 No such fixture article\r\n')
                    continue
                code = {'STAT': 223, 'BODY': 222, 'ARTICLE': 220}[command]
                self.wfile.write(f'{code} 1 {message}\r\n'.encode())
                if command == 'ARTICLE':
                    self.wfile.write(b'Subject: Alice fixture\r\n\r\n')
                if command != 'STAT':
                    self.wfile.write(articles[message] + b'\r\n.\r\n')
            elif command == 'QUIT':
                self.wfile.write(b'205 Goodbye\r\n')
                return
            else:
                self.wfile.write(b'500 Unsupported fixture command\r\n')


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


Server(('127.0.0.1', 1119), Handler).serve_forever()
