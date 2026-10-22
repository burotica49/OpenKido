// Lecture en flux d'une archive tar (déjà décompressée). Suffisant pour les archives de dépôt GitHub (format ustar/pax).
export interface TarEntry {
  path: string;
  size: number;
}

export interface TarOptions {
  /** Décide, d'après le chemin et la taille, si le contenu du fichier est lu. */
  wants: (path: string, size: number) => boolean;
  /** Reçoit le contenu des fichiers demandés. */
  onFile: (path: string, content: Buffer) => void;
  /** Reçoit les fichiers ignorés (non demandés). */
  onSkip?: (path: string, size: number) => void;
  /** Interrompt la lecture si le total d'octets lus dépasse cette limite. */
  maxTotalBytes: number;
}

export class TarLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarLimitError";
  }
}

function field(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? len : end).toString("utf8");
}

function parseSize(buf: Buffer): number {
  const raw = field(buf, 124, 12).trim();
  return raw ? parseInt(raw, 8) || 0 : 0;
}

/** Parcourt une archive tar fournie sous forme de flux de blocs. */
export async function readTar(chunks: AsyncIterable<Buffer | Uint8Array>, opts: TarOptions): Promise<void> {
  let buffer: Buffer = Buffer.alloc(0);
  let total = 0;
  // État de l'entrée courante
  let current: { path: string; size: number; remaining: number; padding: number; collect: boolean; parts: Buffer[] } | null = null;
  let pendingLongName: string | null = null;
  let pendingPaxPath: string | null = null;
  let special: { kind: "longname" | "pax"; remaining: number; padding: number; parts: Buffer[] } | null = null;

  const take = (n: number): Buffer => {
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return out;
  };

  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > opts.maxTotalBytes) throw new TarLimitError("archive trop volumineuse");
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);

    for (;;) {
      if (special) {
        const need = special.remaining + special.padding;
        if (buffer.length < need) {
          // Ces entrées sont minuscules : on attend le reste.
          break;
        }
        special.parts.push(Buffer.from(take(special.remaining)));
        take(special.padding);
        const text = Buffer.concat(special.parts).toString("utf8");
        if (special.kind === "longname") pendingLongName = text.replace(/\0+$/, "");
        else {
          const m = /\d+ path=([^\n]*)\n/.exec(text);
          if (m) pendingPaxPath = m[1];
        }
        special = null;
        continue;
      }

      if (current) {
        if (current.remaining > 0) {
          if (buffer.length === 0) break;
          const n = Math.min(current.remaining, buffer.length);
          const part = take(n);
          if (current.collect) current.parts.push(Buffer.from(part));
          current.remaining -= n;
          if (current.remaining > 0) break;
        }
        // Remplissage jusqu'au bloc de 512 octets
        if (buffer.length < current.padding) break;
        take(current.padding);
        if (current.collect) opts.onFile(current.path, Buffer.concat(current.parts));
        else opts.onSkip?.(current.path, current.size);
        current = null;
        continue;
      }

      if (buffer.length < 512) break;
      const header = Buffer.from(take(512));
      if (header.every((b) => b === 0)) continue; // bloc de fin
      let name = field(header, 0, 100);
      const prefix = field(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
      const type = String.fromCharCode(header[156] || 48);
      const size = parseSize(header);
      const padding = (512 - (size % 512)) % 512;

      if (type === "L") { special = { kind: "longname", remaining: size, padding, parts: [] }; continue; }
      if (type === "x") { special = { kind: "pax", remaining: size, padding, parts: [] }; continue; }
      if (type === "g") { special = { kind: "pax", remaining: size, padding, parts: [] }; pendingPaxPath = null; continue; }

      const fullName = pendingLongName ?? pendingPaxPath ?? name;
      pendingLongName = null;
      pendingPaxPath = null;
      // Le premier segment est le dossier racine « owner-repo-sha » : on le retire.
      const path = fullName.split("/").slice(1).join("/");
      const isFile = type === "0" || type === "\0";
      if (!isFile || !path) {
        // Dossier, lien, etc. : le contenu (s'il y en a) est ignoré.
        if (size > 0) current = { path, size, remaining: size, padding, collect: false, parts: [] };
        continue;
      }
      current = { path, size, remaining: size, padding, collect: opts.wants(path, size), parts: [] };
      if (size === 0) {
        if (current.collect) opts.onFile(path, Buffer.alloc(0));
        else opts.onSkip?.(path, 0);
        current = null;
      }
    }
  }
}
