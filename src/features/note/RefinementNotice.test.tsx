import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RefinementNotice } from "./RefinementNotice";

describe("RefinementNotice", () => {
  it("counts parts while they are being written", () => {
    render(
      <RefinementNotice stage={{ kind: "summarising", window: 3, total: 8, combining: false }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("writing notes (part 3 of 8)");
  });

  it("says when the parts are being combined, instead of sitting on the last part", () => {
    render(
      <RefinementNotice stage={{ kind: "summarising", window: 8, total: 8, combining: true }} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("combining 8 parts");
    expect(status).not.toHaveTextContent("part 8 of 8");
  });
});
