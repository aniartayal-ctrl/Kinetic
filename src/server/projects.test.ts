import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BUILTIN_PRESETS } from "../core/presets";
import { BACKUPS_KEPT, listProjects, loadProjectFile, ProjectFileError, resolveProjectAsset, saveProjectFile } from "./projects";
import { toSafeProjectId, UnsafePathError } from "./safe-paths";

const withRoot = (fn: (root: string) => void) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kinetic-projects-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("save, list and load round-trip in projects/<id>/", () =>
  withRoot((root) => {
    const project = BUILTIN_PRESETS["astral-forge"]!();
    const saved = saveProjectFile(project, root);
    assert.equal(saved.file, path.join(root, project.id, `${project.id}.project.json`));
    assert.equal(saved.backup, null);

    const [summary] = listProjects(root);
    assert.equal(summary!.id, project.id);
    assert.equal(summary!.title, project.title);
    assert.equal(summary!.bones, project.bones.length);
    assert.equal(summary!.clips, Object.keys(project.animations).length);

    assert.deepEqual(loadProjectFile(project.id, root), JSON.parse(JSON.stringify(project)));
    assert.ok(!readdirSync(path.join(root, project.id)).some((f) => f.endsWith(".tmp")), "no temp files left");
  }));

test("changed saves keep the previous version, identical saves do not, backups are capped", () =>
  withRoot((root) => {
    const project = BUILTIN_PRESETS["astral-forge"]!();
    saveProjectFile(project, root);
    assert.equal(saveProjectFile(project, root).unchanged, true);
    assert.ok(!existsSync(path.join(root, project.id, "backups")));

    for (let i = 0; i < BACKUPS_KEPT + 3; i++) {
      const edited = { ...project, title: `${project.title} v${i}` };
      const r = saveProjectFile(edited, root);
      assert.ok(r.backup && existsSync(r.backup));
      // Unique, ordered backup names even within one millisecond.
      const waitUntil = Date.now() + 2;
      while (Date.now() < waitUntil) {
        /* spin */
      }
    }
    const backups = readdirSync(path.join(root, project.id, "backups"));
    assert.equal(backups.length, BACKUPS_KEPT);
    assert.equal(loadProjectFile(project.id, root).title, `${project.title} v${BACKUPS_KEPT + 2}`);
  }));

test("rejects unsafe ids, invalid projects and damaged files", () =>
  withRoot((root) => {
    const project = BUILTIN_PRESETS["astral-forge"]!();
    assert.throws(() => saveProjectFile({ ...project, id: "../escape" }, root), UnsafePathError);
    assert.throws(() => loadProjectFile("../../etc", root), UnsafePathError);
    assert.throws(() => resolveProjectAsset("ok", ["..", "..", "secret"], root), UnsafePathError);
    assert.throws(() => saveProjectFile({ ...project, bones: [] }, root), (e) => e instanceof ProjectFileError && e.status === 400);
    assert.throws(() => loadProjectFile("missing", root), (e) => e instanceof ProjectFileError && e.status === 404);

    mkdirSync(path.join(root, "broken"), { recursive: true });
    writeFileSync(path.join(root, "broken", "broken.project.json"), "{ not json");
    assert.equal(listProjects(root).find((p) => p.id === "broken")?.damaged, true);
    assert.throws(() => loadProjectFile("broken", root), (e) => e instanceof ProjectFileError && e.status === 422);
  }));

test("upload names become safe project ids", () => {
  assert.equal(toSafeProjectId("_My Hero!.png".replace(/\.[^.]+$/, "")), "my-hero");
  assert.equal(toSafeProjectId("../../x"), "x");
  assert.equal(toSafeProjectId("___"), "custom-hero");
});
