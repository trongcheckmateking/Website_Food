"""Integration test with a real, disposable PostgreSQL DB and a loopback auth double."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OWNER, BUYER, OTHER = [str(uuid.uuid4()) for _ in range(3)]
IDS = [OWNER, BUYER, OTHER]
SLUG = "test-" + uuid.uuid4().hex[:10]


class AuthDouble(BaseHTTPRequestHandler):
    pushed = threading.Event()

    def reply(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_POST(self):
        if self.path != "/notifications":
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("Authorization") != "Key test-push" or not payload["include_subscription_ids"]:
            self.send_error(400)
            return
        self.pushed.set()
        self.reply({"id":str(uuid.uuid4())})

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/geocode":
            self.reply({"results":[{"formatted_address":"Địa chỉ thử", "geometry":{"location":{"lat":10.78,"lng":106.68}}}]})
            return
        if path == "/Direction":
            self.reply({"routes":[{"legs":[{"distance":{"value":3200}}]}]})
            return
        value = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if self.path != "/auth/v1/user" or value not in IDS:
            self.send_error(401)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"id": value}).encode())

    def log_message(self, *args):
        pass


def run():
    auth = ThreadingHTTPServer(("127.0.0.1", 0), AuthDouble)
    threading.Thread(target=auth.serve_forever, daemon=True).start()
    port = int(os.getenv("SMOKE_PORT", "53118"))
    env = {**os.environ, "DATABASE_URL": os.environ["TEST_DATABASE_URL"],
           "SHOP_SLUG": SLUG, "SHOP_NAME": "Bếp thử", "SHOP_OWNER_ID": OWNER,
           "SHOP_ORIGIN": "10.77,106.69", "SHOP_BANK": "VCB", "SHOP_ACCOUNT": "test-account",
           "SHOP_WEBHOOK_ENV": "SEPAY_KEY_TEST", "SEPAY_KEY_TEST": "local-integration-key",
           "ONESIGNAL_API_KEY":"test-push","ONESIGNAL_APP_ID":"test-app",
           "ONESIGNAL_ENDPOINT":f"http://127.0.0.1:{auth.server_port}/notifications",
           "GOONG_API_KEY":"test-map", "GOONG_BASE_URL":f"http://127.0.0.1:{auth.server_port}", "SUPABASE_URL": f"http://127.0.0.1:{auth.server_port}",
           "SUPABASE_ANON_KEY": "test", "BIND": f"127.0.0.1:{port}"}
    cmd = [str(ROOT / "target/debug/quan-an-api")]
    subprocess.run(cmd + ["setup-shop"], cwd=ROOT, env=env, check=True)
    process = subprocess.Popen(cmd, cwd=ROOT, env=env)
    prefix = "/shop/" + SLUG

    def request(path, who=None, body=None, status=200):
        headers = {"Content-Type": "application/json"}
        if who:
            headers["Authorization"] = ("Bearer " + who) if who in IDS else who
        req = Request(f"http://127.0.0.1:{port}/api"+path, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
        try:
            res = urlopen(req, timeout=8)
        except HTTPError as e:
            res = e
        data = res.read()
        assert res.status == status, (path, res.status, data)
        return json.loads(data)

    try:
        for _ in range(100):
            try:
                request("/config")
                break
            except OSError:
                time.sleep(.1)
        item = dict(name="Đậu hũ", description="", price=15000, stock_delta=1,
                    toppings=[dict(name="Trân châu", available=True, price=2000)], photo="")
        request(prefix+"/items", BUYER, item, 403)
        request(prefix+"/items", OWNER, item)
        if os.getenv("CHECK_BROWSER") == "1":
            from browser_check import check
            check(f"http://127.0.0.1:{port}/quan/{SLUG}")
        menu = request(prefix)
        product = menu["items"][0]["id"]
        order = dict(lines=[dict(id=product, qty=1, toppings=["Trân châu"], note="Ít ngọt")],
                     method="qr", phone="0901234567", note="Gọi trước", quote=None,
                     expected_total=17000, request_id=str(uuid.uuid4()))
        request(prefix+"/orders", BUYER, {**order,"expected_total":1},400)
        assert request(prefix)["items"][0]["stock"] == 1
        def buy(who):
            try:
                return who, request(prefix+"/orders", who, {**order, "request_id":str(uuid.uuid4())})
            except AssertionError as e:
                assert e.args[0][1] == 400, e
                return who, None
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(buy, [BUYER,OTHER]))
        wins = [(u,r) for u,r in results if r]
        assert len(wins)==1
        buyer, win = wins[0]
        outsider = OTHER if buyer==BUYER else BUYER
        url = "/order/"+win["id"]
        request(url, outsider, status=404)
        request(url+"/reviews", buyer, {"item":product,"stars":5,"body":"Ngon"},400)
        request(url+"/state", buyer, {"action":"cancel"})
        assert request(prefix)["items"][0]["stock"] == 1
        o = request(prefix+"/orders", BUYER, order)
        assert request(prefix+"/orders", BUYER, order)==o
        url = "/order/"+o["id"]
        request(url+"/state", OWNER, {"action":"propose","total":16000,"reason":"Giảm 1.000đ"})
        assert "account" not in request(url,BUYER)
        request(url+"/state", BUYER, {"action":"accept"})
        assert request(url, BUYER)["account"]=="test-account"
        event=dict(id=123,accountNumber="test-account",code=o["id"],transferType="in",transferAmount=16000)
        hook=prefix+"/webhook"
        request(hook,"Apikey wrong",event,403)
        request(hook,"Apikey local-integration-key",{**event,"id":122,"transferAmount":1})
        assert not request(url,BUYER)["paid"]
        for _ in range(2):
            request(hook,"Apikey local-integration-key",event)
        assert request(url,BUYER)["paid"]
        request(url+"/messages",BUYER,{"body":"Mình đến rồi"})
        assert request(url,OWNER)["messages"][0]["body"]=="Mình đến rồi"
        request(url+"/state", OWNER, {"action":"complete"})
        request(url+"/reviews",BUYER,{"item":product,"stars":5,"body":"Ngon"})
        request(url+"/reviews",BUYER,{"item":product,"stars":5,"body":"Lặp"},400)
        assert request(prefix)["items"][0]["reviews"][0]["stars"]==5
        request(prefix+"/items",OWNER,{**item,"id":product,"stock_delta":2})
        request(prefix+"/counter/"+product,OWNER,{})
        request(prefix+"/subscription",OWNER,{"device":str(uuid.uuid4())})
        quote=request(prefix+"/quote",OTHER,{"address":"123 Đường thử"})
        assert quote["fee"]==10000 and quote["meters"]==3200
        cash={**order,"method":"cash","quote":quote["id"],"expected_total":27000,"request_id":str(uuid.uuid4())}
        request(prefix+"/orders",BUYER,cash,400)
        o=request(prefix+"/orders",OTHER,cash)
        assert AuthDouble.pushed.wait(timeout=15), "push notification missing"
        url="/order/"+o["id"]
        assert request(url,OTHER)["address"]=="Địa chỉ thử"
        request(url+"/state",OWNER,{"action":"confirm"})
        request(url+"/state",OWNER,{"action":"complete"})
        assert request(url,OTHER)["paid"]
        assert request(prefix)["items"][0]["stock"]==0
        print("PASS: stock race, price validation, cancellation, retries, access, QR, cash, chat and reviews.")
    finally:
        process.terminate()
        process.wait(timeout=10)
        auth.shutdown()


if __name__=="__main__":
    run()
