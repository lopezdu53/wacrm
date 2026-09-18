import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BottomDrawer } from "./bottom-drawer";

describe("BottomDrawer", () => {
  it("renders nothing when closed so it cannot crash the shell", () => {
    const html = renderToStaticMarkup(
      <BottomDrawer open={false} onClose={() => {}} title="Perfil">
        <p>body</p>
      </BottomDrawer>,
    );
    expect(html).toBe("");
  });

  it("renders title and children when open", () => {
    const html = renderToStaticMarkup(
      <BottomDrawer open onClose={() => {}} title="Perfil">
        <p>Cerrar sesión</p>
      </BottomDrawer>,
    );
    expect(html).toContain("Perfil");
    expect(html).toContain("Cerrar sesión");
    expect(html).toContain("role=\"dialog\"");
  });

  it("does not throw if onClose is a mock", () => {
    expect(() =>
      renderToStaticMarkup(
        <BottomDrawer open={false} onClose={vi.fn()} title="x">
          x
        </BottomDrawer>,
      ),
    ).not.toThrow();
  });
});
