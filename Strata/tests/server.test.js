import { strict as assert } from "node:assert";
import request from "supertest";
import { sanitizePath, app } from "../src/server.js";

describe("sanitizePath", () => {
  it("should return '/' for empty strings, null, or undefined", () => {
    assert.equal(sanitizePath(""), "/");
    assert.equal(sanitizePath(null), "/");
    assert.equal(sanitizePath(undefined), "/");
  });

  it("should return the original path if there is no query string", () => {
    assert.equal(sanitizePath("/api/logs"), "/api/logs");
    assert.equal(sanitizePath("/health"), "/health");
    assert.equal(sanitizePath("/"), "/");
  });

  it("should strip query strings and return the path", () => {
    assert.equal(sanitizePath("/api/logs?foo=bar"), "/api/logs");
    assert.equal(sanitizePath("/health?test=1&debug=true"), "/health");
    assert.equal(sanitizePath("/?search=query"), "/");
  });

  it("should handle paths without leading slashes (though Express usually provides them)", () => {
    assert.equal(sanitizePath("api/logs?foo=bar"), "api/logs");
    assert.equal(sanitizePath("health"), "health");
  });
});

describe("GET /api/logs", () => {
  beforeEach(async () => {
    await request(app).delete("/api/logs");
  });

  it("should return an empty array initially", async () => {
    // Note: The `DELETE /api/logs` request in beforeEach is itself logged!
    // So the log buffer will have 1 entry for the DELETE request.
    const response = await request(app).get("/api/logs");
    assert.equal(response.status, 200);
    // Since DELETE /api/logs logs itself when it finishes, we should check if
    // all logs are cleared before the NEXT request happens. Wait,
    // `logBuffer.length = 0` happens synchronously, but Express `res.on('finish')`
    // logs the DELETE request after `res.status(204).end()` is called.
    // So there is always exactly 1 log: the DELETE request itself!
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].method, "DELETE");
    assert.equal(response.body[0].path, "/api/logs");
  });

  it("should return log entries after requests are made", async () => {
    // Make a request to trigger logging
    await request(app).get("/health");

    // Retrieve the logs
    const response = await request(app).get("/api/logs");
    assert.equal(response.status, 200);

    assert.ok(Array.isArray(response.body), "Response body should be an array");
    assert.ok(response.body.length > 0, "Log buffer should not be empty");

    // The most recent log should be at the beginning (unshifted)
    const logEntry = response.body[0];
    assert.equal(logEntry.path, "/health");
    assert.equal(logEntry.method, "GET");
    assert.equal(logEntry.statusCode, 200);
  });
});
