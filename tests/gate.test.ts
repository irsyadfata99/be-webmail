import { describe, expect, it } from "vitest";
import { GateFullError, createGate } from "../src/lib/gate.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createGate", () => {
  it("membatasi pekerjaan bersamaan dan menjalankan antrean sesuai urutan", async () => {
    const gate = createGate(2, 10);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, i) =>
      gate.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        order.push(i);
        await tick();
        running -= 1;
        return i;
      }),
    );
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(gate.active).toBe(0);
    expect(gate.waiting).toBe(0);
  });

  it("menolak bila antrean penuh", async () => {
    const gate = createGate(1, 1);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const second = gate.run(async () => "kedua");
    await expect(gate.run(async () => "ketiga")).rejects.toBeInstanceOf(
      GateFullError,
    );
    hold.resolve();
    await first;
    expect(await second).toBe("kedua");
  });

  it("melepas slot walau pekerjaan gagal", async () => {
    const gate = createGate(1, 5);
    await expect(
      gate.run(async () => Promise.reject(new Error("gagal"))),
    ).rejects.toThrow("gagal");
    expect(gate.active).toBe(0);
    expect(await gate.run(async () => "lanjut")).toBe("lanjut");
  });
});
