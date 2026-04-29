import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickActionsProvider, useQuickActions } from "@/lib/quick-actions-context";

// Simple consumer that exposes context actions as buttons
function TestConsumer() {
  const {
    showTripForm,
    openNewTrip,
    closeNewTrip,
    showMultiOptimizer,
    openMultiOptimizer,
    closeMultiOptimizer,
  } = useQuickActions();

  return (
    <div>
      <button onClick={openNewTrip}>Open Trip Form</button>
      <button onClick={closeNewTrip}>Close Trip Form</button>
      <button onClick={openMultiOptimizer}>Open Multi</button>
      <button onClick={closeMultiOptimizer}>Close Multi</button>
      {showTripForm && <div data-testid="trip-form">Trip Form</div>}
      {showMultiOptimizer && <div data-testid="multi-optimizer">Multi Optimizer</div>}
    </div>
  );
}

describe("QuickActionsContext", () => {
  it("opens and closes the trip form", async () => {
    render(
      <QuickActionsProvider>
        <TestConsumer />
      </QuickActionsProvider>,
    );

    expect(screen.queryByTestId("trip-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Open Trip Form"));
    expect(screen.getByTestId("trip-form")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Close Trip Form"));
    expect(screen.queryByTestId("trip-form")).not.toBeInTheDocument();
  });

  it("opens and closes the multi-driver optimizer", async () => {
    render(
      <QuickActionsProvider>
        <TestConsumer />
      </QuickActionsProvider>,
    );

    expect(screen.queryByTestId("multi-optimizer")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Open Multi"));
    expect(screen.getByTestId("multi-optimizer")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Close Multi"));
    expect(screen.queryByTestId("multi-optimizer")).not.toBeInTheDocument();
  });

  it("opening trip form closes multi-driver optimizer", async () => {
    render(
      <QuickActionsProvider>
        <TestConsumer />
      </QuickActionsProvider>,
    );

    await userEvent.click(screen.getByText("Open Multi"));
    expect(screen.getByTestId("multi-optimizer")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Open Trip Form"));
    expect(screen.getByTestId("trip-form")).toBeInTheDocument();
    expect(screen.queryByTestId("multi-optimizer")).not.toBeInTheDocument();
  });

  it("opening multi-driver optimizer closes trip form", async () => {
    render(
      <QuickActionsProvider>
        <TestConsumer />
      </QuickActionsProvider>,
    );

    await userEvent.click(screen.getByText("Open Trip Form"));
    expect(screen.getByTestId("trip-form")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Open Multi"));
    expect(screen.getByTestId("multi-optimizer")).toBeInTheDocument();
    expect(screen.queryByTestId("trip-form")).not.toBeInTheDocument();
  });

  it("throws when useQuickActions is used outside the provider", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useQuickActions must be used within QuickActionsProvider",
    );
    consoleError.mockRestore();
  });
});
