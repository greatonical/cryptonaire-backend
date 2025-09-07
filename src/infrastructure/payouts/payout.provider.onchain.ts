export class OnchainPayoutProvider {
  constructor(
    private readonly rpcUrl = process.env.BASE_RPC_URL || '',
    private readonly privateKey = process.env.DISTRIBUTOR_PRIVATE_KEY || '',
    private readonly usdcAddress = process.env.USDC_ADDRESS_BASE || ''
  ) {
    if (!this.rpcUrl) throw new Error('ONCHAIN: BASE_RPC_URL missing');
    if (!this.privateKey) throw new Error('ONCHAIN: DISTRIBUTOR_PRIVATE_KEY missing');
  }

  private async clients() {
    const viem = await import('viem');
    const accounts = await import('viem/accounts');
    const { createPublicClient, createWalletClient, http } = viem as any;
    const { privateKeyToAccount } = accounts as any;

    const chainId = Number(process.env.BASE_CHAIN_ID || 8453);
    const account = privateKeyToAccount(this.privateKey as any);
    const transport = http(this.rpcUrl);

    const publicClient = createPublicClient({ chain: { id: chainId }, transport });
    const walletClient = createWalletClient({ chain: { id: chainId }, account, transport });
    return { publicClient, walletClient, viem: viem as any };
  }

  async sendEth(to: string, amountWei: string): Promise<string> {
    const { publicClient, walletClient, viem } = await this.clients();
    const { getAddress } = viem;
    const hash = await walletClient.sendTransaction({
      to: getAddress(to),
      value: BigInt(amountWei),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async sendUsdc(to: string, amountWei: string): Promise<string> {
    if (!this.usdcAddress) throw new Error('ONCHAIN: USDC_ADDRESS_BASE missing');
    const { publicClient, walletClient, viem } = await this.clients();
    const { parseAbi, getAddress } = viem;

    const erc20Abi = parseAbi(['function transfer(address to, uint256 value) returns (bool)']);
    const hash = await walletClient.writeContract({
      address: this.usdcAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [getAddress(to), BigInt(amountWei)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}