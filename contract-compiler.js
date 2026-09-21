const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TOOLCHAIN_CONFIG_PATH = path.join(__dirname, "config", "hyperion-toolchain.json");
const TOOLCHAIN = Object.freeze(
  JSON.parse(fs.readFileSync(TOOLCHAIN_CONFIG_PATH, "utf8"))
);
const DEFAULT_COMPILER_PATH = path.join(
  __dirname,
  "..",
  "hyperion",
  "build",
  "hypc",
  "hypc"
);

const CONTRACT_SOURCES = [
  "Context.hyp",
  "CustomERC20.hyp",
  "CustomERC20Factory.hyp",
  "ERC20.hyp",
  "IERC20.hyp",
  "IERC20Metadata.hyp",
  "Ownable.hyp",
];

function createCompilerInput() {
  const sources = Object.fromEntries(
    CONTRACT_SOURCES.map((name) => [
      name,
      { content: fs.readFileSync(path.join(__dirname, "contracts", name), "utf8") },
    ])
  );

  return {
    language: "Hyperion",
    sources,
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "qrvm.bytecode.object"],
        },
      },
    },
  };
}

function getCompilerCommand(environment = process.env) {
  return environment.HYPERION_COMPILER || environment.HYPC_BIN || DEFAULT_COMPILER_PATH;
}

function resolveCompilerPath(compilerCommand, environment = process.env) {
  if (typeof compilerCommand !== "string" || compilerCommand.trim() === "") {
    throw new Error("Hyperion compiler path is required");
  }

  const candidates = path.isAbsolute(compilerCommand) || compilerCommand.includes(path.sep)
    ? [path.resolve(process.cwd(), compilerCommand)]
    : (environment.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, compilerCommand));

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EACCES") {
        throw error;
      }
    }
  }

  throw new Error(`Hyperion compiler not found or not executable: ${compilerCommand}`);
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getCompilerVersion(compilerPath) {
  const output = execFileSync(compilerPath, ["--version"], {
    encoding: "utf8",
  });
  const match = output.match(/Version:\s*([^\r\n]+)/);
  if (!match) {
    throw new Error("hypc --version did not report a version");
  }

  return match[1].trim();
}

function getCompilerIdentity(
  compilerCommand = getCompilerCommand(),
  environment = process.env
) {
  const compilerPath = resolveCompilerPath(compilerCommand, environment);
  const version = getCompilerVersion(compilerPath);
  if (version !== TOOLCHAIN.compilerVersion) {
    throw new Error(
      `Unreviewed Hyperion compiler version. Expected ${TOOLCHAIN.compilerVersion}, ` +
        `received ${version}.`
    );
  }

  const sha256 = sha256File(compilerPath);
  if (sha256 !== TOOLCHAIN.compilerSha256) {
    throw new Error(
      `Unreviewed Hyperion compiler binary. Expected SHA-256 ${TOOLCHAIN.compilerSha256}, ` +
        `received ${sha256}.`
    );
  }

  return {
    path: compilerPath,
    version,
    sha256,
    hyperionCommit: TOOLCHAIN.hyperionCommit,
    qrvmAddressBytes: TOOLCHAIN.qrvmAddressBytes,
  };
}

function compilerErrors(output) {
  return (output.errors || []).filter((entry) => entry.severity === "error");
}

function compileContracts(compilerCommand = getCompilerCommand()) {
  const compiler = getCompilerIdentity(compilerCommand);

  const result = execFileSync(compiler.path, ["--standard-json"], {
    encoding: "utf8",
    input: JSON.stringify(createCompilerInput()),
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = JSON.parse(result);
  const errors = compilerErrors(output);
  if (errors.length > 0) {
    throw new Error(errors.map((entry) => entry.formattedMessage || entry.message).join("\n"));
  }
  return { compiler, output };
}

function GetCompilerOutput() {
  return compileContracts().output;
}

function getContractBytecode(output, sourceName, contractName) {
  const bytecode = output.contracts?.[sourceName]?.[contractName]?.qrvm?.bytecode?.object;
  if (typeof bytecode !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(bytecode)) {
    throw new Error(`${contractName} is missing QIP-55 QRVM bytecode`);
  }
  return bytecode;
}

if (require.main === module) {
  try {
    const { compiler, output } = compileContracts();
    const bytecode = getContractBytecode(
      output,
      "CustomERC20Factory.hyp",
      "CustomERC20Factory"
    );
    console.log(
      `Compiled CustomERC20Factory (${bytecode.length / 2} byte deployment image) with ` +
        `Hyperion ${compiler.version} (SHA-256 ${compiler.sha256})`
    );
  } catch (error) {
    console.error(`Compilation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_COMPILER_PATH,
  GetCompilerOutput,
  TOOLCHAIN,
  compileContracts,
  getCompilerCommand,
  getCompilerIdentity,
  getContractBytecode,
  resolveCompilerPath,
};
