import { useState } from "react";
import { auth, reason } from "./api";

export function Account({ signed }: { signed: boolean }) {
  const [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(reason(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(m: string) {
    setMode(m);
    setSent(false);
    setCode("");
    setMsg("");
    setPassword("");
  }
  async function submit() {
    const tel = phone.trim().replace(/^0/, "+84");
    if (mode === "login") {
      const r = await auth.auth.signInWithPassword({ email, password });
      if (r.error) throw r.error;
    }
    if (mode === "linkEmail") {
      const r = await auth.auth.updateUser(
        { email },
        { emailRedirectTo: location.href },
      );
      if (r.error) throw r.error;
      setMsg("Mở email để xác nhận liên kết.");
      return;
    }
    if (mode === "register") {
      const r = await auth.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.href },
      });
      if (r.error) throw r.error;
      setMsg("Kiểm tra email để xác minh tài khoản.");
    }
    if (mode === "sms" || mode === "recoverSms" || mode === "linkPhone") {
      if (!sent) {
        const r =
          mode === "linkPhone"
            ? await auth.auth.updateUser({ phone: tel })
            : await auth.auth.signInWithOtp({
                phone: tel,
                options: { shouldCreateUser: mode === "sms" },
              });
        if (r.error) throw r.error;
        setSent(true);
        setMsg("Nhập mã vừa gửi qua SMS.");
        return;
      }
      const r = await auth.auth.verifyOtp({
        phone: tel,
        token: code,
        type: mode === "linkPhone" ? "phone_change" : "sms",
      });
      if (r.error) throw r.error;
      if (mode === "recoverSms") {
        const u = await auth.auth.updateUser({ password });
        if (u.error) throw u.error;
        await auth.auth.signOut({ scope: "global" });
      }
      choose("login");
      setMsg("Đã xác minh.");
      return;
    }
    if (mode === "recover") {
      if (!sent) {
        const r = await auth.auth.resetPasswordForEmail(email);
        if (r.error) throw r.error;
        setSent(true);
        setMsg("Nếu email hợp lệ, bạn sẽ nhận được mã xác nhận.");
        return;
      }
      const r = await auth.auth.verifyOtp({
        email,
        token: code,
        type: "recovery",
      });
      if (r.error) throw r.error;
      const u = await auth.auth.updateUser({ password });
      if (u.error) throw u.error;
      await auth.auth.signOut({ scope: "global" });
      choose("login");
      setMsg("Đã đổi mật khẩu. Hãy đăng nhập lại.");
    }
  }
  const recovery = mode === "recover" || mode === "recoverSms";
  const sms = ["sms", "recoverSms", "linkPhone"].includes(mode);
  return (
    <section className="panel">
      <h2>Tài khoản</h2>
      {signed && !recovery ? (
        <>
          <p>Bạn đã đăng nhập.</p>
          <button
            onClick={() =>
              run(async () => {
                const r = await auth.auth.signOut();
                if (r.error) throw r.error;
                choose("login");
              })
            }
          >
            Đăng xuất
          </button>
          <button onClick={() => choose("linkEmail")}>Liên kết email</button>
          <button onClick={() => choose("linkPhone")}>
            Liên kết số điện thoại
          </button>
          <button
            onClick={() =>
              run(async () => {
                const r = await auth.auth.linkIdentity({
                  provider: "google",
                  options: { redirectTo: location.href },
                });
                if (r.error) throw r.error;
              })
            }
          >
            Liên kết Google
          </button>
        </>
      ) : (
        <div className="tabs">
          {Object.entries({
            login: "Đăng nhập",
            register: "Đăng ký",
            sms: "SMS OTP",
            recover: "Quên mật khẩu qua email",
            recoverSms: "Khôi phục qua SMS",
          }).map(([k, v]) => (
            <button
              key={k}
              className={mode === k ? "active" : ""}
              onClick={() => choose(k)}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      {(!signed ||
        recovery ||
        mode === "linkPhone" ||
        mode === "linkEmail") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(submit);
          }}
        >
          {sms ? (
            <label>
              Số điện thoại
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          ) : (
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {sent && (
            <label>
              Mã xác nhận
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          {(["login", "register"].includes(mode) || (recovery && sent)) && (
            <label>
              {recovery ? "Mật khẩu mới" : "Mật khẩu"}
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "login" ? 1 : 10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Đang xử lý…"
              : sent
                ? "Xác nhận"
                : mode === "login"
                  ? "Đăng nhập"
                  : mode === "register"
                    ? "Tạo tài khoản"
                    : "Gửi mã"}
          </button>
        </form>
      )}
      {!signed && (
        <button
          onClick={() =>
            run(async () => {
              const r = await auth.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: location.href },
              });
              if (r.error) throw r.error;
            })
          }
        >
          Tiếp tục với Google
        </button>
      )}
      <p role="status">{msg}</p>
    </section>
  );
}
