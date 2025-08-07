import React, { useEffect, useState } from "react";

const API_URL = (import.meta as any).env.VITE_API_URL as string;
const API_KEY = (import.meta as any).env.VITE_API_KEY as string;

export default function App() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/watchlist`);
        const data = await res.json();
        // items are stored as list of "name:address" strings
        const items = (data.items as string[]) ?? [];
        setValue(items.join("\n"));
      } catch (e) {
        setMsg("Failed to load watch list");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const onSave = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const items = value
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const res = await fetch(`${API_URL}/watchlist`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Error" }));
        throw new Error(error || `HTTP ${res.status}`);
      }
      setMsg("Saved");
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div
      style={{ maxWidth: 800, margin: "40px auto", fontFamily: "sans-serif" }}
    >
      <h1>Watch List</h1>
      <p>
        One item per line: <code>name:address</code>
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={18}
        style={{ width: "100%", fontFamily: "monospace" }}
        disabled={loading}
      />
      <div style={{ marginTop: 12 }}>
        <button onClick={onSave} disabled={loading}>
          {loading ? "Saving..." : "Save"}
        </button>
        {msg && <span style={{ marginLeft: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
