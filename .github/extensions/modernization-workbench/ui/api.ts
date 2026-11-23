const token = document.querySelector<HTMLMetaElement>('meta[name="workbench-token"]')?.content;
if (!token || token === "__WORKBENCH_TOKEN__") throw new Error("Open this workbench through its authenticated canvas.");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function decode<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `Request failed (${response.status}).`);
  return body as T;
}

export function state<T>(): Promise<T> {
  return fetch("/api/state", { headers }).then(decode<T>);
}

export function act<T>(name: string, input: unknown): Promise<T> {
  return fetch(name === "import_files" ? "/api/import" : "/api/action", { method: "POST", headers, body: JSON.stringify({ name, input }) }).then(decode<T>);
}

export function listen(changed: () => void, failed: (error: Error) => void) {
  const controller = new AbortController();
  void (async () => {
    const response = await fetch("/api/events", { headers, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("Live updates are unavailable. Use Refresh.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";
      for (const message of messages) if (message.includes('"changed":true')) changed();
    }
    if (!controller.signal.aborted) throw new Error("Live updates disconnected. Use Refresh.");
  })().catch(error => { if (!controller.signal.aborted) failed(error instanceof Error ? error : new Error("Live updates failed.")); });
  return () => controller.abort();
}
