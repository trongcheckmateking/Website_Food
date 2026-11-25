import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  configure,
  auth,
  api,
  reason,
  type Config,
  type Line,
  type Shop,
} from "./api";
import { Account } from "./Account";
import { Admin } from "./Admin";
import { Menu, Cart } from "./Menu";
import { Orders } from "./Orders";
import "./style.css";

function Store({ config, slug }: { config: Config; slug: string }) {
  const path = "shop/" + encodeURIComponent(slug);
  const [shop, setShop] = useState<Shop | null>(null),
    [tab, setTab] = useState("menu"),
    [who, setWho] = useState<string | null>(null);
  const [err, setErr] = useState(""),
    [selected, select] = useState(""),
    [notice, setNotice] = useState("");
  const storage = "cart:" + slug;
  const [lines, setLines] = useState<Line[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storage) || "[]");
    } catch {
      return [];
    }
  });
  const reload = useCallback(async () => {
    setShop(await api<Shop>(path));
    setErr("");
  }, [path]);
  useEffect(() => {
    const { data } = auth.auth.onAuthStateChange((_e, s) =>
      setWho(s?.user.id ?? ""),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (who === null) return;
    void reload().catch((e) => setErr(reason(e)));
    const timer = setInterval(() => {
      void reload().catch((e) => setErr(reason(e)));
    }, 20000);
    return () => clearInterval(timer);
  }, [who, reload]);
  useEffect(() => {
    sessionStorage.setItem(storage, JSON.stringify(lines));
  }, [lines, storage]);
  const nav = (t: string) => {
    setTab(t);
    setNotice("");
    if (t === "orders") select("");
  };
  return (
    <>
      <header>
        <div className="wrap">
          <a href={"/quan/" + encodeURIComponent(slug)} className="brand">
            {shop?.name || "Quán ăn"}
          </a>
          <nav aria-label="Điều hướng">
            {Object.entries({
              menu: "Thực đơn",
              cart: "Giỏ (" + lines.reduce((n, l) => n + l.qty, 0) + ")",
              ...(who ? { orders: "Đơn hàng" } : {}),
              ...(who && shop?.owner ? { admin: "Quản lý" } : {}),
              account: "Tài khoản",
            }).map(([k, v]) => (
              <button
                className={tab === k ? "active" : ""}
                key={k}
                onClick={() => nav(k)}
              >
                {v}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="wrap">
        <p role="alert">{err}</p>
        {notice && (
          <div className="notice" role="status">
            {notice} <button onClick={() => nav("cart")}>Xem giỏ</button>
          </div>
        )}
        {tab === "account" ? (
          <Account signed={!!who} />
        ) : !shop ? (
          <p>{err ? "Không thể mở quán." : "Đang mở thực đơn…"}</p>
        ) : (
          <>
            {tab === "menu" && (
              <Menu
                shop={shop}
                add={(l) => {
                  setLines((prev) => [...prev, l]);
                  setNotice("Đã thêm " + l.name + " vào giỏ.");
                }}
              />
            )}
            {tab === "cart" && (
              <Cart
                shop={shop}
                path={path}
                lines={lines}
                remove={(i) => setLines(lines.filter((_, k) => i !== k))}
                signed={!!who}
                login={() => nav("account")}
                done={(i) => {
                  setLines([]);
                  setTab("orders");
                  select(i);
                  void reload().catch((e) => setErr(reason(e)));
                }}
              />
            )}
            {tab === "orders" && who && (
              <Orders path={path} selected={selected} select={select} />
            )}
            {tab === "admin" && who && shop.owner && (
              <Admin
                shop={shop}
                path={path}
                push={config.push}
                reload={reload}
              />
            )}
          </>
        )}
      </main>
    </>
  );
}
const root = createRoot(document.getElementById("root")!);
configure()
  .then((config) => {
    const match = location.pathname.match(/^\/quan\/([a-z0-9-]+)\/?$/);
    if (match) root.render(<Store config={config} slug={match[1]} />);
    else if (location.pathname === "/" && config.shop)
      location.replace(
        "/quan/" +
          encodeURIComponent(config.shop) +
          location.search +
          location.hash,
      );
    else
      root.render(
        <main>
          <h1>Quán ăn</h1>
          <p>Mở đường dẫn riêng do quán gửi để xem thực đơn.</p>
        </main>,
      );
  })
  .catch((e) => root.render(<p role="alert">{reason(e)}</p>));
