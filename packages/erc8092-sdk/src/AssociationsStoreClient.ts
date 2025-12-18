import { ethers } from "ethers";
import { ASSOCIATIONS_STORE_ABI } from "./abi";
import { associationIdFromRecord } from "./eip712";
import { formatEvmV1, tryParseEvmV1 } from "./erc7930";
import type { Association } from "./types";

type Runner = ethers.ContractRunner;

export class AssociationsStoreClient {
  readonly address: string;
  readonly contract: ethers.Contract;

  constructor(address: string, runner: Runner) {
    this.address = ethers.getAddress(address);
    this.contract = new ethers.Contract(this.address, ASSOCIATIONS_STORE_ABI, runner);
  }

  async getAssociationsForEvmAccount(params: {
    chainId: number;
    accountAddress: string;
  }): Promise<{ account: string; chainId: number; associations: Association[] }> {
    const account = ethers.getAddress(params.accountAddress);
    const interoperable = formatEvmV1(params.chainId, account);
    const sars = (await this.contract.getAssociationsForAccount(interoperable)) as any[];

    const mapped: Association[] = sars.map((sar) => {
      const initiatorParsed = tryParseEvmV1(sar.record.initiator);
      const approverParsed = tryParseEvmV1(sar.record.approver);
      const initiatorAddr = initiatorParsed?.address ?? sar.record.initiator;
      const approverAddr = approverParsed?.address ?? sar.record.approver;
      const associationId = associationIdFromRecord({
        initiator: sar.record.initiator,
        approver: sar.record.approver,
        validAt: Number(sar.record.validAt),
        validUntil: Number(sar.record.validUntil),
        interfaceId: sar.record.interfaceId,
        data: sar.record.data,
      });
      const aLower = account.toLowerCase();
      const counterparty =
        initiatorAddr.toLowerCase() === aLower ? approverAddr : approverAddr.toLowerCase() === aLower ? initiatorAddr : approverAddr;

      return {
        associationId,
        revokedAt: Number(sar.revokedAt),
        initiator: initiatorAddr,
        approver: approverAddr,
        counterparty,
        validAt: Number(sar.record.validAt),
        validUntil: Number(sar.record.validUntil),
      };
    });

    return { account, chainId: params.chainId, associations: mapped };
  }
}


