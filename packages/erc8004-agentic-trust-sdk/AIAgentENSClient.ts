/**
 * Agentic Trust SDK - ENS Client
 * Uses AccountProvider (Ports & Adapters pattern) for chain I/O.
 */
import { createPublicClient, http, namehash, labelhash, parseAbi, toHex, encodeFunctionData, decodeFunctionResult,hexToString, type Chain, type PublicClient } from 'viem';
import { packetToBytes, normalize } from 'viem/ens'
import { ethers } from 'ethers';
import { sepolia } from 'viem/chains';
import { AccountProvider } from '@agentic-trust/8004-sdk';

import BaseRegistrarABI from  './abis/BaseRegistrarImplementation.json'
import ETHRegistrarControllerABI from './abis/ETHRegistrarController.json';
import NameWrapperABI from './abis/NameWrapper.json';
import PublicResolverABI from './abis/PublicResolver.json';


export class AIAgentENSClient {
  private chain: Chain;
  private accountProvider: AccountProvider;
  private ensRegistryAddress: `0x${string}`;
  private ensResolverAddress: `0x${string}`;
  private identityRegistryAddress: `0x${string}`;
  private publicClient: PublicClient | null = null;

  constructor(
    chain: Chain,
    rpcUrl: string,
    accountProvider: AccountProvider,
    ensRegistryAddress: `0x${string}`,
    ensResolverAddress: `0x${string}`,
    identityRegistryAddress: `0x${string}`,
  ) {
    this.chain = chain;
    this.accountProvider = accountProvider;
    // @ts-ignore - viem version compatibility issue
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) } as any);
    this.ensRegistryAddress = ensRegistryAddress;
    this.ensResolverAddress = ensResolverAddress;
    this.identityRegistryAddress = identityRegistryAddress;

    // Try to extract publicClient from AccountProvider if it's a ViemAccountProvider
    const viemProvider = accountProvider as any;
    if (viemProvider.publicClient) {
      this.publicClient = viemProvider.publicClient;
    }
  }

  getEnsRegistryAddress(): `0x${string}` {
    return this.ensRegistryAddress;
  }
  
  getEnsResolverAddress(): `0x${string}` {
    return this.ensResolverAddress;
  }

  /**
   * Check if this client is for L1 (ETH Sepolia)
   * Base implementation - can be overridden by subclasses
   */
  isL1(): boolean {
    // Default implementation: assume L1 unless overridden
    // Subclasses like AIAgentL2ENSClient will override this
    return !this.isL2();
  }

  /**
   * Check if this client is for L2 (Base Sepolia, Optimism Sepolia, etc.)
   * Base implementation - can be overridden by subclasses
   */
  isL2(): boolean {
    // Default implementation: assume L1 unless overridden
    // Subclasses like AIAgentL2ENSClient will override this
    return false;
  }

  /**
   * Get the chain type as a string
   */
  getChainType(): 'L1' | 'L2' {
    return this.isL2() ? 'L2' : 'L1';
  }

  encodeCall(
    abi: any[],
    functionName: string,
    args: any[]
  ): string {
    const iface = new ethers.Interface(abi);
    return iface.encodeFunctionData(functionName, args);
  }


  async encodeSetNameUri(name: string, uri: string): Promise<`0x${string}`>  {
    const node = namehash(name) as `0x${string}`;
    const data = encodeFunctionData({
        abi: PublicResolverABI.abi,
        functionName: 'setText',
        args: [node, "url", uri]
    });
    return data as `0x${string}`;
  }
  async prepareSetNameUriCalls(
    name: string,
    uri: string
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {

    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];

    const data = await this.encodeSetNameUri(name, uri);
    

    if (this.publicClient) {
      const resolver = this.getEnsResolverAddress();
      /*
        const node = namehash(name) as `0x${string}`;
        const resolver = await this.// @ts-ignore - viem version compatibility issue
    publicClient.readContract({
            address: this.ensRegistryAddress,
            abi: [{ name: "resolver", stateMutability: "view", type: "function",
                    inputs: [{ name: "node", type: "bytes32"}], outputs: [{ type: "address"}]}],
            functionName: "resolver",
            args: [node],
        });
        */
        console.info("++++++++++++++++++++ prepareSetNameUriCalls: chain", this.publicClient?.chain?.id);
        console.info("++++++++++++++++++++ prepareSetNameUriCalls: resolver", resolver);

        calls.push({ to: resolver, data: data as `0x${string}`});
    }

    return { calls };

  } 

  async prepareAddAgentInfoCalls(params: {
    orgName: string;            // e.g., 'airbnb.eth'
    agentName: string;          // e.g., 'my-agent'
    agentAddress: `0x${string}`; // AA address for the agent name
    agentUrl: string    //  URL
    agentDescription?: string | null    // optional description
  }): Promise<{ calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }> {
    return { calls: [] };
  }

  async prepareSetNameImageCalls(
    name: string,
    imageUrl: string
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
    const node = namehash(name) as `0x${string}`;
    const data = encodeFunctionData({
      abi: PublicResolverABI.abi,
      functionName: 'setText',
      args: [node, "avatar", imageUrl]
    });

    if (this.publicClient) {
      const resolver = this.getEnsResolverAddress();
      console.info("++++++++++++++++++++ prepareSetNameImageCalls: chain", this.publicClient?.chain?.id);
      console.info("++++++++++++++++++++ prepareSetNameImageCalls: resolver", resolver);
      calls.push({ to: resolver, data: data as `0x${string}` });
    }

    return { calls };
  }

  async prepareSetNameDescriptionCalls(
    name: string,
    description: string
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
    const node = namehash(name) as `0x${string}`;
    const data = encodeFunctionData({
      abi: PublicResolverABI.abi,
      functionName: 'setText',
      args: [node, "description", description]
    });

    if (this.publicClient) {
      const resolver = this.getEnsResolverAddress();
      console.info("++++++++++++++++++++ prepareSetNameDescriptionCalls: chain", this.publicClient?.chain?.id);
      console.info("++++++++++++++++++++ prepareSetNameDescriptionCalls: resolver", resolver);
      calls.push({ to: resolver, data: data as `0x${string}` });
    }

    return { calls };
  }

  async encodeSetNameAgentIdentity(name: string, agentIdentity: BigInt): Promise<`0x${string}`>  {

    // Build ERC-7930 (approx) binary: [v1=01][ns=eip155=01][chainId(4 bytes)][address(20 bytes)] + [len(1)][agentId bytes]
    const chainHex = (this.chain.id >>> 0).toString(16).padStart(8, '0');
    const addrHex = (this.identityRegistryAddress).slice(2).toLowerCase().padStart(40, '0');
    const idHex = agentIdentity.toString(16);
    const idLen = Math.ceil(idHex.length / 2);
    const idLenHex = idLen.toString(16).padStart(2, '0');
    const valueHex = `0x01` + `01` + chainHex + addrHex + idLenHex + idHex.padStart(idLen * 2, '0');

    const node = namehash(name) as `0x${string}`;
    const data = encodeFunctionData({
        abi: PublicResolverABI.abi,
        functionName: 'setText',
        args: [node, "agent-identity", valueHex]
    });
    return data as `0x${string}`;
  }
  async prepareSetNameAgentIdentityCalls(
    name: string,
    agentIdentity: BigInt
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {

    const data = await this.encodeSetNameAgentIdentity(name, agentIdentity);
    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];

    if (this.publicClient) {
        const node = namehash(name) as `0x${string}`;
        const resolver = await this.// @ts-ignore - viem version compatibility issue
    publicClient.readContract({
            address: this.ensRegistryAddress,
            abi: [{ name: "resolver", stateMutability: "view", type: "function",
                    inputs: [{ name: "node", type: "bytes32"}], outputs: [{ type: "address"}]}],
            functionName: "resolver",
            args: [node],
        });

        calls.push({ to: resolver, data: data as `0x${string}`});
    }

    return { calls };

  } 

  async isValidAgentAccount(agentAccount: `0x${string}`): Promise<boolean | null> {
    if (this.publicClient) {
    const code = await this.publicClient.getBytecode({ address: agentAccount as `0x${string}` });
      return code ? true : false;
    } 
    return false;
  }


  /**
   * Resolve an agent by account address via ENS reverse + text record.
   * 1) Reverse resolve address -> ENS name via ENS Registry + resolver.name(bytes32)
   * 2) Read resolver.text(node, 'agent-identity') and decode agentId
   */
  async getAgentIdentityByAccount(account: `0x${string}`): Promise<{ agentId: bigint | null; ensName: string | null }> {
    const ensRegistry = this.ensRegistryAddress;
    const accountLower = account.toLowerCase();

    // Minimal ABIs
    const ENS_REGISTRY_ABI = [
      { name: 'resolver', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
    ] as any[];
    const RESOLVER_ABI = [
      { name: 'name', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'string' }] },
      { name: 'text', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }], outputs: [{ name: '', type: 'string' }] },
    ] as any[];


    const reverseNode = namehash(`${accountLower.slice(2)}.addr.reverse`);

    // 1) resolver for reverse node
    let resolverAddr: `0x${string}` | null = null;
    try {
      resolverAddr = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{
            name: 'resolver',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'address' }]
        }] as any,
        functionName: 'resolver',
        args: [reverseNode],
      });


    } catch {}
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return { agentId: null, ensName: null };
    }

    // 2) resolver.name to get ENS name
    let ensName: string | null = null;
    try {

      ensName = await this.accountProvider.call<string>({
        to: resolverAddr,
        abi: PublicResolverABI.abi as any,
        functionName: 'name',
        args: [reverseNode],
      }).catch(() => null);


      if (typeof ensName !== 'string' || !ensName) ensName = null;
    } catch {}

    // 3) resolver.text(node, 'agent-identity') on forward node if we have a name
    let agentId: bigint | null = null;
    if (ensName) {
      const forwardNode = namehash(ensName);
      try {

        const value = await this.accountProvider.call<string>({
          to: resolverAddr,
          abi: PublicResolverABI.abi as any,
          functionName: 'text',
          args: [forwardNode, 'agent-identity'],
        }).catch(() => null);

        const decoded = this.decodeAgentIdentity(value);
        agentId = decoded?.agentId ?? null;
      } catch {}
    }

    return { agentId, ensName };
  }

  /**
   * Resolve an agent by ENS name via resolver.text(namehash(name), 'agent-identity')
   */
  async getAgentIdentityByName(name: string): Promise<{ agentId: bigint | null; account: string | null }> {
    let ensName = name.trim().toLowerCase();
    if (!ensName) return  { agentId: null, account: null };

    ensName = ensName.endsWith('.eth') ? ensName.slice(0, -4) : ensName;
    ensName = ensName + '.eth';
    const node = namehash(ensName);

    // resolver
    let resolverAddr: `0x${string}` | null = null;
    try {

      resolverAddr = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{
            name: 'resolver',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'address' }]
        }] as any,
        functionName: 'resolver',
        args: [node],
      });
      // returns 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5
    } catch (error) {
      console.info("++++++++++++++++++++ getAgentIdentityByName 1: error", error);
      return { agentId: null, account: null }; // Return null if we can't get resolver
    }
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return { agentId: null, account: null };
    }

    // agent-identity text
    let agentId: bigint | null = null;
    try {

      const value = await this.accountProvider.call<string>({
        to: resolverAddr,
        abi: PublicResolverABI.abi as any,
        functionName: 'text',
        args: [node, 'agent-identity'],
      }).catch(() => null);

      // Handle empty response
      if (!value || value === '0x' || value === '') {
        console.info("++++++++++++++++++++ getAgentIdentityByName: empty agent-identity text record");
        return { agentId: null, account: null };
      }
      
      const decoded = this.decodeAgentIdentity(value as string);
      agentId = decoded?.agentId ?? null;
    } catch (error) {
      console.info("++++++++++++++++++++ getAgentIdentityByName 2: error", error);
      return { agentId: null, account: null }; // Return null if we can't get the text record
    }

    return { agentId, account: null };
  }


  /**
   * Check if an agent name record already has an owner in the ENS Registry.
   * This doesn't require an address to be set, just checks if the record exists.
   */
  async hasAgentNameOwner(orgName: string, agentName: string): Promise<boolean> {
    const clean = (s: string) => (s || '').trim().toLowerCase();
    let parent = clean(orgName);
    parent = parent.endsWith('.eth') ? parent.slice(0, -4) : parent;
    const label = clean(agentName).replace(/\s+/g, '-');
    const fullSubname = `${label}.${parent}.eth`;
    const subnameNode = namehash(fullSubname);

    try {
      const existingOwner = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] }] as any,
        functionName: 'owner',
        args: [subnameNode],
      });
      
      const hasOwner = Boolean(existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000');
      console.info(`hasAgentNameOwner: "${fullSubname}" ${hasOwner ? 'HAS owner' : 'has NO owner'}${hasOwner ? `: ${existingOwner}` : ''}`);
      return hasOwner;
    } catch (error) {
      console.error('Error checking agent name owner:', error);
      return false;
    }
  }


  /**
   * Resolve account address for an ENS name via resolver.addr(namehash(name)).
   */
  async getAgentAccountByName(name: string): Promise<`0x${string}` | null> {



    let ensName = name.trim().toLowerCase();
    ensName = ensName.endsWith('.eth') ? ensName.slice(0, -4) : ensName;
    ensName = ensName + '.eth';

    
    const normalizedName = normalize(ensName)
    const addr = await this.publicClient?.getEnsAddress({
      name: normalizedName
    });

    console.log('*********** zzz getAgentAccountByName normalizedName', normalizedName);
    console.log('*********** zzz getAgentAccountByName addr', addr);
    return addr as `0x${string}` | null;

    /*

        const universalResolverAbi = parseAbi([
      'error ResolverNotFound(bytes name)',
      'error ResolverNotContract(bytes name, address resolver)',
      'error UnsupportedResolverProfile(bytes4 selector)',
      'error ResolverError(bytes errorData)',
      'error ReverseAddressMismatch(string primary, bytes primaryAddress)',
      'error HttpError(uint16 status, string message)',
      'function resolve(bytes name, bytes data) view returns (bytes result, address resolver)',
      'function reverse(bytes lookupAddress, uint256 coinType) view returns (string primary, address resolver, address reverseResolver)',
    ])

    // universal resolver
    const resolverAddr: `0x${string}` = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
    

    try {


      // construct data read
      const simpleResolverAbi1 = parseAbi([
        'function addr(bytes32 node) view returns (address)',
        'function text(bytes32 node, string key) view returns (string)',
      ])
       
      const multicallAbi = parseAbi([
        'function multicall(bytes[] data) returns (bytes[] results)',
      ])
       
      const name = normalize(ensName)
      const node1 = namehash(name)
       
      const resolverCalls1 = [
        {
          abi: simpleResolverAbi1,
          functionName: 'addr',
          args: [node1],
        },
        {
          abi: simpleResolverAbi1,
          functionName: 'text',
          args: [node1, 'description'],
        },
      ] as const
       
      const data = encodeFunctionData({
        abi: multicallAbi,
        functionName: 'multicall',
        args: [resolverCalls1.map((call) => encodeFunctionData(call))],
      })
 
      const universalResolverAbi = parseAbi([
        'error ResolverNotFound(bytes name)',
        'error ResolverNotContract(bytes name, address resolver)',
        'error UnsupportedResolverProfile(bytes4 selector)',
        'error ResolverError(bytes errorData)',
        'error ReverseAddressMismatch(string primary, bytes primaryAddress)',
        'error HttpError(uint16 status, string message)',
        'function resolve(bytes name, bytes data) view returns (bytes result, address resolver)',
        'function reverse(bytes lookupAddress, uint256 coinType) view returns (string primary, address resolver, address reverseResolver)',
      ])
      
      console.info('*********** zzz getAgentAccountByName chain id', await this.publicClient?.getChainId());
      

      const dnsEncodedName = toHex(packetToBytes(name))

      const resolveRes = await this.publicClient?.readContract({
        abi: universalResolverAbi,
        address: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',
        functionName: 'resolve',
        args: [dnsEncodedName, data],
      })
      
      if (!resolveRes) {
        return null;
      }

      const decodedMulticall = decodeFunctionResult({
        abi: multicallAbi,
        functionName: 'multicall',
        data: resolveRes[0] as `0x${string}`,
      }) as `0x${string}`[];
      
      console.log('*********** zzz getAgentAccountByName decodedMulticall', decodedMulticall);
      const decodedRes = (decodedMulticall || []).map((res, i) => {
        console.log('*********** zzz getAgentAccountByName res', res);
        const call = resolverCalls1[i];
        if (!call) {
          return null;
        }
        const fn = (call.functionName === 'addr' ? 'addr' : 'text') as 'addr' | 'text';
        console.log('*********** zzz getAgentAccountByName fn', fn);
        return decodeFunctionResult({
          abi: simpleResolverAbi1,
          functionName: fn,
          data: res,
        });
      }).filter(Boolean)
















      const simpleResolverAbi = parseAbi([
        'function addr(bytes32 node) view returns (address)',
        'function text(bytes32 node, string key) view returns (string)',
      ])
       
      console.log('*********** zzz getAgentAccountByName ensName', ensName);
      const name = normalize(ensName);
      console.log('*********** zzz getAgentAccountByName normalized name', name);
      const node = namehash(name);

      // DNS wire-format encode of the ENS name for Universal Resolver (use normalized form)
      const dnsEncodedName = toHex(packetToBytes(name));

      // Resolve addr(name) via Universal Resolver
      const addrCallData = encodeFunctionData({
        abi: simpleResolverAbi,
        functionName: 'addr',
        args: [node],
      });
      const addrResolve = await this.publicClient?.readContract({
        address: resolverAddr,
        abi: universalResolverAbi,
        functionName: 'resolve',
        args: [dnsEncodedName, addrCallData],
      }).catch(() => null) as readonly [`0x${string}`, `0x${string}`] | null;

      console.log('*********** zzz getAgentAccountByName addrResolve', addrResolve);
      let addrFromResolver: string | null = null;
      if (addrResolve) {
        console.log('*********** zzz getAgentAccountByName addrResolve[0]', addrResolve[0]);
        try {
          const decoded = decodeFunctionResult({
            abi: simpleResolverAbi,
            functionName: 'addr',
            data: addrResolve[0],
          }) as string;
          console.log('*********** zzz getAgentAccountByName decoded', decoded);
          addrFromResolver = decoded ?? null;
        } catch (e) {
          console.warn("UniversalResolver decode addr failed", e);
        }
      }

      // Best-effort: resolve text(name,'description') for metadata (non-blocking)
      const textCallData = encodeFunctionData({
        abi: simpleResolverAbi,
        functionName: 'text',
        args: [node, 'description'],
      });
      const textResolve = await this.publicClient?.readContract({
        address: resolverAddr,
        abi: universalResolverAbi,
        functionName: 'resolve',
        args: [dnsEncodedName, textCallData],
      }).catch(() => null);

      if (textResolve) {
        try {
          const textDecoded = decodeFunctionResult({
            abi: simpleResolverAbi,
            functionName: 'text',
            data: textResolve[0] as `0x${string}`,
          }) as string;
          console.log('*********** zzz getAgentAccountByName description text', textDecoded);
        } catch (e) {
          console.warn('UniversalResolver decode text(description) failed', e);
        }
      }

      const addr = addrFromResolver;
      if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr) && addr !== '0x0000000000000000000000000000000000000000') {
        return addr as `0x${string}`;
      }
     
    } catch (error) {
      console.error("Error getting agent account by name: ", error);
    }

    return null;
    */
  }

  /**
   * Get the Agent URL via ENS text record for a given ENS name.
   */
  async getAgentUrlByName(name: string): Promise<string | null> {
    const ensName = name.trim().toLowerCase();
    if (!ensName) return null;

    const ENS_REGISTRY_ABI = [
      { name: 'resolver', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
    ] as any[];
    const RESOLVER_ABI = [
      { name: 'text', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }], outputs: [{ name: '', type: 'string' }] },
    ] as any[];

    const node = namehash(ensName);

    // resolver
    let resolverAddr: `0x${string}` | null = null;
    try {
      resolverAddr = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{
            name: 'resolver',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'address' }]
        }] as any,
        functionName: 'resolver',
        args: [node],
      });
      // returns 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5
    } catch {}
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    try {
      const url = await this.accountProvider.call<string>({
        to: resolverAddr,
        abi: PublicResolverABI.abi as any,
        functionName: 'text',
        args: [node, 'url'],
      }).catch(() => null);

      const trimmed = (url || '').trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * Get the Agent Avatar/Image via ENS text record for a given ENS name.
   */
  async getAgentImageByName(name: string): Promise<string | null> {
    const ensName = name.trim().toLowerCase();
    if (!ensName) return null;

    const node = namehash(ensName);

    // resolver
    let resolverAddr: `0x${string}` | null = null;
    try {
      resolverAddr = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{
            name: 'resolver',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'address' }]
        }] as any,
        functionName: 'resolver',
        args: [node],
      });
    } catch {}
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    try {
      const image = await this.accountProvider.call<string>({
        to: resolverAddr,
        abi: PublicResolverABI.abi as any,
        functionName: 'text',
        args: [node, 'avatar'],
      }).catch(() => null);

      const trimmed = (image || '').trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * Get the Agent Description via ENS text record for a given ENS name.
   */
  async getAgentDescriptionByName(name: string): Promise<string | null> {
    const ensName = name.trim().toLowerCase();
    if (!ensName) return null;

    const node = namehash(ensName);

    // resolver
    let resolverAddr: `0x${string}` | null = null;
    try {
      resolverAddr = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{
            name: 'resolver',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'address' }]
        }] as any,
        functionName: 'resolver',
        args: [node],
      });
    } catch {}
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    try {
      const description = await this.accountProvider.call<string>({
        to: resolverAddr,
        abi: PublicResolverABI.abi as any,
        functionName: 'text',
        args: [node, 'description'],
      }).catch(() => null);

      const trimmed = (description || '').trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * Reverse lookup: account address -> ENS name via resolver.name(reverseNode)
   */
  async getAgentNameByAccount(account: `0x${string}`): Promise<string | null> {
    const ensRegistry = this.ensRegistryAddress;
    const accountLower = account.toLowerCase();

    const ENS_REGISTRY_ABI = [
      { name: 'resolver', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
    ] as any[];
    const RESOLVER_ABI = [
      { name: 'name', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'string' }] },
    ] as any[];



    const reverseNode = namehash(`${accountLower.slice(2)}.addr.reverse`);

    // resolver for reverse node
    let resolverAddr: `0x${string}` | null = null;
    try {
      // @ts-ignore - viem version compatibility issue
      resolverAddr = await this.publicClient?.readContract({
        address: this.ensRegistryAddress as `0x${string}`,
        abi: [{
            name: 'resolver',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'node', type: 'bytes32' }],
            outputs: [{ name: '', type: 'address' }]
        }],
        functionName: 'resolver',
        args: [reverseNode]
      }) as `0x${string}` | null;

    } catch {}
    if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    try {
      const ensName = await this.accountProvider.call<string>({
        to: resolverAddr,
        abi: PublicResolverABI.abi as any,
        functionName: 'name',
        args: [reverseNode],
      }).catch(() => null);

      const normalized = (ensName || '').trim().toLowerCase();
      return normalized.length > 0 ? normalized : null;
    } catch {
      return null;
    }
  }


  
  async prepareSetAgentNameInfoCalls(params: {
    orgName: string;            // e.g., 'airbnb.eth'
    agentName: string;                   // e.g., 'my-agent'
    agentAddress: `0x${string}`;     // AA address for the agent name
    agentUrl?: string | null                   // optional TTL (defaults to 0)
    agentDescription?: string | null                   // optional description
  }): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[]   }> {

    const RESOLVER_ABI = [
      { name: 'setAddr', type: 'function', stateMutability: 'nonpayable', inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'addr', type: 'address' }
      ], outputs: [] },
      { name: 'setText', type: 'function', stateMutability: 'nonpayable', inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'key', type: 'string' },
        { name: 'value', type: 'string' }
      ], outputs: [] },
    ] as any[];

    const clean = (s: string) => (s || '').trim().toLowerCase();
    const parent = clean(params.orgName);
    const label = clean(params.agentName).replace(/\s+/g, '-');
    const childDomain = `${label}.${parent}`;
    
    const ensFullName = childDomain + ".eth";
    const childNode = namehash(ensFullName);


    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
    if (this.publicClient) {


      const resolver = await this.accountProvider.call<`0x${string}`>({
        to: this.ensRegistryAddress,
        abi: [{ name: "resolver", stateMutability: "view", type: "function",
                inputs: [{ name: "node", type: "bytes32"}], outputs: [{ type: "address"}]}] as any,
        functionName: "resolver",
        args: [childNode],
      });

      // 1) Set addr record
      const setAddrData = encodeFunctionData({
        abi: [{ name: "setAddr", type: "function", stateMutability: "nonpayable",
                inputs: [{ name: "node", type: "bytes32" }, { name: "a", type: "address" }]}],
        functionName: "setAddr",
        args: [childNode, params.agentAddress],
      });
        

      calls.push({ to: resolver as `0x${string}`, data: setAddrData });
    
      // 2) Optionally set URL text
      if (params.agentUrl && params.agentUrl.trim() !== '') {
        const dataSetUrl = this.encodeCall(
          RESOLVER_ABI,
          'setText(bytes32,string,string)',
          [childNode, 'url', params.agentUrl.trim()]
        ) as `0x${string}`;
        calls.push({ to: resolver as `0x${string}`, data: dataSetUrl });
      }

      // 2b) Optionally set description text
      if (params.agentDescription && params.agentDescription.trim() !== '') {
        const dataSetDescription = this.encodeCall(
          RESOLVER_ABI,
          'setText(bytes32,string,string)',
          [childNode, 'description', params.agentDescription.trim()]
        ) as `0x${string}`;
        calls.push({ to: resolver as `0x${string}`, data: dataSetDescription });
      }

      // 3) Set reverse record
      //const reverseNode = namehash(params.agentAddress.slice(2).toLowerCase() + '.addr.reverse');

      const BASE_REVERSE_NODE = namehash("addr.reverse");
      const ENS_REGISTRY_ADDRESS = this.ensRegistryAddress
      const reverseRegistrar = await this.accountProvider.call<`0x${string}`>({
        to: ENS_REGISTRY_ADDRESS,
        abi: [{
          name: "owner",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "node", type: "bytes32" }],
          outputs: [{ name: "", type: "address" }],
        }] as any,
        functionName: "owner",
        args: [BASE_REVERSE_NODE],
      });

      /*
      const ourReverseRegistrar = await this.accountProvider.call<`0x${string}`>({
        to: ENS_REGISTRY_ADDRESS,
        abi: [{
          name: "owner",
          type: "function",
          stateMutability: "view",  
          inputs: [{ name: "node", type: "bytes32" }],
          outputs: [{ name: "", type: "address" }],
        }] as any,
        functionName: "owner",
        args: [reverseNode],
      });
      */


      const setNameData = encodeFunctionData({
        abi: [{
          name: "setName",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [{ name: "name", type: "string" }],
          outputs: [{ name: "node", type: "bytes32" }],
        }],
        functionName: "setName",
        args: [ensFullName], // e.g. "finder-airbnb-com.orgtrust.eth"
      });

      const call = {
        to: reverseRegistrar as `0x${string}`,
        data: setNameData,
        value: 0n
      }
      calls.push(call);


    }

 

    return { calls };
  }



  // ENS wrapper
  async prepareAddAgentNameToOrgCalls(params: {
    agentAddress: `0x${string}`;     // AA address for the agent name
    orgName: string;            // e.g., 'airbnb.eth'
    agentName: string;                   // e.g., 'my-agent'   
    agentUrl: string                   // optional TTL (defaults to 0)
  }): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {


    const clean = (s: string) => (s || '').trim().toLowerCase();
    
    let parent = clean(params.orgName);
    parent = parent.endsWith('.eth') ? parent.slice(0, -4) : parent;
    const parentNode = namehash(parent + ".eth");
    console.log('!!!!!!!!!!!! prepareAddAgentNameToOrgCalls: parent', parent + ".eth");

    const label = clean(params.agentName).replace(/\s+/g, '-');
    console.log('!!!!!!!!!!!! prepareAddAgentNameToOrgCalls: agentName', params.agentName);
    console.log('!!!!!!!!!!!! prepareAddAgentNameToOrgCalls: label', label);

    

    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];


    // Use stored resolver address from client instance
    //const resolverAddress = this.getEnsResolverAddress();
    //if (!resolverAddress || resolverAddress === '0x' || resolverAddress.length !== 42) {
    //  throw new Error(`Invalid ENS resolver address: ${resolverAddress}. Ensure ENS resolver is properly configured.`);
    //}

    // Get identity wrapper address from environment (chain-scoped if available)
    const identityWrapperAddress = this.getChainScopedAddress(
      'AGENTIC_TRUST_ENS_IDENTITY_WRAPPER',
      this.chain.id,
    );
    if (!identityWrapperAddress) {
      throw new Error(
        `Invalid ENS identity wrapper address. Set AGENTIC_TRUST_ENS_IDENTITY_WRAPPER_{CHAIN_SUFFIX} or AGENTIC_TRUST_ENS_IDENTITY_WRAPPER environment variable.`,
      );
    }

    console.log('!!!!!!!!!!!! prepareAddAgentNameToOrgCalls: label, address', label, params.agentAddress);

    const subdomainData = encodeFunctionData({
      abi: NameWrapperABI.abi,
      functionName: 'setSubnodeRecord',
      args: [
        parentNode,
        label,
        params.agentAddress,
        this.getChainScopedAddress(
          'AGENTIC_TRUST_ENS_PUBLIC_RESOLVER',
          this.chain.id,
        ) as `0x${string}`,
        0,
        0,
        0
      ]
    });
    const call = {
      to: identityWrapperAddress,
      data: subdomainData,
      value: 0n
    }
    calls.push(call);

    return { calls };
  }

  private isZeroAddress(addr: string): boolean {
    return /^0x0{40}$/i.test(addr);
  }

  async getAddressFromENSName(ensName: string): Promise<`0x${string}` | null> {

    const clean = (s: string) => (s || '').trim().toLowerCase();
    let parent = clean(ensName);
    parent = parent.endsWith('.eth') ? parent.slice(0, -4) : parent;
    const fullname = `${parent}.eth`;
    const nameNode = namehash(fullname);

    console.info("ensRegistryAddress: ", this.ensRegistryAddress);
    console.info("fullname: ", fullname);

    try {

      const existingOwner = await this.publicClient?.readContract({
        address: this.ensRegistryAddress as `0x${string}`,
        abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }] }] as any,
        functionName: 'owner',
        args: [nameNode]
      }) as `0x${string}` | null;
      
      const hasOwner = Boolean(existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000');
      console.info(`hasAgentNameOwner: "${nameNode}" ${hasOwner ? 'HAS owner' : 'has NO owner'}${hasOwner ? `: ${existingOwner}` : ''}`);
      return existingOwner;
    } catch (error) {
      console.error('Error checking agent name owner:', error);
      return null;
    }

  }

  /**
   * Resolve a chain-scoped env var, falling back to the base name.
   * For example, with baseName 'AGENTIC_TRUST_ENS_PUBLIC_RESOLVER' and
   * chain.id=11155111, this checks:
   *  - AGENTIC_TRUST_ENS_PUBLIC_RESOLVER_SEPOLIA
   *  - AGENTIC_TRUST_ENS_PUBLIC_RESOLVER
   */
  private getChainScopedAddress(
    baseName: string,
    chainId: number,
  ): `0x${string}` | undefined {
    const suffix =
      chainId === 11155111
        ? 'SEPOLIA'
        : chainId === 84532
        ? 'BASE_SEPOLIA'
        : chainId === 11155420
        ? 'OPTIMISM_SEPOLIA'
        : undefined;

    const chainKey = suffix ? `${baseName}_${suffix}` : baseName;
    const chainValue = process.env[chainKey];
    const fallbackValue = process.env[baseName];
    const raw = chainValue ?? fallbackValue;

    if (!raw) return undefined;
    const trimmed = raw.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return undefined;
    return trimmed as `0x${string}`;
  }


  /** Decode ERC-7930-like agent identity hex string */
  private decodeAgentIdentity(value?: string | null): { chainId: number; registry: `0x${string}`; agentId: bigint } | null {
    try {
      if (!value || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
      const hex = value.slice(2);
      // [v1=01][ns=eip155=01][chainId(4)][address(20)][len(1)][id(var)]
      if (hex.length < 2 + 2 + 8 + 40 + 2) return null;
      const chainIdHex = hex.slice(4, 12);
      const chainId = parseInt(chainIdHex, 16);
      const addrHex = hex.slice(12, 52);
      const idLen = parseInt(hex.slice(52, 54), 16);
      const idHex = hex.slice(54, 54 + idLen * 2);
      const registry = (`0x${addrHex}`) as `0x${string}`;
      const agentId = BigInt(`0x${idHex || '0'}`);
      return { chainId, registry, agentId };
    } catch {
      return null;
    }
  }
}

