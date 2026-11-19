// Sticky notes pinned over the city; the same shape is checked on the client and the server.
// pinned: shown on the city screen (missing = true, so hand-written JSON can leave it out); unpinned notes only live in the list.
export interface Note { id: string; x: number; y: number; color: string; text: string; pinned: boolean }

/** dataTransfer type set while a note is dragged, so the chat can tell it from other drags. */
export const NOTE_DRAG = "application/x-sessioncity-note";

export const NOTE_COLORS = ["#fff59d", "#ffcc80", "#f8bbd0", "#b3e5fc", "#c5e1a5"];
const MAX_NOTES = 100, MAX_TEXT = 5000;

/** Anything that is not a well-formed note is dropped; unknown colours fall back to the first one. */
export function sanitizeNotes(v: unknown): Note[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((n) => n && typeof n.id === "string" && n.id.length <= 64 && typeof n.text === "string" && Number.isFinite(n.x) && Number.isFinite(n.y))
    .slice(0, MAX_NOTES)
    .map((n) => ({ id: n.id, x: n.x, y: n.y, text: n.text.slice(0, MAX_TEXT), color: NOTE_COLORS.includes(n.color) ? n.color : NOTE_COLORS[0], pinned: n.pinned !== false }));
}
