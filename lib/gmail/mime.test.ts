import { describe, expect, it } from "vitest";
import { buildMultipartEmailWithAttachments } from "./mime";

describe("buildMultipartEmailWithAttachments", () => {
  it("builds multipart/mixed MIME with plain, html, and PDF attachment", () => {
    const pdfBytes = Buffer.from("%PDF-1.4 test");
    const mime = buildMultipartEmailWithAttachments({
      from: "advisor@firm.com",
      to: "client@example.com",
      subject: "Portfolio review",
      plainBody: "Hi Client,\n\nSee attached.",
      htmlBody: "<p>Hi Client,</p><p>See attached.</p>",
      attachments: [
        {
          filename: "Client_Snapshot.pdf",
          contentType: "application/pdf",
          contentBytes: pdfBytes.toString("base64"),
        },
      ],
    });

    expect(mime).toContain('Content-Type: multipart/mixed; boundary="ap_mixed_');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="ap_alt_');
    expect(mime).toContain("Content-Disposition: attachment; filename=\"Client_Snapshot.pdf\"");
    expect(mime).toContain("Content-Type: application/pdf; name=\"Client_Snapshot.pdf\"");
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    expect(mime).toContain(pdfBytes.toString("base64").slice(0, 20));
    expect(mime).toContain("From: advisor@firm.com");
    expect(mime).toContain("To: client@example.com");
    expect(mime).toContain("Subject: Portfolio review");
  });
});
