const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { MLDSA87 } = require("@theqrl/wallet.js");
const { Web3 } = require("@theqrl/web3");
const { GetCompilerOutput, getContractBytecode } = require("../contract-compiler");
const { Q_ZERO_ADDRESS, requireQAddress } = require("../utils/deploymentSafety");

const CONTRACT_SOURCES = ["CustomERC20.hyp", "ERC20.hyp"];

function requireFunction(abi, name, inputTypes, outputTypes) {
  const definition = abi.find((entry) => entry.type === "function" && entry.name === name);
  assert.ok(definition, `ABI is missing ${name}`);
  assert.deepEqual(definition.inputs.map((input) => input.type), inputTypes);
  assert.deepEqual(definition.outputs.map((output) => output.type), outputTypes);
}

test("composes QIP-55 Hyperion, wallet, account, and 64-byte ABI paths", () => {
  const output = GetCompilerOutput();
  const factory = output.contracts?.["CustomERC20Factory.hyp"]?.CustomERC20Factory;
  assert.ok(factory);
  assert.ok(
    getContractBytecode(output, "CustomERC20Factory.hyp", "CustomERC20Factory").length > 0
  );

  const wallet = MLDSA87.newWallet();
  const web3 = new Web3();
  const account = web3.qrl.accounts.seedToAccount(wallet.getHexExtendedSeed());
  requireQAddress(wallet.getAddressStr(), "wallet address");
  requireQAddress(account.address, "account address");
  assert.equal(account.address.toLowerCase(), wallet.getAddressStr().toLowerCase());

  const encodedAddress = web3.qrl.abi.encodeParameter("address", account.address);
  assert.equal(encodedAddress.length, 2 + 128);
  assert.equal(
    web3.qrl.abi.decodeParameter("address", encodedAddress).toLowerCase(),
    account.address.toLowerCase()
  );

  const factoryAddress = `Q${"12".repeat(64)}`;
  const contract = new web3.qrl.Contract(factory.abi, factoryAddress);
  const callData = contract.methods
    .createToken(
      "QRL Token",
      "QT",
      "1000000",
      18,
      "10000000",
      Q_ZERO_ADDRESS,
      "100000",
      "10000"
    )
    .encodeABI();

  assert.equal(contract.options.address, factoryAddress);
  assert.ok(callData.includes(Q_ZERO_ADDRESS.slice(1)));

  const token = output.contracts?.["CustomERC20.hyp"]?.CustomERC20;
  assert.ok(token);
  requireFunction(token.abi, "balanceOf", ["address"], ["uint256"]);
  requireFunction(token.abi, "allowance", ["address", "address"], ["uint256"]);
  requireFunction(token.abi, "isExcludedFromLimits", ["address"], ["bool"]);

  const sharedLowHalf = "ab".repeat(32);
  const firstQ128 = `Q${"11".repeat(32)}${sharedLowHalf}`;
  const secondQ128 = `Q${"22".repeat(32)}${sharedLowHalf}`;
  const tokenContract = new web3.qrl.Contract(token.abi, factoryAddress);
  const firstCall = tokenContract.methods.balanceOf(firstQ128).encodeABI();
  const secondCall = tokenContract.methods.balanceOf(secondQ128).encodeABI();

  assert.equal(firstCall.length, 2 + 8 + 128);
  assert.equal(secondCall.length, 2 + 8 + 128);
  assert.notEqual(firstCall, secondCall);
  assert.ok(firstCall.endsWith(firstQ128.slice(1).toLowerCase()));
  assert.ok(secondCall.endsWith(secondQ128.slice(1).toLowerCase()));
});

test("keeps address-keyed mappings behind explicit Q128 accessors", () => {
  for (const sourceName of CONTRACT_SOURCES) {
    const source = fs.readFileSync(path.join(__dirname, "..", "contracts", sourceName), "utf8");
    const mappingDeclarations = source
      .split(/\r?\n/)
      .filter((line) => line.includes("mapping("));

    assert.ok(mappingDeclarations.length > 0, `${sourceName} has no mapping declarations`);
    for (const declaration of mappingDeclarations) {
      assert.match(declaration, /\bprivate\b/, `${sourceName} exposes a generated mapping getter`);
    }
  }
});
