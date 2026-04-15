import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Vehicle } from "@/lib/mock-data/schemas";
import { vehicleColumns } from "./vehicles-columns";

/**
 * Minimal row stub matching the ColumnDef<Vehicle>['cell'] context shape.
 * We only implement the fields each cell under test reads, not the whole
 * @tanstack/react-table row interface.
 */
function makeRow(vehicle: Partial<Vehicle>) {
  return {
    original: vehicle as Vehicle,
    getValue: (key: keyof Vehicle) => (vehicle as Record<string, unknown>)[key],
    index: 0,
  };
}

describe("vehicleColumns (DiceUI column def — pure logic)", () => {
  it("is a non-empty array of column definitions", () => {
    expect(Array.isArray(vehicleColumns)).toBe(true);
    expect(vehicleColumns.length).toBeGreaterThan(0);
  });

  it("exposes a makeModel column with an accessorFn that concatenates make + model", () => {
    const col = vehicleColumns.find((c) => c.id === "makeModel");
    expect(col).toBeDefined();
    // accessorFn is the pure function we want to lock in.
    const accessorFn = (col as { accessorFn?: (row: Vehicle) => string }).accessorFn;
    expect(accessorFn).toBeTypeOf("function");
    const result = accessorFn!({ make: "Toyota", model: "Corolla" } as Vehicle);
    expect(result).toBe("Toyota Corolla");
  });

  it("tags the makeModel column with meta.label for DiceUI DataTableSortList", () => {
    const col = vehicleColumns.find((c) => c.id === "makeModel");
    const meta = (col as { meta?: { label?: string } }).meta;
    expect(meta?.label).toBe("Make / Model");
  });

  it("uses the built-in 'equals' filterFn for the status column", () => {
    const col = vehicleColumns.find((c) => c.id === "status");
    expect(col).toBeDefined();
    expect((col as { filterFn?: unknown }).filterFn).toBe("equals");
  });

  it("maps the purchaseType enum to a human label in the cell renderer", () => {
    const col = vehicleColumns.find((c) => c.id === "purchaseType");
    expect(col).toBeDefined();
    const cell = (col as { cell?: (ctx: unknown) => React.ReactElement }).cell;
    expect(cell).toBeTypeOf("function");

    const element = cell!({
      row: makeRow({ purchaseType: "LeaseSettlement" as Vehicle["purchaseType"] }),
    });
    render(element);
    expect(screen.getByText("Lease Settlement")).toBeInTheDocument();
  });
});
