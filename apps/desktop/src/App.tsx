import { createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface PingResponse {
  message: string;
  core_version: string;
}

export default function App() {
  const [response, setResponse] = createSignal<PingResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function ping() {
    setError(null);
    try {
      const r = await invoke<PingResponse>("ping", { name: "anrry" });
      setResponse(r);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main class="shell">
      <header class="shell__header">
        <h1>OpenCherry</h1>
        <p class="shell__tagline">
          Multi-repo &times; multi-agent control tower &mdash; pre-alpha shell.
        </p>
      </header>

      <section class="shell__body">
        <button class="btn" onClick={ping}>
          Ping Rust core
        </button>

        <Show when={response()}>
          {(r) => (
            <pre class="result">
              {r().message}
              {"\n"}core v{r().core_version}
            </pre>
          )}
        </Show>

        <Show when={error()}>
          {(e) => <pre class="result result--error">{e()}</pre>}
        </Show>
      </section>
    </main>
  );
}
