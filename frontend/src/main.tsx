import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [status, setStatus] = useState("Đang kiểm tra kết nối…");

  useEffect(() => {
    async function checkConnection() {
      try {
        const response = await fetch("/api/health");
        const connected = response.ok && (await response.text()) === "ok";
        setStatus(connected ? "Đã kết nối backend." : "Chưa kết nối được backend.");
      } catch {
        setStatus("Chưa kết nối được backend.");
      }
    }
    void checkConnection();
  }, []);

  return (
    <main>
      <h1>Quán ăn của Dì</h1>
      <p role="status">{status}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
