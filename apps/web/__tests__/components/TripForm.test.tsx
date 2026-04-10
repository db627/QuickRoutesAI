import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TripForm from "@/components/TripForm";
import type { TripStop } from "@quickroutesai/shared";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMapsLibrary: () => null,
}));

const mockApiFetch = jest.fn();
jest.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/toast-context", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    stopId: "s1",
    address: "123 Main St",
    contactName: "Alice",
    lat: 40.7,
    lng: -74.0,
    sequence: 0,
    notes: "",
    ...overrides,
  };
}

function getAddressInputs() {
  return screen.getAllByPlaceholderText("Address");
}

function getContactInputs() {
  return screen.getAllByPlaceholderText("Contact name");
}

// Fill all required fields on both default stops, no time windows.
function fillValidForm() {
  const addresses = getAddressInputs();
  const contacts = getContactInputs();
  fireEvent.change(addresses[0], { target: { value: "123 Main St" } });
  fireEvent.change(addresses[1], { target: { value: "456 Oak Ave" } });
  fireEvent.change(contacts[0], { target: { value: "Alice" } });
  fireEvent.change(contacts[1], { target: { value: "Bob" } });
}

// ── Suite 1: Initial render ────────────────────────────────────────────────

describe("initial render", () => {
  it("renders two stop rows by default", () => {
    render(<TripForm onCreated={jest.fn()} />);
    expect(getAddressInputs()).toHaveLength(2);
    expect(getContactInputs()).toHaveLength(2);
  });

  it("renders Add Stop, AI Check, and Create Trip buttons", () => {
    render(<TripForm onCreated={jest.fn()} />);
    expect(screen.getByRole("button", { name: /\+ add stop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ai check addresses/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create trip/i })).toBeInTheDocument();
  });

  it("shows Save Changes button in edit mode", () => {
    render(<TripForm onCreated={jest.fn()} tripId="t1" />);
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("pre-fills address and contact name from initialStops", () => {
    const stops: TripStop[] = [
      makeStop({ stopId: "s1", address: "100 First Ave", contactName: "Alice", sequence: 0 }),
      makeStop({ stopId: "s2", address: "200 Second St", contactName: "Bob", sequence: 1 }),
    ];
    render(<TripForm onCreated={jest.fn()} initialStops={stops} />);

    const addresses = getAddressInputs();
    expect(addresses[0]).toHaveValue("100 First Ave");
    expect(addresses[1]).toHaveValue("200 Second St");

    const contacts = getContactInputs();
    expect(contacts[0]).toHaveValue("Alice");
    expect(contacts[1]).toHaveValue("Bob");
  });

  it("pre-fills time window from initialStops", () => {
    const stops: TripStop[] = [
      makeStop({ stopId: "s1", sequence: 0, timeWindow: { start: "09:00", end: "11:00" } }),
      makeStop({ stopId: "s2", sequence: 1 }),
    ];
    render(<TripForm onCreated={jest.fn()} initialStops={stops} />);

    const timeInputs = document.querySelectorAll<HTMLInputElement>('input[type="time"]');
    expect(timeInputs[0].value).toBe("09:00");
    expect(timeInputs[1].value).toBe("11:00");
  });
});

// ── Suite 2: Add / remove stops ────────────────────────────────────────────

describe("add and remove stops", () => {
  it("adds a new stop row when + Add Stop is clicked", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /\+ add stop/i }));

    expect(getAddressInputs()).toHaveLength(3);
    expect(getContactInputs()).toHaveLength(3);
  });

  it("does not show remove button when exactly 2 stops remain", () => {
    render(<TripForm onCreated={jest.fn()} />);
    expect(screen.queryByTitle("Remove stop")).not.toBeInTheDocument();
  });

  it("shows remove buttons once there are more than 2 stops", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /\+ add stop/i }));

    expect(screen.getAllByTitle("Remove stop")).toHaveLength(3);
  });

  it("removes the correct stop when its remove button is clicked", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /\+ add stop/i }));

    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "First" } });
    fireEvent.change(addresses[1], { target: { value: "Second" } });
    fireEvent.change(addresses[2], { target: { value: "Third" } });

    // Remove the second stop
    await user.click(screen.getAllByTitle("Remove stop")[1]);

    const remaining = getAddressInputs();
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toHaveValue("First");
    expect(remaining[1]).toHaveValue("Third");
  });
});

// ── Suite 3: Reorder stops ─────────────────────────────────────────────────

describe("reorder stops", () => {
  it("disables Move up on the first stop", () => {
    render(<TripForm onCreated={jest.fn()} />);
    expect(screen.getAllByTitle("Move up")[0]).toBeDisabled();
  });

  it("disables Move down on the last stop", () => {
    render(<TripForm onCreated={jest.fn()} />);
    const btns = screen.getAllByTitle("Move down");
    expect(btns[btns.length - 1]).toBeDisabled();
  });

  it("moves a stop up when Move up is clicked", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "Alpha" } });
    fireEvent.change(addresses[1], { target: { value: "Beta" } });

    await user.click(screen.getAllByTitle("Move up")[1]);

    const reordered = getAddressInputs();
    expect(reordered[0]).toHaveValue("Beta");
    expect(reordered[1]).toHaveValue("Alpha");
  });

  it("moves a stop down when Move down is clicked", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "Alpha" } });
    fireEvent.change(addresses[1], { target: { value: "Beta" } });

    await user.click(screen.getAllByTitle("Move down")[0]);

    const reordered = getAddressInputs();
    expect(reordered[0]).toHaveValue("Beta");
    expect(reordered[1]).toHaveValue("Alpha");
  });
});

// ── Suite 4: Validation ────────────────────────────────────────────────────

describe("form validation", () => {
  it("shows error when address is empty on submit", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    // Fill contact names only — leave addresses blank
    const contacts = getContactInputs();
    fireEvent.change(contacts[0], { target: { value: "Alice" } });
    fireEvent.change(contacts[1], { target: { value: "Bob" } });

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    expect(screen.getByText(/stop 1: address is required/i)).toBeInTheDocument();
  });

  it("shows error when contact name is empty on submit", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "123 Main St" } });
    fireEvent.change(addresses[1], { target: { value: "456 Oak Ave" } });

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    expect(screen.getByText(/stop 1: contact name is required/i)).toBeInTheDocument();
  });

  it("shows error when only one time window field is filled", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);
    fillValidForm();

    // Fill only the start time for stop 1
    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: "09:00" } });

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    expect(screen.getByText(/both time window fields must be filled/i)).toBeInTheDocument();
  });

  it("shows error when time window start is not before end", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);
    fillValidForm();

    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: "11:00" } }); // start
    fireEvent.change(timeInputs[1], { target: { value: "09:00" } }); // end — before start

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    expect(screen.getByText(/time window start must be before end/i)).toBeInTheDocument();
  });

  it("does not call apiFetch when validation fails", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("clears validation errors when user edits a field", async () => {
    const user = userEvent.setup();
    render(<TripForm onCreated={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /create trip/i }));
    expect(screen.getAllByText(/address is required/i).length).toBeGreaterThan(0);

    fireEvent.change(getAddressInputs()[0], { target: { value: "123 Main St" } });

    expect(screen.queryAllByText(/address is required/i)).toHaveLength(0);
  });
});

// ── Suite 5: Submit — create mode ─────────────────────────────────────────

describe("submit in create mode", () => {
  it("calls POST /trips with correct stop payload", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ id: "new-trip", stops: [] });

    render(<TripForm onCreated={jest.fn()} />);
    fillValidForm();
    await user.click(screen.getByRole("button", { name: /create trip/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/trips",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
      expect(body.stops[0]).toMatchObject({ address: "123 Main St", contactName: "Alice", sequence: 0 });
      expect(body.stops[1]).toMatchObject({ address: "456 Oak Ave", contactName: "Bob", sequence: 1 });
    });
  });

  it("includes timeWindow in payload when both fields are filled", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ id: "new-trip", stops: [] });

    render(<TripForm onCreated={jest.fn()} />);
    fillValidForm();

    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: "09:00" } });
    fireEvent.change(timeInputs[1], { target: { value: "11:00" } });

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    await waitFor(() => {
      const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
      expect(body.stops[0].timeWindow).toEqual({ start: "09:00", end: "11:00" });
    });
  });

  it("omits timeWindow from payload when fields are not filled", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ id: "new-trip", stops: [] });

    render(<TripForm onCreated={jest.fn()} />);
    fillValidForm();
    await user.click(screen.getByRole("button", { name: /create trip/i }));

    await waitFor(() => {
      const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
      expect(body.stops[0].timeWindow).toBeUndefined();
    });
  });

  it("calls onCreated after successful submit", async () => {
    const user = userEvent.setup();
    const onCreated = jest.fn();
    mockApiFetch.mockResolvedValue({ id: "new-trip", stops: [] });

    render(<TripForm onCreated={onCreated} />);
    fillValidForm();
    await user.click(screen.getByRole("button", { name: /create trip/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("shows error toast when API call fails", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockRejectedValue(new Error("Server error"));

    render(<TripForm onCreated={jest.fn()} />);
    fillValidForm();
    await user.click(screen.getByRole("button", { name: /create trip/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Server error");
    });
  });
});

// ── Suite 6: Submit — edit mode ────────────────────────────────────────────

describe("submit in edit mode", () => {
  it("calls PATCH /trips/:id in edit mode", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ ok: true });
    const stops: TripStop[] = [
      makeStop({ stopId: "s1", address: "123 Main St", contactName: "Alice", sequence: 0 }),
      makeStop({ stopId: "s2", address: "456 Oak Ave", contactName: "Bob", sequence: 1 }),
    ];

    render(<TripForm onCreated={jest.fn()} tripId="trip-99" initialStops={stops} />);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/trips/trip-99",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("calls onCreated after successful edit", async () => {
    const user = userEvent.setup();
    const onCreated = jest.fn();
    mockApiFetch.mockResolvedValue({ ok: true });
    const stops: TripStop[] = [
      makeStop({ stopId: "s1", sequence: 0 }),
      makeStop({ stopId: "s2", sequence: 1 }),
    ];

    render(<TripForm onCreated={onCreated} tripId="trip-99" initialStops={stops} />);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });
});

// ── Suite 7: AI address correction ────────────────────────────────────────

describe("AI address correction", () => {
  it("calls /ai/correct-addresses with current address values", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({
      corrections: [
        { original: "123 Main St", corrected: "123 Main St", confidence: 1, changed: false },
        { original: "456 Oak Ave", corrected: "456 Oak Ave", confidence: 1, changed: false },
      ],
    });

    render(<TripForm onCreated={jest.fn()} />);
    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "123 Main St" } });
    fireEvent.change(addresses[1], { target: { value: "456 Oak Ave" } });

    await user.click(screen.getByRole("button", { name: /ai check addresses/i }));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/ai/correct-addresses",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("123 Main St"),
        }),
      );
    });
  });

  it("shows suggestion and Apply button when a correction is found", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({
      corrections: [
        { original: "123 Main", corrected: "123 Main Street, New York, NY", confidence: 0.9, changed: true },
        { original: "456 Oak Ave", corrected: "456 Oak Ave", confidence: 1, changed: false },
      ],
    });

    render(<TripForm onCreated={jest.fn()} />);
    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "123 Main" } });
    fireEvent.change(addresses[1], { target: { value: "456 Oak Ave" } });

    await user.click(screen.getByRole("button", { name: /ai check addresses/i }));

    await waitFor(() => {
      expect(screen.getByText(/123 Main Street, New York, NY/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^apply$/i })).toBeInTheDocument();
    });
  });

  it("applies a single correction when Apply is clicked", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({
      corrections: [
        { original: "123 Main", corrected: "123 Main Street, NY", confidence: 0.9, changed: true },
        { original: "456 Oak Ave", corrected: "456 Oak Ave", confidence: 1, changed: false },
      ],
    });

    render(<TripForm onCreated={jest.fn()} />);
    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "123 Main" } });
    fireEvent.change(addresses[1], { target: { value: "456 Oak Ave" } });

    await user.click(screen.getByRole("button", { name: /ai check addresses/i }));
    await waitFor(() => screen.getByRole("button", { name: /^apply$/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(getAddressInputs()[0]).toHaveValue("123 Main Street, NY");
    expect(getAddressInputs()[1]).toHaveValue("456 Oak Ave"); // unchanged
  });

  it("applies all corrections when Apply All Corrections is clicked", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({
      corrections: [
        { original: "First", corrected: "1 First Ave, NY", confidence: 0.9, changed: true },
        { original: "Second", corrected: "2 Second St, NY", confidence: 0.85, changed: true },
      ],
    });

    render(<TripForm onCreated={jest.fn()} />);
    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "First" } });
    fireEvent.change(addresses[1], { target: { value: "Second" } });

    await user.click(screen.getByRole("button", { name: /ai check addresses/i }));
    await waitFor(() => screen.getByRole("button", { name: /apply all corrections/i }));
    await user.click(screen.getByRole("button", { name: /apply all corrections/i }));

    expect(getAddressInputs()[0]).toHaveValue("1 First Ave, NY");
    expect(getAddressInputs()[1]).toHaveValue("2 Second St, NY");
  });

  it("shows error toast when AI check fails", async () => {
    const user = userEvent.setup();
    mockApiFetch.mockRejectedValue(new Error("AI unavailable"));

    render(<TripForm onCreated={jest.fn()} />);
    const addresses = getAddressInputs();
    fireEvent.change(addresses[0], { target: { value: "123 Main St" } });
    fireEvent.change(addresses[1], { target: { value: "456 Oak Ave" } });

    await user.click(screen.getByRole("button", { name: /ai check addresses/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("AI unavailable");
    });
  });
});
