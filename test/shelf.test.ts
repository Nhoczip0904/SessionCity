import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listShelf, readShelfItem, shelfId } from "../src/server/shelf.js";

let root: string, claudeDir: string, cwd: string, plug: string;
const skill = async (base: string, folder: string, body: string) => {
  await mkdir(join(base, "skills", folder), { recursive: true });
  await writeFile(join(base, "skills", folder, "SKILL.md"), body);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "shelf-"));
  claudeDir = join(root, "home", ".claude");
  cwd = join(root, "root", "a", "b");
  plug = join(root, "plug");
  await mkdir(cwd, { recursive: true });
  await mkdir(join(claudeDir, "plugins"), { recursive: true });
  await writeFile(join(claudeDir, "CLAUDE.md"), "user rules");
  await writeFile(join(root, "root", "CLAUDE.md"), "parent");
  await mkdir(join(cwd, ".claude"), { recursive: true });
  await writeFile(join(cwd, ".claude", "CLAUDE.md"), "dotclaude");
  await writeFile(join(cwd, "CLAUDE.md"), "cwd");
  await writeFile(join(cwd, "CLAUDE.local.md"), "local");
  await skill(claudeDir, "zeta", "---\nname: \"zeta\"\ndescription: 'user skill'\n---\nbody");
  await skill(claudeDir, "alpha", `---\ndescription: ${"x".repeat(300)}\n---\n`);
  await skill(join(cwd, ".claude"), "proj", "---\nname: proj\n---\n");
  await skill(plug, "pp", "---\nname: pp\ndescription: from plugin\n---\n");
  await writeFile(
    join(claudeDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { "myplug@market": [{ installPath: plug }] } }),
  );
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("shelf", () => {
  it("lists user, project (incl. parents) and local files", async () => {
    const { files } = await listShelf(cwd, claudeDir, []);
    // parents above the temp root may hold real files on this machine; compare only ours
    const ours = files.filter((f) => f.scope !== "project" || f.path.startsWith(root));
    expect(ours.map((f) => [f.scope, f.path])).toEqual([
      ["user", join(claudeDir, "CLAUDE.md")],
      ["project", join(cwd, "CLAUDE.md")],
      ["project", join(cwd, ".claude", "CLAUDE.md")],
      ["project", join(root, "root", "CLAUDE.md")],
      ["local", join(cwd, "CLAUDE.local.md")],
    ]);
    expect(files[0]).toMatchObject({ size: 10, id: shelfId(join(claudeDir, "CLAUDE.md")) });
  });

  it("lists skills from user, project and plugins", async () => {
    const { skills } = await listShelf(cwd, claudeDir, []);
    const by = (n: string) => skills.find((s) => s.name === n)!;
    expect(by("zeta")).toMatchObject({ scope: "user", description: "user skill", used: false });
    expect(by("alpha").description).toHaveLength(200);
    expect(by("proj").scope).toBe("project");
    expect(by("pp")).toMatchObject({ scope: "plugin", plugin: "myplug", description: "from plugin" });
  });

  it("marks used skills by name or plugin:name and sorts them first", async () => {
    const { skills } = await listShelf(cwd, claudeDir, ["zeta", "myplug:pp"]);
    expect(skills.map((s) => [s.name, s.used])).toEqual([
      ["pp", true], ["zeta", true], ["alpha", false], ["proj", false],
    ]);
  });

  it("skips symlinked SKILL.md", async (ctx) => {
    await mkdir(join(claudeDir, "skills", "link"), { recursive: true });
    try {
      await symlink(join(plug, "skills", "pp", "SKILL.md"), join(claudeDir, "skills", "link", "SKILL.md"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") return ctx.skip();
      throw e;
    }
    const { skills } = await listShelf(cwd, claudeDir, []);
    expect(skills.find((s) => s.name === "link")).toBeUndefined();
  });

  it("reads an item and truncates at 64 KB", async () => {
    await writeFile(join(cwd, "CLAUDE.md"), "a".repeat(70_000));
    const id = shelfId(join(cwd, "CLAUDE.md"));
    const r = await readShelfItem(cwd, claudeDir, id);
    expect(r?.truncated).toBe(true);
    expect(r!.text.length).toBeLessThanOrEqual(65_536);
    expect(await readShelfItem(cwd, claudeDir, shelfId(join(claudeDir, "CLAUDE.md")))).toEqual({ text: "user rules", truncated: false });
  });

  it("unknown id → null", async () => {
    expect(await readShelfItem(cwd, claudeDir, "0".repeat(16))).toBeNull();
  });
});
