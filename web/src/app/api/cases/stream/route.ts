import { tick } from "@/lib/data/store";

/** docs/UI-SPEC.md's Watchfloor: "Real-time via SSE with a reconnect
 * strategy." This is the server half -- one event per tick, each tagged
 * with a `kind` (`new` | `update` | `fire`) the client dispatches on.
 * The reconnect strategy itself lives client-side (see
 * components/watchfloor/use-case-stream.ts): EventSource retries
 * natively, so there isn't a second thing to build here beyond not
 * leaking the interval when the client disconnects.
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ kind: "hello", atMs: Date.now() });

      const interval = setInterval(() => {
        try {
          send(tick());
        } catch {
          clearInterval(interval);
        }
      }, 700);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
