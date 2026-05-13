import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";

function baseRequest(overrides: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return {
    title: "Discard changes?",
    body: "README.md",
    confirmLabel: "Discard changes",
    confirmTone: "danger",
    onConfirm: vi.fn(),
    ...overrides,
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
}

describe("ConfirmDialog", () => {
  it("renders nothing when request is null", () => {
    const { container } = render(() => (
      <ConfirmDialog request={null} onClose={() => {}} />
    ));
    expect(container.querySelector(".confirm-dialog__overlay")).toBeNull();
  });

  it("renders title and body when request is provided", () => {
    render(() => (
      <ConfirmDialog request={baseRequest()} onClose={() => {}} />
    ));
    expect(screen.getByText("Discard changes?")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("focuses Cancel on mount", async () => {
    render(() => (
      <ConfirmDialog request={baseRequest()} onClose={() => {}} />
    ));
    await flushMicrotasks();
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(() => (
      <ConfirmDialog request={baseRequest()} onClose={onClose} />
    ));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when overlay is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <ConfirmDialog request={baseRequest()} onClose={onClose} />
    ));
    const overlay = container.querySelector(
      ".confirm-dialog__overlay",
    ) as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when the panel itself is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <ConfirmDialog request={baseRequest()} onClose={onClose} />
    ));
    const panel = container.querySelector(
      ".confirm-dialog__panel",
    ) as HTMLElement;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onConfirm when the destructive button is clicked", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(() => (
      <ConfirmDialog
        request={baseRequest({ onConfirm })}
        onClose={onClose}
      />
    ));
    fireEvent.click(screen.getByText("Discard changes"));
    await flushMicrotasks();
    await flushMicrotasks();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error banner and a Close button when onConfirm rejects", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    render(() => (
      <ConfirmDialog
        request={baseRequest({ onConfirm })}
        onClose={onClose}
      />
    ));
    fireEvent.click(screen.getByText("Discard changes"));
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(screen.getByRole("alert").textContent).toContain("boom");
    expect(screen.getByText("Close")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
