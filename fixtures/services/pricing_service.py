"""Non-JavaScript pricing service used by the qualification matrix.

Deliberately a different runtime from the toolkit: the point is that a component keeps its own
language and is checked with its own tooling, not rewritten into TypeScript to be verifiable.
Synthetic prices only, in integer centavos.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import json
import sys

PRICES = {"rice": 5500, "soap": 2500}
MAXIMUM_QUANTITY = 99


def price(query):
    total = 0
    for product, values in query.items():
        if product not in PRICES:
            return None, f"UNKNOWN_PRODUCT:{product}"
        try:
            quantity = int(values[0])
        except (TypeError, ValueError):
            return None, f"QUANTITY_NOT_INTEGER:{product}"
        if quantity < 1:
            return None, f"QUANTITY_TOO_LOW:{product}"
        if quantity > MAXIMUM_QUANTITY:
            return None, f"QUANTITY_ABOVE_MAXIMUM:{product}"
        total += PRICES[product] * quantity
    if total == 0:
        return None, "EMPTY_CART"
    return total, None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/price":
            self.respond(404, {"error": "NOT_FOUND"})
            return
        total, error = price(parse_qs(parsed.query))
        if error is not None:
            self.respond(422, {"error": error})
            return
        self.respond(200, {"total_centavos": total, "runtime": "python" + ".".join(map(str, sys.version_info[:2]))})

    def respond(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        return


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 0), Handler)
    print(json.dumps({"url": "http://127.0.0.1:%d" % server.server_address[1]}), flush=True)
    server.serve_forever()
