import { useState } from "react";
import { api, money, reason, type Line, type Item, type Shop } from "./api";

function Dish({ item, add }: { item: Item; add: (l: Line) => void }) {
  const [open, setOpen] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [note, setNote] = useState(""),
    [qty, setQty] = useState(1);
  const toppings = item.toppings.filter(
    (t) => t.available && chosen.includes(t.name),
  );
  const unit = item.price + toppings.reduce((s, t) => s + t.price, 0);
  return (
    <article className="dish">
      {item.photo && <img src={item.photo} alt={item.name} loading="lazy" />}
      <div className="row">
        <h3>{item.name}</h3>
        <b>{money(item.price)}</b>
      </div>
      <p>{item.description}</p>
      <div className="row">
        <small>{item.stock ? "Còn " + item.stock + " phần" : "Hết món"}</small>
        <button disabled={!item.stock} onClick={() => setOpen(!open)}>
          {open ? "Thu gọn" : "Chọn món"}
        </button>
      </div>
      {open && (
        <div className="options">
          {item.toppings.map((t) => (
            <label className="check" key={t.name}>
              <input
                type="checkbox"
                disabled={!t.available}
                checked={t.available && chosen.includes(t.name)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, t.name]
                      : chosen.filter((x) => x !== t.name),
                  )
                }
              />
              {t.name} · {t.available ? money(t.price) : "Hết"}
            </label>
          ))}
          <label>
            Số phần
            <input
              type="number"
              min={1}
              max={Math.min(99, item.stock)}
              value={qty}
              onChange={(e) => setQty(+e.target.value)}
            />
          </label>
          <label>
            Ghi chú món
            <input
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: ít ngọt"
            />
          </label>
          <button
            className="primary"
            disabled={
              !Number.isInteger(qty) ||
              qty < 1 ||
              qty > Math.min(99, item.stock)
            }
            onClick={() => {
              add({
                id: item.id,
                name: item.name,
                qty,
                unit,
                note,
                toppings: toppings.map((t) => t.name),
              });
              setOpen(false);
              setNote("");
              setChosen([]);
              setQty(1);
            }}
          >
            Thêm · {money(unit * qty)}
          </button>
        </div>
      )}
      {item.reviews.length > 0 && (
        <details>
          <summary>Đánh giá ({item.reviews.length})</summary>
          {item.reviews.map((r, i) => (
            <p key={i}>
              {r.stars} ★ · {r.body}
            </p>
          ))}
        </details>
      )}
    </article>
  );
}
export function Menu({ shop, add }: { shop: Shop; add: (l: Line) => void }) {
  const [q, setQ] = useState("");
  const visible = shop.items.filter((i) =>
    i.name.toLocaleLowerCase("vi").includes(q.toLocaleLowerCase("vi")),
  );
  return (
    <>
      <div className="sectionhead">
        <h2>Thực đơn</h2>
        <input
          aria-label="Tìm món"
          type="search"
          placeholder="Tìm món…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="grid">
        {visible.map((i) => (
          <Dish key={i.id} item={i} add={add} />
        ))}
      </div>
      {!visible.length && <p>Chưa có món phù hợp.</p>}
    </>
  );
}
type Quote = { id: string; address: string; fee: number; meters: number };
export function Cart({
  shop,
  path,
  lines,
  remove,
  done,
  login,
  signed,
}: {
  shop: Shop;
  path: string;
  lines: Line[];
  remove: (i: number) => void;
  done: (i: string) => void;
  login: () => void;
  signed: boolean;
}) {
  const [delivery, setDelivery] = useState(false),
    [address, setAddress] = useState(""),
    [quote, setQuote] = useState<Quote | null>(null);
  const [phone, setPhone] = useState(""),
    [note, setNote] = useState(""),
    [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const total =
    lines.reduce((s, l) => s + l.unit * l.qty, 0) +
    (delivery && quote ? quote.fee : 0);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy(false);
    }
  }
  async function checkout() {
    const data = {
      lines,
      phone,
      note,
      method,
      quote: delivery ? quote?.id : null,
      expected_total: total,
    };
    const cacheKey = "attempt:" + path;
    const previous = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    const signature = JSON.stringify(data);
    const key =
      previous?.signature === signature ? previous.key : crypto.randomUUID();
    sessionStorage.setItem(cacheKey, JSON.stringify({ signature, key }));
    const o = await api<{ id: string }>(path + "/orders", {
      ...data,
      request_id: key,
    });
    sessionStorage.removeItem(cacheKey);
    done(o.id);
  }
  return (
    <section className="panel">
      <h2>Giỏ hàng</h2>
      {!lines.length ? (
        <p>Giỏ đang trống. Chọn món trong thực đơn để bắt đầu.</p>
      ) : (
        <>
          {lines.map((l, i) => (
            <div className="line" key={i}>
              <div>
                <strong>
                  {l.qty} × {l.name}
                </strong>
                <small>
                  {[...l.toppings, l.note].filter(Boolean).join(" · ")}
                </small>
              </div>
              <span>{money(l.unit * l.qty)}</span>
              <button onClick={() => remove(i)} aria-label={"Bỏ " + l.name}>
                Bỏ
              </button>
            </div>
          ))}
          {!signed ? (
            <button onClick={login}>Đăng nhập để đặt món</button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(checkout);
              }}
            >
              <label>
                Cách nhận
                <select
                  value={delivery ? "delivery" : "pickup"}
                  onChange={(e) => setDelivery(e.target.value === "delivery")}
                >
                  <option value="pickup">Đến quán lấy</option>
                  <option value="delivery">Giao tận nhà</option>
                </select>
              </label>
              {delivery && (
                <>
                  <label>
                    Địa chỉ giao
                    <input
                      required
                      disabled={busy}
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        setQuote(null);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        setQuote(
                          await api<Quote>(path + "/quote", { address }),
                        ),
                      )
                    }
                  >
                    Tính phí giao
                  </button>
                  {quote && (
                    <p>
                      {quote.address} · {(quote.meters / 1000).toFixed(2)} km ·{" "}
                      {money(quote.fee)}
                    </p>
                  )}
                </>
              )}
              <label>
                Số điện thoại nhận món
                <input
                  required
                  type="tel"
                  pattern="[+0-9]{8,16}"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label>
                Ghi chú cho quán
                <textarea
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <label>
                Thanh toán
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="cash">Tiền mặt khi nhận</option>
                  {shop.qr && (
                    <option value="qr">QR sau khi quán chốt đơn</option>
                  )}
                </select>
              </label>
              <div className="row">
                <strong>Tổng cộng</strong>
                <b>{money(total)}</b>
              </div>
              <button
                className="primary"
                disabled={busy || (delivery && !quote)}
              >
                {busy ? "Đang xử lý…" : "Đặt hàng"}
              </button>
            </form>
          )}
        </>
      )}
      <p role="alert">{err}</p>
    </section>
  );
}
