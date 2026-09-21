# Custom QRC20 Factory

Hyperion contracts and deployment tooling for custom QRC20 tokens on MyQRLWallet Testnet v3 (private). Tokens support configurable supply, wallet and transaction limits. This network uses native 64-byte QIP-55 addresses.

## Requirements

- Node.js 22 and npm.
- The exact qualified Hyperion compiler in `config/hyperion-toolchain.json`.
- QIP-55 Web3 `1.0.3`, installed by `npm ci`.
- An explicitly configured RPC endpoint and a funded ML-DSA-87 test wallet.

## Compiler qualification

The default compiler is `../hyperion/build/hypc/hypc`. `HYPERION_COMPILER` or `HYPC_BIN` may select the same qualified binary at another location. Compilation verifies both its version and SHA-256 before accepting output.

The pinned compiler is built from `DigitalGuards/hyperion` commit `302c8805f122aac69664184f9a3c592436768d6c`. The platform-specific version and binary hash are recorded in the toolchain configuration. The deployment path consumes the compiler's 64-byte QRVM output.

```bash
npm ci
npm test
npm run build
```

Tests cover compiler substitution rejection, QIP-55 wallet/account/ABI composition, distinct addresses sharing their low 32 bytes, network identity, and receipt checks. Address-keyed token mappings use explicit typed accessors.

## Deployment configuration

Copy `.env.example` to a private `.env` and supply `RPC_URL`, the funded deployer's 34-word `MNEMONIC`, and any existing contract addresses. Never commit credentials or deployment inventories.

Factory deployment requires an operator-authorized RPC endpoint that accepts a signed JSON-RPC request larger than 50 KiB. The qualified factory creation transaction is approximately 51.8 kB, including its ML-DSA signature and public key; the public wallet proxy has a 50 KiB request limit. Normal `createToken` calls fit that limit (approximately 16.3 kB for the tested parameters). Keep the public proxy's limit in place and select an appropriately bounded deployment endpoint for the one-time factory deployment. Reconcile any ambiguous submission before retrying.

`config.json` pins chain ID `3151909`, genesis hash `0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4`, and two confirmations. Write scripts verify chain and genesis before signing, include the expected chain ID in the transaction, and validate the confirmed receipt. Contract and account addresses must use `Q` followed by 128 hexadecimal characters, with a valid checksum when mixed case is used.

After deployment approval, run:

```bash
npm run deploy
# Set CUSTOM_ERC20_FACTORY_ADDRESS from the confirmed deployment.
npm run create-token
# Set CUSTOM_ERC20_ADDRESS from the confirmed TokenCreated event.
npm run token-info
```

Review the example token parameters in `2-onchain-call.js` before creating a token. A zero recipient requests the factory caller as initial recipient. `HOLDER_ADDRESS` selects the account queried by `token-info`.

Existing v2 deployment addresses are historical records. New v3 deployments require new addresses and separate consumer configuration. Passing local compilation and tests does not establish that a factory is deployed or enabled in the web wallet.

## License

See [LICENSE](LICENSE).
