import { useState } from "react";
import { api, reason, money, type Shop, type Item, type Topping } from "./api";

interface PushSDK {
  init: (o: object) => Promise<void>;
  Notifications: { requestPermission: () => Promise<void> };
  User: { PushSubscription: { id: string | null; optIn: () => Promise<void> } };
}
declare global {
  interface Window {
    OneSignalDeferred?: Array<(sdk: PushSDK) => void>;
  }
}
let sdkReady: Promise<PushSDK> | undefined;
function loadPush(appId: string) {
  if (!sdkReady)
    sdkReady = new Promise<PushSDK>((resolve, reject) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (sdk) => {
        try {
          await sdk.init({ appId, allowLocalhostAsSecureOrigin: true });
          resolve(sdk);
        } catch (e) {
          reject(e);
        }
      });
      const s = document.createElement("script");
      s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
      s.onerror = () => reject(Error("Không tải được dịch vụ thông báo."));
      document.head.append(s);
    });
  return sdkReady;
}
export function Admin({
  shop,
  path,
  reload,
  push,
}: {
  shop: Shop;
  path: string;
  reload: () => Promise<void>;
  push: string;
}) {
  const [edit, setEdit] = useState<Item | null | undefined>(undefined),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const [free, setFree] = useState(shop.free_m),
    [rate, setRate] = useState(shop.per_km);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      await reload();
      setMsg("Đã cập nhật.");
    } catch (e) {
      setMsg(reason(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="row">
        <h2>Quản lý quán</h2>
        <button className="primary" onClick={() => setEdit(null)}>
          Thêm món
        </button>
      </div>
      {edit !== undefined && (
        <Editor
          key={edit?.id || "new"}
          item={edit}
          cancel={() => setEdit(undefined)}
          submit={(data) =>
            run(async () => {
              await api(path + "/items", data);
              setEdit(undefined);
            })
          }
          busy={busy}
        />
      )}
      {shop.items.map((i) => (
        <div className="line" key={i.id}>
          <div>
            <b>{i.name}</b>
            <small>
              {money(i.price)} · Còn {i.stock}
            </small>
          </div>
          <button onClick={() => setEdit(i)}>Sửa</button>
          <button
            disabled={busy || !i.stock}
            onClick={() =>
              run(async () => {
                await api(path + "/counter/" + i.id, {});
              })
            }
          >
            Bán tại quầy −1
          </button>
        </div>
      ))}
      <details>
        <summary>Phí giao và thông báo</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(path + "/settings", { free_m: free, per_km: rate });
            });
          }}
        >
          <label>
            Miễn phí trong phạm vi (m)
            <input
              required
              type="number"
              min="0"
              value={free}
              onChange={(e) => setFree(+e.target.value)}
            />
          </label>
          <label>
            Phí mỗi km tiếp theo (đ)
            <input
              type="number"
              min="0"
              required
              value={rate}
              onChange={(e) => setRate(+e.target.value)}
            />
          </label>
          <button disabled={busy}>Lưu phí giao</button>
        </form>
        {push ? (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const sdk = await loadPush(push);
                await sdk.Notifications.requestPermission();
                await sdk.User.PushSubscription.optIn();
                const device = sdk.User.PushSubscription.id;
                if (!device)
                  throw Error(
                    "Chưa có quyền thông báo. Kiểm tra quyền trình duyệt rồi thử lại.",
                  );
                await api(path + "/subscription", { device });
              })
            }
          >
            Nhận báo đơn trên thiết bị này
          </button>
        ) : (
          <p>Thông báo đẩy chưa được cấu hình.</p>
        )}
      </details>
      <p role="status">{msg}</p>
    </section>
  );
}
function Editor({
  item,
  cancel,
  submit,
  busy,
}: {
  item: Item | null;
  cancel: () => void;
  submit: (v: object) => Promise<void>;
  busy: boolean;
}) {
  const [tops, setTops] = useState<Topping[]>(item?.toppings || []);
  function update(i: number, t: Partial<Topping>) {
    setTops(tops.map((v, k) => (k === i ? { ...v, ...t } : v)));
  }
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({
          id: item?.id,
          name: f.get("name"),
          description: f.get("description"),
          price: Number(f.get("price")),
          stock_delta: Number(f.get("stock")),
          photo: f.get("photo"),
          toppings: tops,
        });
      }}
    >
      <h3>{item ? "Sửa món" : "Món mới"}</h3>
      <label>
        Tên món
        <input name="name" required defaultValue={item?.name} />
      </label>
      <label>
        Mô tả
        <textarea name="description" defaultValue={item?.description} />
      </label>
      <label>
        Ảnh món (đường dẫn HTTPS)
        <input type="url" name="photo" defaultValue={item?.photo} />
      </label>
      <label>
        Giá mỗi phần (đ)
        <input
          name="price"
          type="number"
          required
          min="0"
          defaultValue={item?.price ?? 0}
        />
      </label>
      <label>
        {item ? "Điều chỉnh tồn (+ thêm / − bớt)" : "Số phần ban đầu"}
        <input type="number" name="stock" required defaultValue="0" />
      </label>
      <h4>Topping</h4>
      {tops.map((t, i) => (
        <fieldset key={i}>
          <label>
            Tên
            <input
              required
              value={t.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
          </label>
          <label>
            Giá thêm (đ)
            <input
              type="number"
              min="0"
              value={t.price}
              onChange={(e) => update(i, { price: +e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={t.available}
              onChange={(e) => update(i, { available: e.target.checked })}
            />
            Còn topping
          </label>
          <button
            type="button"
            onClick={() => setTops(tops.filter((_, k) => k !== i))}
          >
            Xóa topping
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setTops([...tops, { name: "", price: 0, available: true }])
        }
      >
        Thêm topping
      </button>
      <div>
        <button className="primary" disabled={busy}>
          Lưu món
        </button>
        <button type="button" onClick={cancel}>
          Đóng
        </button>
      </div>
    </form>
  );
}
