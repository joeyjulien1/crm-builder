import { describe, expect, it } from "vitest";
import { classifyMime, MAX_UPLOAD_BYTES, validateUpload } from "./files";

const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
const csvBase64 = Buffer.from("name,email\nAda,ada@example.com\n", "utf8").toString("base64");

describe("upload validation", () => {
  it("accepts an image upload", () => {
    const result = validateUpload({ filename: "logo.png", mimeType: "image/png", data: pngBase64 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("rejected");
    expect(result.upload.kind).toBe("image");
    expect(result.upload.byteSize).toBe(8);
    // Images stay base64 in storage.
    expect(result.upload.storage).toBe(pngBase64);
  });

  it("keeps data uploads as raw text for the import reader", () => {
    const result = validateUpload({ filename: "leads.csv", mimeType: "text/csv", data: csvBase64 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("rejected");
    expect(result.upload.kind).toBe("data");
    expect(result.upload.storage).toBe("name,email\nAda,ada@example.com\n");
  });

  it("rejects an executable masquerading as an upload", () => {
    const result = validateUpload({
      filename: "run.exe",
      mimeType: "application/x-msdownload",
      data: pngBase64,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file and a path traversal filename", () => {
    expect(validateUpload({ filename: "empty.png", mimeType: "image/png", data: "" }).ok).toBe(false);
    expect(
      validateUpload({ filename: "../evil.png", mimeType: "image/png", data: pngBase64 }).ok,
    ).toBe(false);
  });

  it("rejects anything over the size cap", () => {
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64");
    const result = validateUpload({ filename: "big.png", mimeType: "image/png", data: oversized });
    expect(result.ok).toBe(false);
  });

  it("classifies only the allowlisted mime types", () => {
    expect(classifyMime("image/jpeg")).toBe("image");
    expect(classifyMime("text/csv")).toBe("data");
    expect(classifyMime("application/pdf")).toBeNull();
  });
});
