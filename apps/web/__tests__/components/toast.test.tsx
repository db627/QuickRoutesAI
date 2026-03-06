import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { ToastProvider, useToast } from "@/lib/toast-context";
import type { ToastVariant } from "@/lib/toast-context";

// ── Shared test helpers ────────────────────────────────────────────────────

/**
 * Renders a ToastProvider with a single button that fires one toast variant.
 * Immediately clicks the button so the toast is visible on return.
 */
function renderToast(variant: ToastVariant, message: string) {
  function Trigger() {
    const { toast } = useToast();
    return <button onClick={() => toast[variant](message)}>trigger</button>;
  }
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "trigger" }));
}

/**
 * Renders a ToastProvider with a counter button.
 * Each click fires a uniquely-named success toast ("Toast 1", "Toast 2", …).
 * Returns the trigger button for convenience.
 */
function renderMultiTrigger() {
  function MultiTrigger() {
    const { toast } = useToast();
    const [n, setN] = useState(0);
    return (
      <button
        onClick={() => {
          const next = n + 1;
          setN(next);
          toast.success(`Toast ${next}`);
        }}
      >
        trigger
      </button>
    );
  }
  render(
    <ToastProvider>
      <MultiTrigger />
    </ToastProvider>,
  );
  return screen.getByRole("button", { name: "trigger" });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Toast notification system", () => {
  // Use fake timers for the whole suite so auto-dismiss timers never fire
  // unexpectedly mid-test and setState-after-unmount warnings are avoided.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders nothing when no toast has been triggered", () => {
      render(
        <ToastProvider>
          <div />
        </ToastProvider>,
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("displays the toast message text", () => {
      renderToast("success", "Trip created successfully");
      expect(screen.getByText("Trip created successfully")).toBeInTheDocument();
    });

    it("renders the toast with role=alert", () => {
      renderToast("info", "Hello");
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("renders a dismiss button on every toast", () => {
      renderToast("error", "Something broke");
      expect(
        screen.getByRole("button", { name: "Dismiss notification" }),
      ).toBeInTheDocument();
    });
  });

  // ── Variant styles ───────────────────────────────────────────────────────

  describe("variant styles", () => {
    it.each<[ToastVariant, string, string]>([
      ["success", "bg-green-500", "Success"],
      ["error", "bg-red-500", "Error"],
      ["info", "bg-blue-500", "Info"],
    ])(
      "%s: applies the correct accent-strip colour and aria-label prefix",
      (variant, stripClass, labelPrefix) => {
        renderToast(variant, "test message");

        const alert = screen.getByRole("alert");

        // Accessible label encodes both the variant and the message
        expect(alert).toHaveAttribute(
          "aria-label",
          `${labelPrefix}: test message`,
        );

        // The coloured left-edge strip is a <div aria-hidden="true"> — the
        // first child of the alert. querySelector scopes to div elements only
        // so the <svg aria-hidden> icon is not accidentally matched.
        const strip = alert.querySelector("div[aria-hidden='true']");
        expect(strip).not.toBeNull();
        expect(strip!.className).toContain(stripClass);
      },
    );
  });

  // ── Auto-dismiss ─────────────────────────────────────────────────────────

  describe("auto-dismiss", () => {
    it("removes the toast after exactly 5 seconds", () => {
      renderToast("success", "Gone soon");
      expect(screen.getByRole("alert")).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the toast visible while less than 5 seconds have elapsed", () => {
      renderToast("error", "Still visible");

      act(() => {
        jest.advanceTimersByTime(4999);
      });

      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  // ── Close button ─────────────────────────────────────────────────────────

  describe("close button", () => {
    it("dismisses the toast immediately when × is clicked", () => {
      renderToast("success", "Close me");
      expect(screen.getByRole("alert")).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss notification" }),
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("only removes the toast whose × was clicked", () => {
      const btn = renderMultiTrigger();

      fireEvent.click(btn); // Toast 1
      fireEvent.click(btn); // Toast 2

      expect(screen.getAllByRole("alert")).toHaveLength(2);

      // Dismiss the first toast in the stack
      fireEvent.click(
        screen.getAllByRole("button", { name: "Dismiss notification" })[0],
      );

      const remaining = screen.getAllByRole("alert");
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toHaveTextContent("Toast 2");
    });
  });

  // ── Max 3 visible ────────────────────────────────────────────────────────

  describe("max 3 visible", () => {
    it("never shows more than 3 toasts at once", () => {
      const btn = renderMultiTrigger();

      fireEvent.click(btn); // Toast 1
      fireEvent.click(btn); // Toast 2
      fireEvent.click(btn); // Toast 3
      fireEvent.click(btn); // Toast 4 — should evict Toast 1

      expect(screen.getAllByRole("alert")).toHaveLength(3);
    });

    it("evicts the oldest toast when the cap is exceeded", () => {
      const btn = renderMultiTrigger();

      fireEvent.click(btn); // Toast 1
      fireEvent.click(btn); // Toast 2
      fireEvent.click(btn); // Toast 3
      fireEvent.click(btn); // Toast 4 — evicts Toast 1

      expect(screen.queryByText("Toast 1")).not.toBeInTheDocument();
      expect(screen.getByText("Toast 2")).toBeInTheDocument();
      expect(screen.getByText("Toast 3")).toBeInTheDocument();
      expect(screen.getByText("Toast 4")).toBeInTheDocument();
    });
  });
});
