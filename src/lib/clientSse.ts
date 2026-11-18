"use client";

/** 消费 SSE Response，每收到一个完整事件调用一次 onEvent。 */
export async function consumeSse(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void
) {
  if (!res.body) throw new Error("响应不支持流式读取");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice("data: ".length)));
      } catch {
        // 忽略无法解析的事件
      }
    }
  }
}
