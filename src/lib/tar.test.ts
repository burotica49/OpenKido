import { describe, expect, it } from "vitest";
import { readTar, TarLimitError } from "./tar";

function header(name: string, size: number, type = "0"): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, "utf8");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write(type, 156, "ascii");
  return h;
}
function file(name: string, content: string): Buffer {
  const data = Buffer.from(content);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header(name, data.length), data, pad]);
}
const end = Buffer.alloc(1024);

async function* chunked(buf: Buffer, size: number) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

describe("readTar", () => {
  const archive = Buffer.concat([
    header("repo-abc/", 0, "5"),
    file("repo-abc/src/a.ts", "hello"),
    file("repo-abc/big.bin", "x".repeat(1500)),
    file("repo-abc/.env", "SECRET=1"),
    end,
  ]);

  it("lit les fichiers demandés et ignore les autres, quel que soit le découpage", async () => {
    for (const size of [7, 512, 1000, 100000]) {
      const files: Record<string, string> = {};
      const skipped: string[] = [];
      await readTar(chunked(archive, size), {
        wants: (p, s) => s < 1000,
        onFile: (p, c) => { files[p] = c.toString(); },
        onSkip: (p) => skipped.push(p),
        maxTotalBytes: 1e6,
      });
      expect(files, `chunk ${size}`).toEqual({ "src/a.ts": "hello", ".env": "SECRET=1" });
      expect(skipped).toEqual(["big.bin"]);
    }
  });
  it("gère les noms longs (type L)", async () => {
    const long = "repo-abc/" + "d/".repeat(60) + "f.txt";
    const nameData = Buffer.from(long + "\0");
    const pad = Buffer.alloc((512 - (nameData.length % 512)) % 512);
    const arch = Buffer.concat([header("././@LongLink", nameData.length, "L"), nameData, pad, file("short", "ok"), end]);
    const got: string[] = [];
    await readTar(chunked(arch, 300), { wants: () => true, onFile: (p) => got.push(p), maxTotalBytes: 1e6 });
    expect(got).toEqual(["d/".repeat(60) + "f.txt"]);
  });
  it("s'arrête au-delà de la limite", async () => {
    await expect(readTar(chunked(archive, 512), { wants: () => true, onFile: () => {}, maxTotalBytes: 1000 })).rejects.toBeInstanceOf(TarLimitError);
  });
});
