
import { createPublicClient, http, custom, encodeFunctionData, keccak256, stringToHex, zeroAddress, createWalletClient, namehash, hexToString, type Address } from 'viem';

import { AIAgentENSClient } from './AIAgentENSClient';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';

export class AIAgentL2ENSDurenClient extends AIAgentENSClient {

  constructor(
    chain: any,
    rpcUrl: string,
    adapter: any,
    ensRegistryAddress: `0x${string}`,
    ensResolverAddress: `0x${string}`,
    identityRegistryAddress: `0x${string}`,
  ) {
    super(chain, rpcUrl, adapter, ensRegistryAddress, ensResolverAddress, identityRegistryAddress);
  }

  /** Chain ID for Linea Sepolia (registry uses createSubnode(baseNode, label, owner, [])). */
  private static readonly CHAIN_ID_LINEA_SEPOLIA = 59141;

  /**
   * L2Registrar address per chain. Base Sepolia uses a separate L2Registrar contract;
   * Linea Sepolia uses the registry's createSubnode(bytes32,string,address,bytes[]) (no separate registrar).
   */
  private getL2RegistrarAddress(): `0x${string}` | null {
    const chainId = (this as any).chain?.id;
    if (chainId === 84532) return '0x68CAd072571E8bea1DA9e5C071367Aa6ddC8F37F' as `0x${string}`;
    return null;
  }

  /** True when this chain uses registry.createSubnode for subdomain registration (e.g. Linea Sepolia). */
  private usesRegistryCreateSubnode(): boolean {
    return (this as any).chain?.id === AIAgentL2ENSDurenClient.CHAIN_ID_LINEA_SEPOLIA;
  }

  private getEffectiveRpcUrl(): string | undefined {
    const rpc = (this as any).rpcUrl;
    if (typeof rpc === 'string' && rpc.trim()) return rpc.trim();
    const chain = (this as any).chain;
    const first = chain?.rpcUrls?.default?.http?.[0];
    return typeof first === 'string' ? first : undefined;
  }

  private hasValidResolver(): boolean {
    const addr = this.getEnsResolverAddress();
    return typeof addr === 'string' && addr.length > 0 && addr !== zeroAddress;
  }

  /** On Linea Sepolia the registry does not implement setAddr/setText; resolver must be a different contract. */
  private hasValidResolverForSetInfo(): boolean {
    if (!this.hasValidResolver()) return false;
    if (this.usesRegistryCreateSubnode()) {
      const r = this.getEnsResolverAddress().toLowerCase();
      const reg = this.getEnsRegistryAddress().toLowerCase();
      if (r === reg) return false;
    }
    return true;
  }


  /**
   * Override to ensure L2 client always returns true for isL2()
   */
  isL2(): boolean {
    return true; // This is always an L2 client
  }

  /**
   * Override to ensure L2 client always returns false for isL1()
   */
  isL1(): boolean {
    return false; // This is never an L1 client
  }

  /**
   * Override to ensure L2 client always returns 'L2'
   */
  getChainType(): 'L1' | 'L2' {
    return 'L2';
  }


  async getAgentUrlByName(name: string): Promise<string | null> {
    try {
      if (!this.hasValidResolver()) return null;
      const rpcUrl = this.getEffectiveRpcUrl();
      if (!rpcUrl) return null;

      const node = namehash(name);
      const resolverAddress = this.getEnsResolverAddress();
      
      const resolverAbi = [
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "node",
              "type": "bytes32"
            },
            {
              "internalType": "string",
              "name": "key",
              "type": "string"
            }
          ],
          "name": "text",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ] as const;

      const publicClient = createPublicClient({
        chain: (this as any).chain,
        transport: http(rpcUrl),
      });

      const url = await publicClient.readContract({
        address: resolverAddress,
        abi: resolverAbi,
        functionName: 'text',
        args: [node, 'url'],
      });
      
      // Return null if URL is empty
      if (!url || url.trim() === '') {
        return null;
      }

      return url as string;

    } catch (error) {
      console.error('Error resolving URL for name:', name, error);
      return null;
    }
  }


  async getAgentAccountByName(name: string): Promise<`0x${string}` | null> {
    try {
      const node = namehash(name);
      const rpcUrl = this.getEffectiveRpcUrl();
      if (!rpcUrl) return null;

      const publicClient = createPublicClient({
        chain: (this as any).chain,
        transport: http(rpcUrl),
      });

      const ensRegistryAddress = this.getEnsRegistryAddress();
      const ensRegistryAbi = [
        { inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
      ] as const;

      const owner = await publicClient.readContract({
        address: ensRegistryAddress,
        abi: ensRegistryAbi,
        functionName: 'owner',
        args: [node],
      });
      if (!owner || owner === zeroAddress) return null;

      if (!this.hasValidResolver()) return null;
      const resolverAddress = this.getEnsResolverAddress();

      // ENS Resolver ABI for addr function
      const resolverAbi = [
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "node",
              "type": "bytes32"
            }
          ],
          "name": "addr",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ] as const;

      /*
      // TEST: Check resolver status
      console.info("********************* TEST: Checking resolver for name:", name);
      
      // Check if resolver is set for this node
      const registryResolverAbi = [
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "node",
              "type": "bytes32"
            }
          ],
          "name": "resolver",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ] as const;

      try {
        const resolver = await // @ts-ignore - viem version compatibility issue
    publicClient.readContract({
          address: ensRegistryAddress,
          abi: registryResolverAbi,
          functionName: 'resolver',
          args: [node]
        });

        console.info("********************* TEST: Resolver for", name, ":", resolver);
        
        if (resolver && resolver !== '0x0000000000000000000000000000000000000000') {
          console.info("********************* TEST: RESOLVER EXISTS - Name has resolver:", resolver);
        } else {
          console.info("********************* TEST: NO RESOLVER - Name has no resolver set");
        }
      } catch (resolverError) {
        console.error("********************* TEST: Error checking resolver:", resolverError);
      }
      */

      // Call the resolver directly to get address
      const addressResolverAbi = [
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "node",
              "type": "bytes32"
            }
          ],
          "name": "addr",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ] as const;

      const address = await publicClient.readContract({
        address: resolverAddress,
        abi: addressResolverAbi,
        functionName: 'addr',
        args: [node],
      });
      
      // Return null if address is zero address
      if (!address || address === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return address as `0x${string}`;

    } catch (error) {
      console.error('Error resolving address for name:', name, error);
      return null;
    }
  }


  /**
   * Note: getAgentEoaByAgentAccount is not a method of AIAgentENSClient
   * This method is actually in AIAgentIdentityClient, so we don't need to override it here.
   * The ownership detection logic is handled in the UI layer (AddAgentModal.tsx)
   */

  /**
   * Override hasAgentNameOwner to use L2Registrar available() function
   */
  async hasAgentNameOwner(orgName: string, agentName: string): Promise<boolean> {
    console.info("AIAgentL2ENSDurenClient.hasAgentNameOwner");
    
    const clean = (s: string) => (s || '').trim().toLowerCase();
    const parent = clean(orgName);
    const label = clean(agentName).replace(/\s+/g, '-');
    console.info("AIAgentL2ENSDurenClient.hasAgentNameOwner: label", label);
    console.info("AIAgentL2ENSDurenClient.hasAgentNameOwner: parent", parent);
    const fullSubname = `${label}.${parent}`;
    console.info("AIAgentL2ENSDurenClient.hasAgentNameOwner: fullSubname", fullSubname);

    const l2RegistrarAddress = this.getL2RegistrarAddress();
    if (!l2RegistrarAddress) {
      // No L2Registrar on this chain (e.g. Linea Sepolia); fall back to ENS registry owner(node)
      try {
        const rpcUrl = this.getEffectiveRpcUrl();
        if (!rpcUrl) return false;
        const node = namehash(fullSubname);
        const publicClient = createPublicClient({
          chain: (this as any).chain,
          transport: http(rpcUrl),
        });
        const owner = await publicClient.readContract({
          address: this.getEnsRegistryAddress(),
          abi: [{ inputs: [{ name: 'node', type: 'bytes32' }], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }] as const,
          functionName: 'owner',
          args: [node],
        });
        const hasOwner = owner && owner !== zeroAddress;
        console.info(`AIAgentL2ENSDurenClient.hasAgentNameOwner: "${fullSubname}" (registry) ${hasOwner ? 'HAS owner' : 'has NO owner'}`);
        return hasOwner;
      } catch (err) {
        console.error('Error checking agent name owner via registry:', err);
        return false;
      }
    }

    const l2RegistrarAbi = [
      {
        "inputs": [
          {
            "internalType": "string",
            "name": "label",
            "type": "string"
          }
        ],
        "name": "available",
        "outputs": [
          {
            "internalType": "bool",
            "name": "available",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ] as const;

    const publicClient = // @ts-ignore - viem version compatibility issue
    createPublicClient({
      chain: (this as any).chain,
      transport: http((this as any).rpcUrl)
    });

    try {
      // Call registrar.available(label) - returns true if available, false if taken
      const isAvailable = await // @ts-ignore - viem version compatibility issue
    publicClient.readContract({
        address: l2RegistrarAddress,
        abi: l2RegistrarAbi,
        functionName: 'available',
        args: [label]
      });

      // If not available, then it has an owner
      const hasOwner = !isAvailable;
      console.info(`AIAgentL2ENSDurenClient.hasAgentNameOwner: "${fullSubname}" (label: "${label}") ${hasOwner ? 'HAS owner' : 'has NO owner'} (available: ${isAvailable})`);
      return hasOwner;
    } catch (error) {
      console.error('Error checking agent name owner via registrar:', error);
      return false;
    }
  }


  async prepareAddAgentNameToOrgCalls(params: {
    agentAddress: `0x${string}`; // AA address for the agent name
    orgName: string;            // e.g., 'airbnb.eth'
    agentName: string;          // e.g., 'my-agent'
    agentUrl: string    //  URL
  }): Promise<{ calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }> {

    console.log("AIAgentL2ENSDurenClient.prepareAddAgentNameToOrgCalls");
    console.log("orgName: ", params.orgName);
    console.log("agentName: ", params.agentName);
    console.log("agentAddress: ", params.agentAddress);
    console.log("agentUrl: ", params.agentUrl);
    
    const clean = (s: string) => (s || '').trim().toLowerCase();
    const parent = clean(params.orgName) + ".eth";
    const label = clean(params.agentName).replace(/\s+/g, '-');
    const fullSubname = `${label}.${parent}`;
    const agentAddress = params.agentAddress;
    const agentUrl = params.agentUrl;

    const chainName = (this as any).chain.name.toLowerCase().replace(/\s+/g, '-');

    console.info("parent: ", parent);
    console.info("label: ", label);
    console.info("fullSubname: ", fullSubname);
    console.info("agentAddress: ", agentAddress);
    console.info("chainName: ", chainName);
    console.info("agentUrl: ", agentUrl);

    const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];

    try {
      // Step 1: Register the subdomain with L2Registrar
      const registrationCall = await this.registerSubdomain(
        label,
        agentAddress
      );
      
      // Add registration call
      calls.push(...registrationCall.calls);

      /*

      // Step 2: Set address records for the subdomain
      const chainId = (this as any).chain.id;

      // Set Base Sepolia address record (coinType 2147568164)
      if (chainId === 84532) { // Base Sepolia
        const baseAddrCall = await this.setResolverAddrRecordDirect(
          fullSubname,
          2147568164, // Base Sepolia coin type
          agentAddress
        );
        calls.push(baseAddrCall);
      }

      
      // Set Ethereum address record (coinType 60) for cross-chain compatibility
      const ethAddrCall = await this.setResolverAddrRecordDirect(
        fullSubname,
        60, // Ethereum coin type
        agentAddress
      );
      calls.push(ethAddrCall);


      // Step 3: Set resolver records for the subdomain
      const textRecords = [
        { key: 'name', value: label },
        { key: 'url', value: agentUrl },
        { key: 'description', value: `Agent: ${label}` },
        { key: 'chain', value: chainName },
        { key: 'agent-account', value: agentAddress },
      ];

      for (const record of textRecords) {
        const recordCall = await this.setResolverTextRecordDirect(
          fullSubname,
          record.key,
          record.value,
        );
        calls.push(recordCall);
      }




      console.info("Generated calls count: ", calls.length);
      console.info("Calls: ", calls);

      */

    } catch (error) {
      console.error("Error preparing agent name calls:", error);
      throw error;
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

    console.log("AIAgentL2ENSDurenClient.prepareAddAgentNameToOrgCalls");
    console.log("orgName: ", params.orgName);
    console.log("agentName: ", params.agentName);
    console.log("agentAddress: ", params.agentAddress);
    console.log("agentUrl: ", params.agentUrl);
    
    const clean = (s: string) => (s || '').trim().toLowerCase();
    const parent = clean(params.orgName) + ".eth";
    const label = clean(params.agentName).replace(/\s+/g, '-');
    const fullSubname = `${label}.${parent}`;
    const agentAddress = params.agentAddress;
    const agentUrl = params.agentUrl;

    const chainName = (this as any).chain.name.toLowerCase().replace(/\s+/g, '-');

    console.info("parent: ", parent);
    console.info("label: ", label);
    console.info("fullSubname: ", fullSubname);
    console.info("agentAddress: ", agentAddress);
    console.info("chainName: ", chainName);
    console.info("agentUrl: ", agentUrl);

    const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];

    try {


      // Step 2: Set address records for the subdomain
      const chainId = (this as any).chain.id;

      // Set Base Sepolia address record (coinType 2147568164)
      if (chainId === 84532) { // Base Sepolia
        const baseAddrCall = await this.setResolverAddrRecordDirect(
          fullSubname,
          2147568164, // Base Sepolia coin type
          agentAddress
        );
        calls.push(baseAddrCall);
      }

      /*
      // Set Ethereum address record (coinType 60) for cross-chain compatibility
      const ethAddrCall = await this.setResolverAddrRecordDirect(
        fullSubname,
        60, // Ethereum coin type
        agentAddress
      );
      calls.push(ethAddrCall);
      */


      // Step 3: Set resolver records for the subdomain
      const textRecords = [
        //{ key: 'name', value: label },
        { key: 'url', value: agentUrl },
        //{ key: 'description', value: `Agent: ${label}` },
        //{ key: 'chain', value: chainName },
        //{ key: 'agent-account', value: agentAddress },
      ];
      
      // Add description if provided
      if (params.agentDescription && params.agentDescription.trim() !== '') {
        textRecords.push({ key: 'description', value: params.agentDescription.trim() });
      }

      for (const record of textRecords) {
        const recordCall = await this.setResolverTextRecordDirect(
          fullSubname,
          record.key,
          record.value,
        );
        calls.push(recordCall);
      }




      console.info("Generated calls count: ", calls.length);
      console.info("Calls: ", calls);


    } catch (error) {
      console.error("Error preparing agent name calls:", error);
      throw error;
    }

    return { calls };
  }

  async prepareSetNameUriCalls(
    name: string,
    uri: string
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {

    const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];

    return { calls };
  }


  /**
   * Register subdomain using L2Registrar contract (Base Sepolia specific)
   */
  async registerSubdomain(
    subdomain: string,
    owner: `0x${string}`
  ): Promise<{ calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }> {
    console.log("AIAgentL2ENSDurenClient.registerSubdomain", { subdomain, owner });

    const calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] = [];

    // Linea Sepolia: registry has baseNode() and createSubnode(bytes32,string,address,bytes[])
    if (this.usesRegistryCreateSubnode()) {
      const rpcUrl = this.getEffectiveRpcUrl();
      if (!rpcUrl) return { calls };
      const registryAddress = this.getEnsRegistryAddress();
      const publicClient = createPublicClient({
        chain: (this as any).chain,
        transport: http(rpcUrl),
      });
      const baseNodeAbi = [{ inputs: [], name: 'baseNode', outputs: [{ type: 'bytes32' }], stateMutability: 'view', type: 'function' }] as const;
      const baseNode = await publicClient.readContract({
        address: registryAddress,
        abi: baseNodeAbi,
        functionName: 'baseNode',
      });
      const createSubnodeAbi = [
        {
          inputs: [
            { internalType: 'bytes32', name: 'baseNode', type: 'bytes32' },
            { internalType: 'string', name: 'label', type: 'string' },
            { internalType: 'address', name: 'owner', type: 'address' },
            { internalType: 'bytes[]', name: 'data', type: 'bytes[]' },
          ],
          name: 'createSubnode',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ] as const;
      const data = encodeFunctionData({
        abi: createSubnodeAbi,
        functionName: 'createSubnode',
        args: [baseNode, subdomain, owner, []],
      });
      calls.push({ to: registryAddress, data, value: 0n });
      return { calls };
    }

    const l2RegistrarAddress = this.getL2RegistrarAddress();
    if (!l2RegistrarAddress) {
      return { calls };
    }

    // Base Sepolia: separate L2Registrar with register(string, address)
    const l2RegistrarAbi = [
      {
        inputs: [
          { internalType: 'string', name: 'name', type: 'string' },
          { internalType: 'address', name: 'owner', type: 'address' },
        ],
        name: 'register',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ] as const;
    const registerData = encodeFunctionData({
      abi: l2RegistrarAbi,
      functionName: 'register',
      args: [subdomain, owner],
    });
    calls.push({ to: l2RegistrarAddress, data: registerData, value: 0n });
    return { calls };
  }

  /**
   * Direct chain call for setting resolver records
   */
  async setResolverTextRecordDirect(
    name: string,
    key: string,
    value: string
  ): Promise<{ to: `0x${string}`; data: `0x${string}` }> {
    
    console.log("AIAgentL2ENSDurenClient.setResolverTextRecordDirect");
    console.log("name:", name);
    console.log("key:", key);
    console.log("value:", value);

    const resolverAddress = this.getEnsResolverAddress()


    // ENS Resolver ABI for setText
    const resolverAbi = [
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "node",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "key",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "value",
            "type": "string"
          }
        ],
        "name": "setText",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ] as const;

    // Calculate namehash for the subdomain
    const node = namehash(name);

    // Encode the setText function call
    const data = encodeFunctionData({
      abi: resolverAbi,
      functionName: 'setText',
      args: [node, key, value]
    });

    return {
      to: resolverAddress,
      data
    };
  }

  /**
   * Override for Linea Sepolia (59141): registry does not implement resolver(node).
   * When no resolver is configured return empty; otherwise use configured resolver address and skip registry lookups.
   */
  override async prepareSetAgentNameInfoCalls(params: {
    orgName: string;
    agentName: string;
    agentAddress: `0x${string}`;
    agentUrl?: string | null;
    agentDescription?: string | null;
  }): Promise<{ calls: { to: `0x${string}`; data: `0x${string}` }[] }> {
    if (this.usesRegistryCreateSubnode()) {
      if (!this.hasValidResolverForSetInfo()) return { calls: [] };
      const resolver = this.getEnsResolverAddress();
      const clean = (s: string) => (s || '').trim().toLowerCase();
      const parent = clean(params.orgName);
      const label = clean(params.agentName).replace(/\s+/g, '-');
      const ensFullName = `${label}.${parent}.eth`;
      const childNode = namehash(ensFullName);
      const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
      const setAddrData = encodeFunctionData({
        abi: [{ name: 'setAddr', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'a', type: 'address' }], outputs: [] }],
        functionName: 'setAddr',
        args: [childNode, params.agentAddress],
      });
      calls.push({ to: resolver, data: setAddrData });
      if (params.agentUrl?.trim()) {
        calls.push({
          to: resolver,
          data: encodeFunctionData({
            abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }], outputs: [] }],
            functionName: 'setText',
            args: [childNode, 'url', params.agentUrl.trim()],
          }),
        });
      }
      if (params.agentDescription?.trim()) {
        calls.push({
          to: resolver,
          data: encodeFunctionData({
            abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }], outputs: [] }],
            functionName: 'setText',
            args: [childNode, 'description', params.agentDescription.trim()],
          }),
        });
      }
      return { calls };
    }
    return super.prepareSetAgentNameInfoCalls(params);
  }

  /**
   * Direct chain call for setting resolver address records
   * Equivalent to: cast send resolver "setAddr(bytes32,uint256,bytes)" $NODE coinType encodedAddress
   */
  async setResolverAddrRecordDirect(
    name: string,
    coinType: number,
    address: `0x${string}`
  ): Promise<{ to: `0x${string}`; data: `0x${string}` }> {
    
    console.log("AIAgentL2ENSDurenClient.setResolverAddrRecordDirect");
    console.log("name:", name);
    console.log("coinType:", coinType);
    console.log("address:", address);

    const resolverAddress = this.getEnsResolverAddress()

    // ENS Resolver ABI for setAddr
    const resolverAbi = [
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "node",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "coinType",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "a",
            "type": "bytes"
          }
        ],
        "name": "setAddr",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ] as const;

    // Calculate namehash for the subdomain
    const node = namehash(name);

    // Encode the address according to the coin type
    // For Base Sepolia (coinType 2147568164), we need to encode as bytes
    let encodedAddress: `0x${string}`;
    
    if (coinType === 2147568164) {
      // Base Sepolia coin type - encode as bytes
      // Equivalent to: $(cast abi-encode "f(address)" 0xYourBaseAddress)
      encodedAddress = encodeFunctionData({
        abi: [{ "inputs": [{ "internalType": "address", "name": "addr", "type": "address" }], "name": "f", "outputs": [], "stateMutability": "nonpayable", "type": "function" }],
        functionName: 'f',
        args: [address]
      }) as `0x${string}`;
    } else if (coinType === 60) {
      // Ethereum coin type - encode as 20-byte address
      encodedAddress = address.padEnd(66, '0') as `0x${string}`;
    } else {
      // Generic encoding for other coin types
      encodedAddress = address.padEnd(66, '0') as `0x${string}`;
    }

    console.log("node:", node);
    console.log("encodedAddress:", encodedAddress);

    // Encode the setAddr function call
    const data = encodeFunctionData({
      abi: resolverAbi,
      functionName: 'setAddr',
      args: [node, BigInt(coinType), encodedAddress]
    });

    return {
      to: resolverAddress,
      data
    };
  }
}
