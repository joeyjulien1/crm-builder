import { describe, expect, it } from "vitest";
import { readJsonLines } from "./stream";

describe("agent response stream", () => {
  it("preserves split UTF-8 and processes a patch without a trailing newline", async () => {
    const bytes = new TextEncoder().encode('{"type":"text","delta":"café"}\n\n{"type":"patch","patches":[1]}');
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const result = [];
    for await (const event of readJsonLines(stream)) result.push(event);
    expect(result).toEqual([{ type: "text", delta: "café" }, { type: "patch", patches: [1] }]);
  });
  it("surfaces a broken response instead of reporting a successful build", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"patch"')); controller.close(); } });
    await expect(async () => { for await (const event of readJsonLines(stream)) void event; }).rejects.toThrow();
  });
});
