import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

function ensureBrowserStorage(name: "localStorage" | "sessionStorage") {
  try {
    if (window[name]) return;
  } catch {}

  const values = new Map<string, string>();
  const fallback: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
  try {
    Object.defineProperty(window, name, { configurable: true, value: fallback });
  } catch {}
}

ensureBrowserStorage("localStorage");
ensureBrowserStorage("sessionStorage");

createRoot(document.getElementById("root")!).render(<App />);
