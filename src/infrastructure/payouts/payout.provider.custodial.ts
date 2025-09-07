import crypto from 'node:crypto';

function toDecimalFromUnits(amountWei: string, decimals: number): string {
  const bi = BigInt(amountWei);
  const base = BigInt(10) ** BigInt(decimals);
  const intPart = bi / base;
  const frac = bi % base;
  if (frac === 0n) return intPart.toString();
  const s = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${intPart.toString()}.${s}`;
}

export class CustodialPayoutProvider {
  private readonly apiKey = process.env.CIRCLE_API_KEY || '';
  private readonly baseUrl = process.env.CIRCLE_API_BASE || 'https://api.circle.com';
  private readonly blockchain = process.env.CIRCLE_BLOCKCHAIN || 'BASE';
  private readonly dcWalletId = process.env.CIRCLE_WALLET_ID || '';
  private readonly usdcAddressBase =
    process.env.CIRCLE_USDC_TOKEN_ADDRESS_BASE || process.env.USDC_ADDRESS_BASE || '';

  constructor() {
    if (!this.apiKey) throw new Error('CUSTODIAL(Circle): CIRCLE_API_KEY missing');
    if (!this.dcWalletId) throw new Error('CUSTODIAL(Circle): CIRCLE_WALLET_ID missing');
    if (!process.env.CIRCLE_ENTITY_SECRET)
      throw new Error('CUSTODIAL(Circle): CIRCLE_ENTITY_SECRET missing (32-byte hex).');
  }

  private async generateEntitySecretCiphertext(): Promise<string> {
    const mod = await import('@circle-fin/developer-controlled-wallets');
    const client = (mod as any).initiateDeveloperControlledWalletsClient({
      apiKey: this.apiKey,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });
    return (await client.generateEntitySecretCiphertext()) as string;
  }

  /**
   * token: 'ETH' or 'USDC'
   * amountWei: integer string in smallest units (ETH 18dp, USDC 6dp)
   * returns Circle transaction id (store as txHash surrogate)
   */
  async sendTransfer(token: 'ETH' | 'USDC', to: string, amountWei: string): Promise<string> {
    const idempotencyKey = crypto.randomUUID();
    const entitySecretCiphertext = await this.generateEntitySecretCiphertext();

    const isEth = token === 'ETH';
    const decimals = isEth ? 18 : 6;
    const amount = toDecimalFromUnits(amountWei, decimals);

    const url = `${this.baseUrl}/v1/w3s/developer/transactions/transfer`;
    const body: any = {
      walletId: this.dcWalletId,
      destinationAddress: to,
      idempotencyKey,
      entitySecretCiphertext,
      amounts: [amount],
      feeLevel: 'MEDIUM',
    };

    if (isEth) {
      body.blockchain = this.blockchain;
      body.tokenAddress = '';
    } else {
      if (!this.usdcAddressBase) throw new Error('CUSTODIAL: USDC token address missing');
      body.blockchain = this.blockchain;
      body.tokenAddress = this.usdcAddressBase;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        'X-Request-Id': idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Circle transfer failed: ${res.status} ${await res.text()}`);
    const json: any = await res.json();
    return json?.data?.id || idempotencyKey;
  }
}