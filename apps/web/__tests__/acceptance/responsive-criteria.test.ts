import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Responsive acceptance criteria", () => {
  it("keeps sidebar collapse classes and icon-only label behavior", () => {
    const sidebar = read("components/Sidebar.tsx");

    expect(sidebar).toContain("md:w-16 lg:w-60");
    expect(sidebar).toContain("block md:hidden lg:block");
    expect(sidebar).toContain("fixed inset-y-0 left-0 z-50 w-60");
    expect(sidebar).toContain("isDrawerOpen ? \"translate-x-0\" : \"-translate-x-full\"");
  });

  it("keeps dashboard grid single-column on mobile", () => {
    const dashboard = read("app/dashboard/page.tsx");
    expect(dashboard).toContain("grid grid-cols-1 gap-6 lg:grid-cols-2");
  });

  it("keeps trip detail mobile usability classes for map and actions", () => {
    const tripDetail = read("app/dashboard/trips/[id]/page.tsx");
    expect(tripDetail).toContain("flex flex-wrap items-center gap-3");
    expect(tripDetail).toContain("h-[280px] sm:h-[400px] lg:h-[500px]");
  });

  it("keeps no-horizontal-scroll guards in layout and trips tabs", () => {
    const layout = read("app/dashboard/layout.tsx");
    const tripsPage = read("app/dashboard/trips/page.tsx");

    expect(layout).toContain("flex flex-1 overflow-hidden");
    expect(layout).toContain("flex-1 overflow-auto");
    expect(tripsPage).toContain("flex flex-wrap gap-2");
  });
});
