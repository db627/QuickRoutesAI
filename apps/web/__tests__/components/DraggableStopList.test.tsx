import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DraggableStopList from "@/components/DraggableStopList";
import type { TripStop } from "@quickroutesai/shared";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockApiFetch = jest.fn();
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Fixture ────────────────────────────────────────────────────────────────

function makeStops(): TripStop[] {
  return [
    { stopId: "s1", address: "Alpha St", contactName: "", lat: 40, lng: -74, sequence: 0, notes: "" },
    { stopId: "s2", address: "Bravo Ave", contactName: "", lat: 41, lng: -75, sequence: 1, notes: "" },
    { stopId: "s3", address: "Charlie Rd", contactName: "", lat: 42, lng: -76, sequence: 2, notes: "" },
  ];
}

function getAddressLines() {
  return screen
    .getAllByRole("listitem")
    .map((li) => within(li).getByText(/St|Ave|Rd/).textContent);
}

describe("DraggableStopList", () => {
  it("renders stops in sequence order", () => {
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride />);
    expect(getAddressLines()).toEqual(["Alpha St", "Bravo Ave", "Charlie Rd"]);
  });

  it("hides reorder controls when canOverride is false", () => {
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride={false} />);
    expect(screen.queryByRole("button", { name: /reorder manually/i })).not.toBeInTheDocument();
  });

  it("enters reorder mode and exposes up/down buttons per stop", async () => {
    const user = userEvent.setup();
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride />);

    await user.click(screen.getByRole("button", { name: /reorder manually/i }));

    // 3 up + 3 down buttons (disabled on edges, but present)
    expect(screen.getAllByTitle("Move up")).toHaveLength(3);
    expect(screen.getAllByTitle("Move down")).toHaveLength(3);
    // First up and last down are disabled
    expect(screen.getAllByTitle("Move up")[0]).toBeDisabled();
    const downs = screen.getAllByTitle("Move down");
    expect(downs[downs.length - 1]).toBeDisabled();
  });

  it("reorders via up/down buttons without POSTing until save", async () => {
    const user = userEvent.setup();
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride />);

    await user.click(screen.getByRole("button", { name: /reorder manually/i }));

    // Move Charlie up to position 2
    await user.click(screen.getAllByTitle("Move up")[2]);
    expect(getAddressLines()).toEqual(["Alpha St", "Charlie Rd", "Bravo Ave"]);

    // Move Charlie up again to position 1
    await user.click(screen.getAllByTitle("Move up")[1]);
    expect(getAddressLines()).toEqual(["Charlie Rd", "Alpha St", "Bravo Ave"]);

    // No POST yet
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("Save button is disabled while order is unchanged", async () => {
    const user = userEvent.setup();
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride />);

    await user.click(screen.getByRole("button", { name: /reorder manually/i }));
    expect(screen.getByRole("button", { name: /save reordering/i })).toBeDisabled();
  });

  it("opens a reason prompt on Save; confirm is disabled until reason entered", async () => {
    const user = userEvent.setup();
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride />);

    await user.click(screen.getByRole("button", { name: /reorder manually/i }));
    await user.click(screen.getAllByTitle("Move up")[2]); // reorder

    await user.click(screen.getByRole("button", { name: /save reordering/i }));

    const confirm = screen.getByRole("button", { name: /confirm override/i });
    expect(confirm).toBeDisabled();

    // Enter a reason
    const reason = screen.getByPlaceholderText(/priority on stop/i);
    fireEvent.change(reason, { target: { value: "Weather detour" } });
    expect(confirm).not.toBeDisabled();
  });

  it("POSTs to /trips/:id/override with stopIds in new order and the reason", async () => {
    mockApiFetch.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const onSaved = jest.fn();
    render(<DraggableStopList tripId="trip-42" stops={makeStops()} canOverride onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: /reorder manually/i }));

    // Reorder: Charlie -> position 0 (two up-moves)
    await user.click(screen.getAllByTitle("Move up")[2]);
    await user.click(screen.getAllByTitle("Move up")[1]);
    // Now order is: Charlie, Alpha, Bravo
    expect(getAddressLines()).toEqual(["Charlie Rd", "Alpha St", "Bravo Ave"]);

    await user.click(screen.getByRole("button", { name: /save reordering/i }));

    const reason = screen.getByPlaceholderText(/priority on stop/i);
    fireEvent.change(reason, { target: { value: "Priority customer" } });

    await user.click(screen.getByRole("button", { name: /confirm override/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/trips/trip-42/override",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      stopIds: ["s3", "s1", "s2"],
      reason: "Priority customer",
    });

    // success toast fires and onSaved invoked
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Route manually overridden");
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error toast and does not close modal when API fails", async () => {
    mockApiFetch.mockRejectedValue(new Error("Server down"));
    const user = userEvent.setup();
    render(<DraggableStopList tripId="t1" stops={makeStops()} canOverride />);

    await user.click(screen.getByRole("button", { name: /reorder manually/i }));
    await user.click(screen.getAllByTitle("Move up")[2]);
    await user.click(screen.getByRole("button", { name: /save reordering/i }));

    const reason = screen.getByPlaceholderText(/priority on stop/i);
    fireEvent.change(reason, { target: { value: "Any reason" } });

    await user.click(screen.getByRole("button", { name: /confirm override/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Server down");
    });
    // Modal still open for retry
    expect(screen.getByRole("button", { name: /confirm override/i })).toBeInTheDocument();
  });
});
