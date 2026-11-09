const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_COMPILER_PATH,
  TOOLCHAIN,
  getCompilerCommand,
  getCompilerIdentity,
} = require("../contract-compiler");

function createFakeCompiler(t, version) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "qrc20-hypc-"));
  const compilerPath = path.join(temporaryDirectory, "hypc");
  fs.writeFileSync(
    compilerPath,
    `#!/bin/sh\nprintf '%s\\n' 'hypc, the hyperion compiler commandline interface' ` +
      `'Version: ${version}'\n`,
    { mode: 0o700 }
  );
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  return compilerPath;
}

test("defaults to the workspace QIP-55 Hyperion compiler", () => {
  assert.equal(getCompilerCommand({}), DEFAULT_COMPILER_PATH);
  assert.equal(
    path.relative(__dirname, DEFAULT_COMPILER_PATH),
    path.join("..", "..", "hyperion", "build", "hypc", "hypc")
  );

  const identity = getCompilerIdentity(DEFAULT_COMPILER_PATH);
  assert.deepEqual(identity, {
    path: fs.realpathSync(DEFAULT_COMPILER_PATH),
    version: TOOLCHAIN.compilerVersion,
    sha256: TOOLCHAIN.compilerSha256,
    hyperionCommit: TOOLCHAIN.hyperionCommit,
    qrvmAddressBytes: 64,
  });
});

test("rejects the historical d5d1b977 system compiler", (t) => {
  const compilerPath = createFakeCompiler(
    t,
    "0.2.0-develop.2026.4.13+commit.d5d1b977.Linux.g++"
  );
  assert.throws(
    () => getCompilerIdentity(compilerPath),
    /Unreviewed Hyperion compiler version.*d5d1b977/
  );
});

test("rejects a binary that reports the reviewed version with different bytes", (t) => {
  const compilerPath = createFakeCompiler(t, TOOLCHAIN.compilerVersion);
  assert.throws(
    () => getCompilerIdentity(compilerPath),
    /Unreviewed Hyperion compiler binary.*SHA-256/
  );
});
