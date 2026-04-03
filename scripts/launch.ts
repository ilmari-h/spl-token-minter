import { z } from "zod/v4";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createV1,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  generateSigner,
  signerIdentity,
  percentAmount,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";

const ConfigSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().min(0).max(18),
  metadataUri: z.url(),
});

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: bun scripts/launch.ts <config.json>");
    process.exit(1);
  }

  const configFile = Bun.file(configPath);
  if (!(await configFile.exists())) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const raw = await configFile.json();
  const config = ConfigSchema.parse(raw);

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    console.error("RPC_URL env var is not set");
    process.exit(1);
  }

  const keypairRaw = process.env.MINT_AUTHORITY_KEYPAIR;
  if (!keypairRaw) {
    console.error("MINT_AUTHORITY_KEYPAIR env var is not set");
    process.exit(1);
  }

  const secretKey = new Uint8Array(JSON.parse(keypairRaw));

  const umi = createUmi(rpcUrl);
  umi.use(mplTokenMetadata());
  umi.use(mplToolbox());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  console.log(`Creating token "${config.name}" (${config.symbol})...`);
  console.log(`Authority: ${signer.publicKey}`);
  console.log(`Metadata URI: ${config.metadataUri}`);

  const mintSigner = generateSigner(umi);

  await createV1(umi, {
    mint: mintSigner,
    authority: signer,
    name: config.name,
    symbol: config.symbol,
    uri: config.metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: config.decimals,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  const mintAddress = mintSigner.publicKey;
  console.log(`\nToken mint created: ${mintAddress}`);
  console.log(`\nAdd this to your .env file:\nTOKEN_MINT=${mintAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
