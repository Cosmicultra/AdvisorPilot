import { describe, expect, it } from "vitest";
import { toActivityEntry } from "./activity-adapter";

describe("toActivityEntry client.updated", () => {
  it("uses metadata changedSections in title", () => {
    const entry = toActivityEntry({
      id: "1",
      source: "audit_event",
      client_id: "c1",
      owner_email: "a@b.com",
      type: "client.updated",
      title: "client.updated",
      body: null,
      actor_email: "a@b.com",
      metadata: { changedSections: ["Holdings", "Client profile"] },
      occurred_at: "2026-01-01T00:00:00Z",
    });
    expect(entry.title).toBe("Client updated: Holdings, Client profile");
  });
});
