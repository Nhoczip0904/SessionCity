import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sanitizeNotes, type Note } from "../shared/notes.js";

export interface NotesFile { read(): Note[]; write(v: unknown): Note[] }

/** The notes live in one JSON file; a missing or broken file reads as "no notes". */
export function notesFile(path: string): NotesFile {
  return {
    read() {
      try {
        return sanitizeNotes(JSON.parse(readFileSync(path, "utf8")));
      } catch {
        return [];
      }
    },
    write(v) {
      const notes = sanitizeNotes(v);
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(notes, null, 2), { mode: 0o600 });
      renameSync(tmp, path); // never leave a half-written file behind
      return notes;
    },
  };
}
