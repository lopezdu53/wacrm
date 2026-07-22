import { describe, it, expect } from "vitest";

import {
  extractFirstUrl,
  youTubeVideoId,
  looksLikePdf,
  urlHostname,
} from "./link-preview";

describe("extractFirstUrl", () => {
  it("returns null when there is no URL", () => {
    expect(extractFirstUrl("just some text")).toBeNull();
    expect(extractFirstUrl("")).toBeNull();
    expect(extractFirstUrl(null)).toBeNull();
  });

  it("grabs the first http(s) URL", () => {
    expect(extractFirstUrl("check https://example.com/page now")).toBe(
      "https://example.com/page",
    );
    expect(extractFirstUrl("http://a.com and https://b.com")).toBe("http://a.com");
  });

  it("trims trailing sentence punctuation", () => {
    expect(extractFirstUrl("see https://example.com.")).toBe("https://example.com");
    expect(extractFirstUrl("(https://example.com/x)")).toBe("https://example.com/x");
  });
});

describe("youTubeVideoId", () => {
  it("parses watch, short, embed, shorts URLs", () => {
    expect(youTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(youTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(youTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("returns null for non-YouTube or malformed links", () => {
    expect(youTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youTubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youTubeVideoId("not a url")).toBeNull();
  });
});

describe("looksLikePdf", () => {
  it("detects a PDF by filename or url", () => {
    expect(looksLikePdf("Factura-FV-2-2203.pdf", null)).toBe(true);
    expect(looksLikePdf(null, "https://x.co/a/b.pdf")).toBe(true);
    expect(looksLikePdf(null, "https://x.co/a/b.pdf?token=1")).toBe(true);
  });

  it("is false for non-PDFs", () => {
    expect(looksLikePdf("photo.jpg", "https://x.co/photo.jpg")).toBe(false);
    expect(looksLikePdf(null, null)).toBe(false);
  });
});

describe("urlHostname", () => {
  it("strips www and returns the host", () => {
    expect(urlHostname("https://www.example.com/x")).toBe("example.com");
    expect(urlHostname("https://sub.example.com")).toBe("sub.example.com");
  });
});
