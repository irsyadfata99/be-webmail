/** Dibuang bila antrean penuh. Pemanggil menerjemahkannya ke respons "server sibuk". */
export class GateFullError extends Error {
  constructor() {
    super("gate full");
    this.name = "GateFullError";
  }
}

export interface Gate {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

/**
 * Membatasi jumlah pekerjaan berat yang berjalan bersamaan (mis. mengurai pesan 40 MB
 * di memori). Kelebihannya antre; bila antrean melebihi `maxQueue`, langsung ditolak.
 */
export function createGate(maxConcurrent: number, maxQueue: number): Gate {
  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    const start = queue.shift();
    if (start) start();
  }

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    if (queue.length >= maxQueue) throw new GateFullError();
    await new Promise<void>((resolve) => queue.push(resolve));
    // Slot diserahkan langsung oleh release; `active` tidak berubah.
  }

  function release(): void {
    if (queue.length > 0) next();
    else active -= 1;
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
