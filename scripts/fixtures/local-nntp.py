#!/usr/bin/env python3
"""Serve the repository's public-domain EPUB to one disposable SABnzbd instance."""
import pathlib
import socketserver
import zlib

payload = pathlib.Path('/fixture/alice.epub').read_bytes()
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
body = [f'=ybegin line=128 size={len(payload)} name=alice.epub'.encode(), *lines,
        f'=yend size={len(payload)} crc32={zlib.crc32(payload):08x}'.encode()]
article = b'\r\n'.join(b'.' + line if line.startswith(b'.') else line for line in body)

class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'200 Aldus local fixture ready\r\n')
        for raw in self.rfile:
            command = raw.decode('ascii', 'replace').strip().upper()
            if command.startswith('CAPABILITIES'):
                self.wfile.write(b'101 Capabilities\r\nVERSION 2\r\nREADER\r\n.\r\n')
            elif command.startswith('MODE'):
                self.wfile.write(b'200 Reader mode\r\n')
            elif command.startswith('GROUP'):
                self.wfile.write(b'211 1 1 1 alt.test\r\n')
            elif command.startswith('STAT'):
                self.wfile.write(b'223 1 <aldus-local@fixture.invalid>\r\n')
            elif command.startswith('BODY'):
                self.wfile.write(b'222 1 <aldus-local@fixture.invalid>\r\n' + article + b'\r\n.\r\n')
            elif command.startswith('ARTICLE'):
                self.wfile.write(b'220 1 <aldus-local@fixture.invalid>\r\nSubject: alice.epub\r\n\r\n' + article + b'\r\n.\r\n')
            elif command.startswith('QUIT'):
                self.wfile.write(b'205 Goodbye\r\n')
                return
            else:
                self.wfile.write(b'500 Unsupported fixture command\r\n')

socketserver.ThreadingTCPServer(('127.0.0.1', 1119), Handler).serve_forever()
