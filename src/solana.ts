import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendTransactionWithoutConfirmingFactory,
  address,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  fetchMint,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToCheckedInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
  type Mint,
} from "@solana-program/token";

let cachedMint: Mint | null = null;
let cachedSigner: KeyPairSigner | null = null;

function getRpcUrl(): string {
  const url = process.env.RPC_URL;
  if (!url) throw new Error("RPC_URL env var is not set");
  return url;
}

export function getRpc() {
  return createSolanaRpc(getRpcUrl());
}

export function getRpcSubscriptions() {
  return createSolanaRpcSubscriptions(getRpcUrl().replace("http", "ws"));
}

export async function loadSigner(): Promise<KeyPairSigner> {
  if (cachedSigner) return cachedSigner;
  const raw = process.env.MINT_AUTHORITY_KEYPAIR;
  if (!raw) throw new Error("MINT_AUTHORITY_KEYPAIR env var is not set");
  const bytes = new Uint8Array(JSON.parse(raw));
  cachedSigner = await createKeyPairSignerFromBytes(bytes);
  return cachedSigner;
}

export function getMintAddress(): Address {
  const addr = process.env.TOKEN_MINT;
  if (!addr) throw new Error("TOKEN_MINT env var is not set");
  return address(addr);
}

export async function mintTokens(
  recipient: string,
  amount: number,
): Promise<string> {
  const rpc = getRpc();
  const signer = await loadSigner();
  const mintAddress = getMintAddress();

  if (!cachedMint) {
    const mintAccount = await fetchMint(rpc, mintAddress);
    cachedMint = mintAccount.data;
  }

  const recipientAddress = address(recipient);
  const rawAmount = BigInt(amount) * 10n ** BigInt(cachedMint.decimals);

  const [ata] = await findAssociatedTokenPda({
    owner: recipientAddress,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintAddress,
  });

  const createAtaIx =
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: signer,
      owner: recipientAddress,
      mint: mintAddress,
    });

  const mintToIx = getMintToCheckedInstruction({
    mint: mintAddress,
    token: ata,
    mintAuthority: signer,
    amount: rawAmount,
    decimals: cachedMint.decimals,
  });

  const { value: blockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayerSigner(signer, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(blockhash, msg),
    (msg) => appendTransactionMessageInstructions([createAtaIx, mintToIx], msg),
  );

  const tx = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(tx);

  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc });

  try {
    await sendTransaction(tx, { commitment: "confirmed" });
  } catch (err) {
    console.error("sendTransaction failed:", { signature, recipient, amount, err });
    throw err;
  }

  console.log("Minted tokens:", { signature, recipient, amount: rawAmount.toString() });
  return signature;
}
