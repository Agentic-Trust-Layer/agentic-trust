import { ethers } from "ethers";
import { ASSOCIATIONS_STORE_ABI } from "./abi";
import { associationIdFromRecord } from "./eip712";
import { formatEvmV1, tryParseEvmV1 } from "./erc7930";
import type { Association, SignedAssociation } from "./types";

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

  /**
   * Fetch the full SignedAssociationRecords (SARs) for an EVM account and augment
   * with deterministic associationId + best-effort parsed addresses.
   */
  async getSignedAssociationsForEvmAccount(params: {
    chainId: number;
    accountAddress: string;
  }): Promise<{ account: string; chainId: number; sars: SignedAssociation[] }> {
    const account = ethers.getAddress(params.accountAddress);
    const interoperable = formatEvmV1(params.chainId, account);
    const sars = (await this.contract.getAssociationsForAccount(interoperable)) as any[];

    const mapped: SignedAssociation[] = sars.map((sar) => {
      const record = sar.record as any;
      const associationId = associationIdFromRecord({
        initiator: record.initiator,
        approver: record.approver,
        validAt: Number(record.validAt),
        validUntil: Number(record.validUntil),
        interfaceId: record.interfaceId,
        data: record.data,
      });

      const initiatorParsed = tryParseEvmV1(record.initiator);
      const approverParsed = tryParseEvmV1(record.approver);
      const initiatorAddr = initiatorParsed?.address;
      const approverAddr = approverParsed?.address;
      const aLower = account.toLowerCase();
      const counterparty =
        initiatorAddr && initiatorAddr.toLowerCase() === aLower
          ? approverAddr
          : approverAddr && approverAddr.toLowerCase() === aLower
            ? initiatorAddr
            : approverAddr;

      return {
        associationId,
        revokedAt: Number(sar.revokedAt),
        initiatorKeyType: String(sar.initiatorKeyType),
        approverKeyType: String(sar.approverKeyType),
        initiatorSignature: String(sar.initiatorSignature),
        approverSignature: String(sar.approverSignature),
        record: {
          initiator: String(record.initiator),
          approver: String(record.approver),
          validAt: Number(record.validAt),
          validUntil: Number(record.validUntil),
          interfaceId: String(record.interfaceId),
          data: String(record.data),
        },
        initiatorAddress: initiatorAddr,
        approverAddress: approverAddr,
        counterpartyAddress: counterparty,
      };
    });

    return { account, chainId: params.chainId, sars: mapped };
  }
}


