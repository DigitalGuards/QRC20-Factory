// Runs the factory deploy and token creation scripts against a fake node with
// the installed @theqrl/web3, and decodes the transaction each one signs. A web3
// upgrade that changes how the fee pair is filled, or that refuses the
// transaction object the scripts build, fails here. No live network is used.
//
// The values pinned below are the ones @theqrl/web3 1.0.3 signed for the same
// node answers while the scripts still passed a legacy gasPrice, which 1.0.3
// dropped (measured side by side): tip = web3's default 2.5 Shor,
// cap = 2 * baseFee + tip.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MLDSA87 } = require("@theqrl/wallet.js");
const { Web3 } = require("@theqrl/web3");
const { TransactionFactory } = require("@theqrl/web3-qrl-accounts");
const config = require("../config.json");

const repoRoot = path.join(__dirname, "..");
const BASE_FEE = 100_000_000_000n;
const WEB3_DEFAULT_TIP = 2_500_000_000n;
const ESTIMATED_GAS = 3_000_000n;
const FACTORY = `Q${"12".repeat(64)}`;
const CREATED = `Q${"c0".repeat(64)}`;
const RECEIPT_BLOCK = 0x11n;

function startFakeNode() {
    const methods = [];
    const broadcasts = [];
    const receipts = new Map();
    const answer = (method, params) => {
        switch (method) {
            case "qrl_chainId":
                return `0x${BigInt(config.chain_id).toString(16)}`;
            case "net_version":
                return String(config.chain_id);
            case "qrl_getBlockByNumber":
                return {
                    number: params[0] === "0x0" ? "0x0" : "0x20",
                    hash: params[0] === "0x0" ? config.genesis_hash : `0x${"11".repeat(32)}`,
                    parentHash: `0x${"00".repeat(32)}`,
                    baseFeePerGas: `0x${BASE_FEE.toString(16)}`,
                    gasLimit: "0x1c9c380",
                    gasUsed: "0x0",
                    timestamp: "0x1",
                    transactions: [],
                };
            case "qrl_estimateGas":
                return `0x${ESTIMATED_GAS.toString(16)}`;
            case "qrl_getTransactionCount":
                return "0x5";
            case "qrl_blockNumber":
                return "0x20";
            case "qrl_call":
                return "0x";
            case "qrl_getCode":
                return "0x6000";
            case "qrl_sendRawTransaction": {
                const raw = params[0];
                broadcasts.push(raw);
                const hash = Web3.utils.keccak256(raw);
                receipts.set(hash, {
                    transactionHash: hash,
                    transactionIndex: "0x0",
                    blockHash: `0x${"22".repeat(32)}`,
                    blockNumber: `0x${RECEIPT_BLOCK.toString(16)}`,
                    from: `Q${"00".repeat(64)}`,
                    to: null,
                    cumulativeGasUsed: "0x5208",
                    gasUsed: "0x5208",
                    effectiveGasPrice: `0x${BASE_FEE.toString(16)}`,
                    contractAddress: CREATED,
                    logs: [],
                    logsBloom: `0x${"00".repeat(256)}`,
                    status: "0x1",
                    type: "0x2",
                });
                return hash;
            }
            case "qrl_getTransactionReceipt":
                return receipts.get(params[0]) ?? null;
            default:
                throw new Error(`fixture: unexpected ${method}`);
        }
    };
    const server = http.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
            body += chunk;
        });
        request.on("end", () => {
            const parsed = JSON.parse(body);
            const replies = (Array.isArray(parsed) ? parsed : [parsed]).map(({ id, method, params = [] }) => {
                methods.push(method);
                try {
                    return { jsonrpc: "2.0", id, result: answer(method, params) };
                } catch (error) {
                    return { jsonrpc: "2.0", id, error: { code: -32601, message: error.message } };
                }
            });
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
        });
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            resolve({
                url: `http://127.0.0.1:${server.address().port}`,
                methods,
                broadcasts,
                close: () => new Promise((done) => server.close(done)),
            });
        });
    });
}

// Run a script from a fresh directory, so no .env is read and the receipt files
// 2-onchain-call.js writes stay out of the repository.
function runScript(script, env) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qrc20-script-"));
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(repoRoot, script)], {
            cwd,
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("close", (code) => {
            const files = fs.readdirSync(cwd);
            fs.rmSync(cwd, { recursive: true, force: true });
            resolve({ code, stdout, stderr, files });
        });
    });
}

function decodeOnlyBroadcast(node) {
    assert.equal(node.broadcasts.length, 1);
    const signed = TransactionFactory.fromSerializedData(Web3.utils.hexToBytes(node.broadcasts[0]));
    assert.equal(signed.type, 2);
    return signed.toJSON();
}

function expectWeb3FeePair(json) {
    assert.equal(json.chainId, `0x${BigInt(config.chain_id).toString(16)}`);
    assert.equal(json.nonce, "0x5");
    assert.equal(json.gasLimit, `0x${((ESTIMATED_GAS * 12n) / 10n).toString(16)}`);
    assert.equal(json.maxPriorityFeePerGas, `0x${WEB3_DEFAULT_TIP.toString(16)}`);
    assert.equal(json.maxFeePerGas, `0x${(2n * BASE_FEE + WEB3_DEFAULT_TIP).toString(16)}`);
}

test("the factory deploy signs a type 2 creation with the fee pair web3 fills", { timeout: 120000 }, async () => {
    const node = await startFakeNode();
    const wallet = MLDSA87.newWallet();
    try {
        const run = await runScript("1-deploy.js", { RPC_URL: node.url, MNEMONIC: wallet.getMnemonic() });
        assert.equal(run.code, 0, run.stderr);
        assert.match(run.stdout, new RegExp(`Contract address: ${CREATED}`));
        const json = decodeOnlyBroadcast(node);
        expectWeb3FeePair(json);
        assert.equal(json.to, undefined);
        // The fee pair comes from the block alone: no gas price is asked for.
        assert.equal(node.methods.includes("qrl_gasPrice"), false);
    } finally {
        wallet.zeroize();
        await node.close();
    }
});

test("token creation signs a type 2 call to the factory with the fee pair web3 fills", { timeout: 120000 }, async () => {
    const node = await startFakeNode();
    const wallet = MLDSA87.newWallet();
    try {
        const run = await runScript("2-onchain-call.js", {
            RPC_URL: node.url,
            MNEMONIC: wallet.getMnemonic(),
            CUSTOM_ERC20_FACTORY_ADDRESS: FACTORY,
        });
        assert.equal(run.code, 0, run.stderr);
        assert.deepEqual(run.files.sort(), ["confirmation.json", "receipt.json"]);
        const json = decodeOnlyBroadcast(node);
        expectWeb3FeePair(json);
        assert.equal(json.to.toLowerCase(), FACTORY.toLowerCase());
        assert.match(json.data, /^0x[0-9a-f]{8}/);
        assert.equal(node.methods.includes("qrl_gasPrice"), false);
    } finally {
        wallet.zeroize();
        await node.close();
    }
});
