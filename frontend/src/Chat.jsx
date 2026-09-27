import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  "How have median prices in Pittsburgh changed since 2016?",
  "Which municipalities had the biggest price increases?",
  "Did the 2020 pandemic change the market? Compare before and after.",
  "Compare Mt. Lebanon, Upper St. Clair and Bethel Park.",
  "How reliable is this data? What was filtered out?",
];

const TOOL_LABELS = {
  sales_stats: "Queried sales statistics",
  price_change: "Computed price change",
  top_sales: "Looked up individual sales",
  find_names: "Looked up place names",
  data_quality_report: "Read the data-quality report",
};

function describeTool(t) {
  const args = Object.entries(t.input || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${TOOL_LABELS[t.name] ?? t.name}${args ? ` (${args})` : ""}`;
}

export default function Chat({ prompt }) {
  const [messages, setMessages] = useState([]); // {role, rounds: [], tools: [], error, pending}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  // Scroll only the chat log, never the page.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Questions sent from other panels (e.g. the map's "Ask Claude" button).
  useEffect(() => {
    if (prompt) send(prompt.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const finalText = (m) => (m.role === "user" ? m.text : (m.rounds.at(-1) ?? "").trim());

  async function send(question) {
    if (!question.trim() || busy) return;
    const history = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: finalText(m) }))
      .filter((m) => m.content);
    setInput("");
    setBusy(true);
    setMessages((ms) => [...ms, { role: "user", text: question }, { role: "assistant", rounds: [], tools: [], pending: true }]);

    const update = (fn) =>
      setMessages((ms) => {
        const copy = [...ms];
        copy[copy.length - 1] = fn({ ...copy[copy.length - 1] });
        return copy;
      });

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          update((m) => {
            if (ev.type === "text") {
              const rounds = [...m.rounds];
              rounds[ev.round] = (rounds[ev.round] ?? "") + ev.delta;
              return { ...m, rounds };
            }
            if (ev.type === "tool") return { ...m, tools: [...m.tools, ev] };
            if (ev.type === "error") return { ...m, error: ev.message };
            return m;
          });
        }
      }
    } catch (e) {
      update((m) => ({ ...m, error: e.message }));
    } finally {
      update((m) => ({ ...m, pending: false }));
      setBusy(false);
    }
  }

  return (
    <aside className="chat">
      <div className="chat-head">
        <h2>Ask about the data</h2>
        <p className="card-sub">Claude runs queries on the cleaned sales data and tells you how much to trust each answer.</p>
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg user">
              {m.text}
            </div>
          ) : (
            <div key={i} className="msg bot">
              {(m.tools.length > 0 || m.rounds.length > 1) && (
                <details className="steps" open={m.pending}>
                  <summary>
                    {m.pending ? "Working…" : `${m.tools.length} data ${m.tools.length === 1 ? "query" : "queries"}`}
                  </summary>
                  <ul>
                    {m.rounds.slice(0, -1).map((t, j) => t?.trim() && <li key={`r${j}`} className="muted">{t.trim()}</li>)}
                    {m.tools.map((t, j) => (
                      <li key={j} className={t.error ? "err" : ""}>
                        {describeTool(t)}
                        {t.error && ` failed: ${t.error}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {finalText(m) ? (
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalText(m)}</ReactMarkdown>
                </div>
              ) : (
                m.pending && !m.error && <div className="muted">Thinking…</div>
              )}
              {m.error && <div className="err">{m.error}</div>}
            </div>
          )
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What's the median price in Squirrel Hill ZIP 15217?"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
    </aside>
  );
}
