import { describe, expect, it } from "vitest";
import { BadRequest, parseScanRequest } from "../lib/analyze";
import { MAX_UPLOAD_BYTES, tooLargeMessage } from "../lib/scanner/walk";

describe("upload size limit", () => {
  it("accepts a normal project", () => {
    const req = parseScanRequest({ projectName: "app", files: [{ path: "index.js", content: "console.log(1);\n" }] });
    expect(req.files).toHaveLength(1);
  });

  it("rejects a project over the limit with a plain-English message", () => {
    const half = "a".repeat(MAX_UPLOAD_BYTES / 2 + 1);
    const body = { files: [{ path: "a.js", content: half }, { path: "b.js", content: half }] };
    expect(() => parseScanRequest(body)).toThrow(BadRequest);
    expect(() => parseScanRequest(body)).toThrow(/too much code to scan.*limit is 4\.0 MB/);
  });

  it("explains how to make the upload smaller", () => {
    expect(tooLargeMessage(6.2 * 1024 * 1024)).toContain("about 6.2 MB");
    expect(tooLargeMessage()).toContain("Zip just your app's source folder");
  });
});
