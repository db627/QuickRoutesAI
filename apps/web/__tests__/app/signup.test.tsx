import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SignupPage from "@/app/signup/page";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: jest.fn(),
}));

jest.mock("@/lib/firebase", () => ({
  auth: {},
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedSignIn = signInWithEmailAndPassword as jest.MockedFunction<
  typeof signInWithEmailAndPassword
>;

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseAuth.mockReturnValue({
    user: null,
    role: null,
    orgId: null,
    loading: false,
    logout: jest.fn(),
    refresh: jest.fn(),
  } as any);
  mockedUseRouter.mockReturnValue({ replace: jest.fn(), push: jest.fn() } as any);
  global.fetch = mockFetch as any;
  mockedSignIn.mockResolvedValue({} as any);
});

function fillShared() {
  fireEvent.change(screen.getByLabelText(/Full name/i), {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(screen.getByLabelText(/Email/i), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/Password/i), {
    target: { value: "hunter2hunter2" },
  });
}

describe("SignupPage", () => {
  it("renders both tabs", () => {
    render(<SignupPage />);
    expect(
      screen.getByRole("tab", { name: /Create new business/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Join existing business/i }),
    ).toBeInTheDocument();
  });

  it("submits a Create-new-business signup with role=admin and no orgCode", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: "tok",
        refreshToken: "ref",
        user: { uid: "u1", email: "jane@example.com", name: "Jane", role: "admin" },
      }),
    });

    render(<SignupPage />);
    fillShared();
    fireEvent.click(screen.getByRole("button", { name: /Create business/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/signup$/);
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      email: "jane@example.com",
      password: "hunter2hunter2",
      name: "Jane Doe",
      role: "admin",
    });
    expect(body.orgCode).toBeUndefined();

    // After HTTP success, Firebase client is signed in locally.
    await waitFor(() => {
      expect(mockedSignIn).toHaveBeenCalled();
    });
  });

  it("requires orgCode on the Join tab and does NOT submit when empty", async () => {
    render(<SignupPage />);
    // Switch to Join tab
    fireEvent.click(screen.getByRole("tab", { name: /Join existing business/i }));
    fillShared();

    // Leave orgCode empty → click submit
    fireEvent.click(screen.getByRole("button", { name: /Join business/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Organization code is required/i,
      );
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("submits a Join-existing-business signup with role + orgCode", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: "tok",
        refreshToken: "ref",
        user: { uid: "u2", email: "jane@example.com", name: "Jane", role: "dispatcher" },
      }),
    });

    render(<SignupPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Join existing business/i }));
    fillShared();

    fireEvent.change(screen.getByLabelText(/Role/i), {
      target: { value: "dispatcher" },
    });
    fireEvent.change(screen.getByLabelText(/Organization code/i), {
      target: { value: "org-abc" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Join business/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      email: "jane@example.com",
      password: "hunter2hunter2",
      name: "Jane Doe",
      role: "dispatcher",
      orgCode: "org-abc",
    });
  });

  it("surfaces server errors (e.g. invalid org code) to the user", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid organization code" }),
    });

    render(<SignupPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Join existing business/i }));
    fillShared();
    fireEvent.change(screen.getByLabelText(/Organization code/i), {
      target: { value: "bogus" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Join business/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Invalid organization code/i,
      );
    });
    expect(mockedSignIn).not.toHaveBeenCalled();
  });
});
