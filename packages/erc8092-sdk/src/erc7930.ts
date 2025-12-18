import { ethers } from "ethers";

function toMinimalBigEndianBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0]);
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return ethers.getBytes(`0x${hex}`);
}

// Mirrors `InteroperableAddress.formatEvmV1(chainid, addr)` from the Solidity repo.
export function formatEvmV1(chainId: number, address: string): string {
  const addr = ethers.getAddress(address);
  const chainRef = toMinimalBigEndianBytes(BigInt(chainId));

  // bytes4(0x00010000) || uint8(chainRef.length) || chainRef || uint8(20) || address
  const head = ethers.getBytes("0x00010000");
  const out = ethers.concat([
    head,
    new Uint8Array([chainRef.length]),
    chainRef,
    new Uint8Array([20]),
    ethers.getBytes(addr),
  ]);

  return ethers.hexlify(out);
}

export function tryParseEvmV1(interoperableHex: string): { chainId: number; address?: string } | null {
  try {
    const bytes = ethers.getBytes(interoperableHex);
    if (bytes.length < 6) return null;
    const version = (bytes[0] << 8) | bytes[1];
    if (version !== 0x0001) return null;
    const chainType = (bytes[2] << 8) | bytes[3];
    if (chainType !== 0x0000) return null; // eip-155 only
    const chainRefLen = bytes[4];
    if (bytes.length < 6 + chainRefLen) return null;
    const chainRefStart = 5;
    const chainRefEnd = chainRefStart + chainRefLen;
    const addrLen = bytes[chainRefEnd];
    const addrStart = chainRefEnd + 1;
    const addrEnd = addrStart + addrLen;
    if (bytes.length < addrEnd) return null;

    let chainId = 0;
    for (let i = chainRefStart; i < chainRefEnd; i++) chainId = (chainId << 8) + bytes[i]!;

    if (addrLen === 20) {
      const addrBytes = bytes.slice(addrStart, addrEnd);
      return { chainId, address: ethers.getAddress(ethers.hexlify(addrBytes)) };
    }
    return { chainId };
  } catch {
    return null;
  }
}


