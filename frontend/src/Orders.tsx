import { useState, useEffect } from "react";
import { api, money, reason, states, type Order, type Summary } from "./api";
export function Orders({
  path,
  selected,
  select,
}: {
  path: string;
  selected: string;
  select: (s: string) => void;
}) {
  const [rows, setRows] = useState<Summary[]>([]),
    [err, setErr] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await api<Summary[]>(path + "/orders");
        if (active) {
          setRows(r);
          setErr("");
        }
      } catch (e) {
        if (active) setErr(reason(e));
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, selected]);
  if (selected)
    return <Detail key={selected} id={selected} back={() => select("")} />;
  return (
    <section className="panel">
      <h2>Đơn hàng</h2>
      {!rows.length && !err && <p>Chưa có đơn hàng.</p>}
      {rows.map((r) => (
        <button key={r.id} className="orderrow" onClick={() => select(r.id)}>
          <div>
            <b>{r.id}</b>
            <small>{new Date(r.created).toLocaleString("vi-VN")}</small>
          </div>
          <div>
            {states[r.state]}
            <small>{money(r.total)}</small>
          </div>
        </button>
      ))}
      <p role="alert">{err}</p>
    </section>
  );
}
function Detail({ id, back }: { id: string; back: () => void }) {
  const url = "order/" + id;
  const [o, setOrder] = useState<Order | null>(null),
    [msg, setMsg] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const data = await api<Order>(url);
        if (alive) setOrder(data);
      } catch (e) {
        if (alive) setMsg(reason(e));
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url]);
  async function send(endpoint: string, data: unknown) {
    setBusy(true);
    setMsg("");
    try {
      await api(url + "/" + endpoint, data);
      if (endpoint === "messages") setText("");
      setOrder(await api<Order>(url));
    } catch (e) {
      setMsg(reason(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <button onClick={back}>← Danh sách đơn</button>
      <p role="status">{msg}</p>
      {o && (
        <>
          <small>{id}</small>
          <h2>{states[o.state]}</h2>
          <p>
            {o.address || "Đến quán lấy"} · {o.phone}
          </p>
          {o.lines.map((l, i) => (
            <div className="line" key={i}>
              <div>
                <b>
                  {l.qty} × {l.name}
                </b>
                <small>
                  {[...l.toppings, l.note].filter(Boolean).join(" · ")}
                </small>
              </div>
              <span>{money(l.qty * l.unit)}</span>
            </div>
          ))}
          {o.note && <p>Ghi chú đơn · {o.note}</p>}
          <p>Phí giao · {money(o.fee)}</p>
          <div className="row">
            <b>Tổng tiền</b>
            <b>{money(o.total)}</b>
          </div>
          <p>
            {o.method === "qr" ? "Chuyển khoản QR" : "Tiền mặt"} ·{" "}
            {o.paid ? "Đã thanh toán" : "Chưa thanh toán"}
          </p>
          {o.bank && o.account && (
            <div className="qr">
              <img
                alt="QR chuyển khoản theo đơn"
                src={
                  "https://qr.sepay.vn/img?" +
                  new URLSearchParams({
                    bank: o.bank,
                    acc: o.account,
                    amount: String(o.total),
                    des: o.id,
                  })
                }
              />
              <p>
                {o.bank} · {o.account}
                <br />
                Nội dung chuyển khoản: {id}
              </p>
            </div>
          )}
          {o.state === "pending" && (
            <>
              <button
                disabled={busy}
                onClick={() => send("state", { action: "cancel" })}
              >
                Hủy đơn
              </button>
              {o.owner && (
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => send("state", { action: "confirm" })}
                >
                  Chốt tổng tiền
                </button>
              )}
            </>
          )}
          {o.owner && o.state === "pending" && (
            <details>
              <summary>Đề xuất tổng tiền khác</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void send("state", {
                    action: "propose",
                    total: Number(f.get("total")),
                    reason: f.get("reason"),
                  });
                }}
              >
                <label>
                  Tổng mới (đ)
                  <input type="number" min="1" name="total" required />
                </label>
                <label>
                  Lý do
                  <input name="reason" required maxLength={180} />
                </label>
                <button disabled={busy}>Gửi khách duyệt</button>
              </form>
            </details>
          )}
          {o.adjustment && (
            <p>
              Điều chỉnh của quán · {o.adjustment} ·{" "}
              {money(o.proposed_total ?? o.total)}
            </p>
          )}
          {o.state === "proposed" && (
            <>
              {o.mine && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => send("state", { action: "accept" })}
                >
                  Đồng ý tổng mới
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => send("state", { action: "cancel" })}
              >
                Hủy đơn
              </button>
            </>
          )}
          {o.owner &&
            o.state === "confirmed" &&
            (o.paid || o.method === "cash") && (
              <button
                disabled={busy}
                className="primary"
                onClick={() => send("state", { action: "complete" })}
              >
                {o.paid ? "Đã giao món" : "Đã giao món và thu tiền"}
              </button>
            )}
          {o.mine &&
            o.state === "completed" &&
            Array.from(new Map(o.lines.map((l) => [l.id, l])).values())
              .filter((l) => !o.reviewed.includes(l.id))
              .map((l) => (
                <form
                  key={l.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void send("reviews", {
                      item: l.id,
                      stars: Number(f.get("stars")),
                      body: f.get("body"),
                    });
                  }}
                >
                  <h3>Đánh giá {l.name}</h3>
                  <label>
                    Số sao
                    <select name="stars">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Nhận xét
                    <input name="body" maxLength={450} />
                  </label>
                  <button disabled={busy}>Gửi đánh giá</button>
                </form>
              ))}
          <h3>Tin nhắn theo đơn</h3>
          <div className="thread">
            {o.messages.map((m) => (
              <p className={m.mine ? "mine" : ""} key={m.id}>
                <small>{m.mine ? "Bạn" : o.owner ? "Khách" : "Quán"}</small>
                {m.body}
              </p>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send("messages", { body: text });
            }}
          >
            <label>
              Tin nhắn
              <textarea
                value={text}
                required
                maxLength={600}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button disabled={busy || !text.trim()}>Gửi tin nhắn</button>
          </form>
        </>
      )}
    </section>
  );
}
