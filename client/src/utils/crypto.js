import { Wallet } from 'ethers';

/**
 * Generate a new random ECC wallet
 * @returns { { mnemonic: string, address: string, privateKey: string, wallet: Wallet } }
 */
export function generateWallet() {
  const wallet = Wallet.createRandom();
  return {
    mnemonic: wallet.mnemonic.phrase,
    address: wallet.address,
    privateKey: wallet.privateKey,
    wallet,
  };
}

/**
 * Restore an existing wallet using a 12-to-24 word BIP39 phrase
 * @param {string} phrase
 * @returns { Wallet }
 */
export function restoreWallet(phrase) {
  return Wallet.fromPhrase(phrase.trim());
}

/**
 * Re-instantiate from a private key directly (used for local session)
 * @param {string} privateKey
 * @returns { Wallet }
 */
export function getWalletFromPrivateKey(privateKey) {
  return new Wallet(privateKey);
}

/**
 * Signs a structured string payload
 * @param {Wallet} wallet
 * @param {string} message
 * @returns {Promise<string>}
 */
export async function signPayload(wallet, message) {
  return await wallet.signMessage(message);
}
