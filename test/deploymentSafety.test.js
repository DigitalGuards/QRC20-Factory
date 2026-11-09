const test = require("node:test");
const assert = require("node:assert/strict");
const { Web3 } = require("@theqrl/web3");
const config = require("../config.json");

const {
  Q_ZERO_ADDRESS,
  assertContractCode,
  assertExpectedChain,
  hasDeployedCode,
  requireConfirmationCount,
  requireExpectedChainId,
  requireQAddress,
  requireRpcUrl,
  waitForTransactionConfirmations,
} = require("../utils/deploymentSafety");

test("accepts QIP-55 Q + 128-hex addresses", () => {
  const address = Web3.utils.toChecksumAddress(`Q${"ab".repeat(64)}`);
  assert.equal(requireQAddress(address), address);
  assert.equal(requireQAddress(Q_ZERO_ADDRESS), Q_ZERO_ADDRESS);
  assert.throws(() => requireQAddress(`Q${"aB".repeat(64)}`), /checksum/);
});

test("rejects legacy, malformed-width, 0x-prefixed, and lowercase-prefix addresses", () => {
  for (const address of [
    "Q",
    `Q${"ab".repeat(20)}`,
    `Q${"ab".repeat(63)}`,
    `Q${"ab".repeat(65)}`,
    `0x${"ab".repeat(64)}`,
    `q${"ab".repeat(64)}`,
  ]) {
    assert.throws(() => requireQAddress(address), /Q \+ 128-hex/);
  }
});

test("validates RPC URLs without embedded credentials", () => {
  assert.equal(requireRpcUrl("http://127.0.0.1:8545"), "http://127.0.0.1:8545/");
  assert.throws(() => requireRpcUrl("file:///tmp/rpc"), /HTTP or HTTPS/);
  assert.throws(() => requireRpcUrl("https://user:secret@example.test"), /credentials/);
});

test("requires an explicit chain and positive confirmation depth", () => {
  assert.equal(requireExpectedChainId(1337), 1337n);
  assert.equal(requireConfirmationCount(2), 2);
  assert.throws(() => requireExpectedChainId(undefined), /chain_id is required/);
  assert.throws(() => requireExpectedChainId(0), /positive integer/);
  assert.throws(() => requireConfirmationCount(0), /positive integer/);
});

test("fails closed on a chain mismatch", async () => {
  const web3 = { qrl: { getChainId: async () => 1338n } };
  await assert.rejects(() => assertExpectedChain(web3, 3151909n, config.genesis_hash), /Wrong network/);
});

test("pins v3 genesis independently of the reported chain ID", async () => {
  assert.equal(config.chain_id, 3151909);
  const web3 = { qrl: {
    getChainId: async () => BigInt(config.chain_id),
    getBlock: async (tag, transactions) => {
      assert.equal(tag, "0x0");
      assert.equal(transactions, false);
      return { hash: config.genesis_hash };
    },
  } };
  assert.equal(await assertExpectedChain(web3, 3151909n, config.genesis_hash), 3151909n);
  await assert.rejects(() => assertExpectedChain(web3, 3151909n), /genesis_hash/);
  web3.qrl.getBlock = async () => ({ hash: `0x${"ff".repeat(32)}` });
  await assert.rejects(() => assertExpectedChain(web3, 3151909n, config.genesis_hash), /genesis hash mismatch/);
  web3.qrl.getBlock = async () => ({});
  await assert.rejects(() => assertExpectedChain(web3, 3151909n, config.genesis_hash), /genesis hash mismatch/);
});

test("recognizes deployed bytecode and rejects empty targets", async () => {
  assert.equal(hasDeployedCode("0x60006000"), true);
  assert.equal(hasDeployedCode("0x"), false);
  assert.equal(hasDeployedCode("0x0"), false);
  assert.equal(hasDeployedCode("garbage"), false);
  assert.equal(hasDeployedCode("0x123"), false);

  const address = `Q${"12".repeat(64)}`;
  const web3 = { qrl: { getCode: async () => "0x" } };
  await assert.rejects(
    () => assertContractCode(web3, address, "factory"),
    /factory has no deployed bytecode/
  );
});

test("waits for the configured confirmation depth and rechecks the receipt", async () => {
  const receipt = {
    blockNumber: 100n,
    blockHash: "0xabc",
    transactionHash: "0x123",
    status: 1n,
  };
  const heights = [100n, 101n];
  let heightIndex = 0;
  const web3 = {
    qrl: {
      getBlockNumber: async () => heights[heightIndex++] ?? 101n,
      getTransactionReceipt: async () => ({ ...receipt }),
    },
  };

  const confirmed = await waitForTransactionConfirmations(web3, receipt, 2, {
    pollIntervalMs: 0,
    maxAttempts: 3,
  });

  assert.equal(confirmed.blockHash, receipt.blockHash);
  assert.equal(heightIndex, 2);
});

test("fails closed when the transaction block changes", async () => {
  const receipt = {
    blockNumber: 100n,
    blockHash: "0xabc",
    transactionHash: "0x123",
    status: 1n,
  };
  const web3 = {
    qrl: {
      getBlockNumber: async () => 101n,
      getTransactionReceipt: async () => ({ ...receipt, blockHash: "0xdef" }),
    },
  };

  await assert.rejects(
    () =>
      waitForTransactionConfirmations(web3, receipt, 2, {
        pollIntervalMs: 0,
        maxAttempts: 1,
      }),
    /block changed/
  );
});
