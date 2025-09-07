// Example lazy viem client loader for CommonJS projects
export async function getViem() {
  const viem = await import('viem');
  // e.g., const { createPublicClient, http } = viem;
  return viem;
}