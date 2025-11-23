/**
 * IPFS Storage Implementation
 * 
 * Consolidated IPFS client for uploading and retrieving data
 * Supports Pinata, Web3.Storage, and multiple IPFS gateways
 * Handles inline data URIs, CID extraction, and gateway fallbacks
 */

export interface IPFSConfig {
    /**
     * Pinata JWT token (preferred, defaults to PINATA_JWT env var)
     */
    pinataJwt?: string;
    
    /**
     * Pinata API key (alternative to JWT)
     */
    pinataApiKey?: string;
    
    /**
     * Pinata API secret (required if using API key)
     */
    pinataApiSecret?: string;
    
    /**
     * Web3.Storage token (optional, fallback)
     */
    web3StorageToken?: string;
    
    /**
     * Custom IPFS gateway URL (optional, for uploads)
     */
    gatewayUrl?: string;
    
    /**
     * IPFS API endpoint (optional, for direct IPFS node access)
     */
    ipfsApiUrl?: string;
  
    /**
     * Request timeout in milliseconds (default: 10000)
     */
    timeout?: number;
  }
  
  export interface UploadResult {
    /**
     * Content Identifier (CID) of the uploaded content
     */
    cid: string;
    
    /**
     * URL to access the content via IPFS gateway
     */
    url: string;
    
    /**
     * Token URI format (ipfs://CID)
     */
    tokenUri: string;
    
    /**
     * Size of the uploaded content in bytes
     */
    size?: number;
  }
  
  export interface IPFSStorage {
    /**
     * Upload data to IPFS
     * @param data - Data to upload (string, Blob, File, or File-like object)
     * @param filename - Optional filename for the upload
     * @returns Upload result with CID, URL, and tokenUri
     */
    upload(data: string | Blob | File | ArrayBuffer, filename?: string): Promise<UploadResult>;
    
    /**
     * Retrieve data from IPFS by CID or tokenUri
     * @param cidOrTokenUri - CID, tokenUri (ipfs://CID), or full gateway URL
     * @returns The retrieved data as Blob
     */
    get(cidOrTokenUri: string): Promise<Blob>;
    
    /**
     * Retrieve JSON data from IPFS by CID or tokenUri
     * Supports inline data URIs, multiple gateways, and fallbacks
     * @param tokenUri - tokenUri (ipfs://CID), full gateway URL, or data URI
     * @returns Parsed JSON data or null if not found
     */
    getJson(tokenUri: string | null): Promise<any | null>;
    
    /**
     * Get URL for accessing content via IPFS gateway
     * @param cidOrTokenUri - CID, tokenUri (ipfs://CID), or full gateway URL
     * @returns URL string
     */
    getUrl(cidOrTokenUri: string): string;
  }
  
  /**
   * Extract CID from various IPFS URI formats
   * Supports: ipfs://CID, https://gateway/ipfs/CID, https://CID.ipfs.gateway, etc.
   */
  function extractCid(tokenUri: string): string | null {
    if (!tokenUri) return null;
    
    // Remove ipfs:// prefix
    let cid = tokenUri.replace(/^ipfs:\/\//, '');
    
    // Handle gateway URLs
    // Match patterns like: https://gateway/ipfs/CID or https://CID.ipfs.gateway
    const gatewayPatterns = [
      /\/ipfs\/([a-zA-Z0-9]+)/,  // https://gateway/ipfs/CID
      /^https?:\/\/([a-zA-Z0-9]+)\.ipfs\./,  // https://CID.ipfs.gateway
      /^https?:\/\/[^/]+\/([a-zA-Z0-9]+)$/,  // https://gateway/CID (no /ipfs/)
    ];
    
    for (const pattern of gatewayPatterns) {
      const match = cid.match(pattern);
      if (match && match[1]) {
        cid = match[1];
        break;
      }
    }
    
    // Remove any remaining URL parts
    const parts = cid.split('/');
    const firstPart = parts[0] || cid;
    const cleanCid = firstPart.split('?')[0] || firstPart;
    
    // Validate CID format (basic check - should start with Qm for v0 or be longer for v1)
    if (cleanCid && /^[a-zA-Z0-9]{46,}$/.test(cleanCid)) {
      return cleanCid;
    }
    
    return null;
  }
  
  /**
   * Create a timeout signal for fetch requests
   */
  function createTimeoutSignal(timeoutMs: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    return controller.signal;
  }
  
  /**
   * Create IPFS storage instance
   */
  export function createIPFSStorage(config: IPFSConfig): IPFSStorage {
    const pinataJwt = config.pinataJwt || process.env.PINATA_JWT;
    const pinataApiKey = config.pinataApiKey || process.env.PINATA_API_KEY;
    const pinataApiSecret = config.pinataApiSecret || process.env.PINATA_API_SECRET;
    const web3StorageToken = config.web3StorageToken || process.env.WEB3_STORAGE_TOKEN || process.env.WEB3_STORAGE_API_KEY;
    const timeout = config.timeout || 10000;
    
    // Default to Pinata gateway for uploads
    const gatewayUrl = config.gatewayUrl || 'https://gateway.pinata.cloud/ipfs/';
    
    // Helper function to get URL from CID
    const getUrlFromCid = (cid: string): string => {
      // Remove 'ipfs://' prefix if present
      const cleanCid = cid.replace(/^ipfs:\/\//, '');
      return `${gatewayUrl}${cleanCid}`;
    };
    
    return {
      async upload(data: string | Blob | File | ArrayBuffer, filename?: string): Promise<UploadResult> {
        // Prefer Pinata if available
        if (pinataJwt || (pinataApiKey && pinataApiSecret)) {
          try {
            let file: File;
            
            if (typeof data === 'string') {
              file = new File([data], filename || 'data.txt', { type: 'text/plain' });
            } else if (data instanceof Blob) {
              file = new File([data], filename || 'file', { type: data.type || 'application/octet-stream' });
            } else if (data instanceof File) {
              file = data;
            } else {
              file = new File([data], filename || 'file', { type: 'application/octet-stream' });
            }
            
            const formData = new FormData();
            formData.append('file', file);
            
            // Pinata metadata
            const metadata = JSON.stringify({
              name: filename || file.name,
            });
            formData.append('pinataMetadata', metadata);
            
            // Pinata options
            const pinataOptions = JSON.stringify({
              cidVersion: 0,
            });
            formData.append('pinataOptions', pinataOptions);
            
            // Use JWT or API key/secret
            const headers: Record<string, string> = {};
            if (pinataJwt) {
              headers['Authorization'] = `Bearer ${pinataJwt}`;
            } else if (pinataApiKey && pinataApiSecret) {
              headers['pinata_api_key'] = pinataApiKey;
              headers['pinata_secret_api_key'] = pinataApiSecret;
            }
            
            const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
              method: 'POST',
              headers,
              body: formData,
            });
            
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: response.statusText }));
              throw new Error(`Pinata upload failed: ${errorData.error || response.statusText}`);
            }
            
            const result = await response.json();
            const cid = result.IpfsHash || result.cid;
            
            return {
              cid,
              url: getUrlFromCid(cid),
              tokenUri: `ipfs://${cid}`,
              size: file.size,
            };
          } catch (error) {
            throw new Error(`Failed to upload to Pinata: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        // Fallback to Web3.Storage if available
        if (web3StorageToken) {
          try {
            // Dynamic import to avoid bundling if not used
            // @ts-ignore - web3.storage is optional and may not be installed
            const web3StorageModule = await import('web3.storage');
            const Web3Storage = web3StorageModule.Web3Storage;
            const web3Storage = new Web3Storage({ token: web3StorageToken });
            
            let file: File;
            
            if (typeof data === 'string') {
              file = new File([data], filename || 'data.txt', { type: 'text/plain' });
            } else if (data instanceof Blob) {
              file = new File([data], filename || 'file', { type: data.type || 'application/octet-stream' });
            } else if (data instanceof File) {
              file = data;
            } else {
              file = new File([data], filename || 'file', { type: 'application/octet-stream' });
            }
            
            const cid = await web3Storage.put([file], {
              wrapWithDirectory: false,
            });
            
            return {
              cid,
              url: getUrlFromCid(cid),
              tokenUri: `ipfs://${cid}`,
              size: file.size,
            };
          } catch (error) {
            throw new Error(`Failed to upload to Web3.Storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        // Fallback: Use IPFS API if available
        if (config.ipfsApiUrl) {
          try {
            let file: File;
            
            if (typeof data === 'string') {
              file = new File([data], filename || 'data.txt', { type: 'text/plain' });
            } else if (data instanceof Blob) {
              file = new File([data], filename || 'file', { type: data.type || 'application/octet-stream' });
            } else if (data instanceof File) {
              file = data;
            } else {
              file = new File([data], filename || 'file', { type: 'application/octet-stream' });
            }
            
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch(`${config.ipfsApiUrl}/api/v0/add`, {
              method: 'POST',
              body: formData,
            });
            
            if (!response.ok) {
              throw new Error(`IPFS API error: ${response.statusText}`);
            }
            
            const result = await response.json();
            const cid = result.Hash || result.cid;
            
            return {
              cid,
              url: getUrlFromCid(cid),
              tokenUri: `ipfs://${cid}`,
              size: file.size,
            };
          } catch (error) {
            throw new Error(`Failed to upload to IPFS API: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        throw new Error('No IPFS storage method configured. Provide PINATA_JWT or PINATA_API_KEY/PINATA_API_SECRET.');
      },
      
      async get(cidOrTokenUri: string): Promise<Blob> {
        const cid = extractCid(cidOrTokenUri);
        if (!cid) {
          throw new Error(`Invalid CID or tokenUri: ${cidOrTokenUri}`);
        }
  
        // Try multiple gateways with fallback
        const gateways = [
          `https://gateway.pinata.cloud/ipfs/${cid}`,
          `https://${cid}.ipfs.mypinata.cloud`,
          `https://${cid}.ipfs.w3s.link`,
          `https://w3s.link/ipfs/${cid}`,
          `https://ipfs.io/ipfs/${cid}`,
          `https://cloudflare-ipfs.com/ipfs/${cid}`,
          `https://dweb.link/ipfs/${cid}`,
          `https://gateway.ipfs.io/ipfs/${cid}`,
        ];
  
        for (const url of gateways) {
          try {
            const timeoutSignal = createTimeoutSignal(timeout);
            const response = await fetch(url, { signal: timeoutSignal });
            
            if (response.ok) {
              return response.blob();
            }
          } catch (error: any) {
            const errorMsg = error?.message || String(error);
            // Don't log timeout errors for every gateway (too noisy)
            if (!errorMsg.includes('aborted') && !errorMsg.includes('timeout')) {
              console.warn(`IPFS gateway ${url} failed: ${errorMsg}`);
            }
            // Continue to next gateway
            continue;
          }
        }
        
        throw new Error(`Failed to fetch from IPFS: All gateways failed for CID ${cid}`);
      },
      
      async getJson(tokenUri: string | null): Promise<any | null> {
        if (!tokenUri) return null;
  
        const fetchFn = (globalThis as any).fetch as undefined | ((input: any, init?: any) => Promise<any>);
        if (!fetchFn) return null;
  
        try {
          // Handle inline data URIs (data:application/json,...)
          if (tokenUri.startsWith('data:application/json')) {
            try {
              const commaIndex = tokenUri.indexOf(',');
              if (commaIndex === -1) {
                console.warn('Invalid data URI format');
                return null;
              }
              
              const jsonData = tokenUri.substring(commaIndex + 1);
              let parsed;
              
              // Check if it's marked as base64 encoded
              if (tokenUri.startsWith('data:application/json;base64,')) {
                try {
                  // Try base64 decode first
                  let jsonString: string;
                  if (typeof atob !== 'undefined') {
                    jsonString = atob(jsonData);
                  } else {
                    // Node.js environment
                    const buffer = Buffer.from(jsonData, 'base64');
                    jsonString = buffer.toString('utf-8');
                  }
                  parsed = JSON.parse(jsonString);
                } catch (e) {
                  // If base64 fails, try parsing as plain JSON
                  try {
                    parsed = JSON.parse(jsonData);
                  } catch (e2) {
                    const decodedJson = decodeURIComponent(jsonData);
                    parsed = JSON.parse(decodedJson);
                  }
                }
              } else {
                // Plain JSON - try parsing directly first, then URL decode if needed
                try {
                  parsed = JSON.parse(jsonData);
                } catch (e) {
                  const decodedJson = decodeURIComponent(jsonData);
                  parsed = JSON.parse(decodedJson);
                }
              }
              
              return parsed;
            } catch (e) {
              console.warn('Failed to parse inline data URI:', e);
              return null;
            }
          }
          
          const cid = extractCid(tokenUri);
          if (cid) {
            // Detect if URI suggests a specific service (from URL format)
            const isPinataUrl = tokenUri.includes('pinata') || tokenUri.includes('gateway.pinata.cloud');
            const isWeb3StorageUrl = tokenUri.includes('w3s.link') || tokenUri.includes('web3.storage');
            
            // Try multiple IPFS gateways as fallbacks
            // Prioritize based on detected service, then try all options
            const gateways: Array<{ url: string; service: string }> = [];
            
            // Pinata gateways (try first if detected as Pinata, otherwise after Web3Storage)
            const pinataGateways = [
              { url: `https://gateway.pinata.cloud/ipfs/${cid}`, service: 'Pinata (gateway.pinata.cloud)' },
              { url: `https://${cid}.ipfs.mypinata.cloud`, service: 'Pinata (mypinata.cloud subdomain)' },
            ];
            
            // Web3Storage gateways (try first if detected as Web3Storage, otherwise try early)
            const web3StorageGateways = [
              { url: `https://${cid}.ipfs.w3s.link`, service: 'Web3Storage (w3s.link)' },
              { url: `https://w3s.link/ipfs/${cid}`, service: 'Web3Storage (w3s.link path)' },
            ];
            
            // Public IPFS gateways (fallbacks)
            const publicGateways = [
              { url: `https://ipfs.io/ipfs/${cid}`, service: 'IPFS.io' },
              { url: `https://cloudflare-ipfs.com/ipfs/${cid}`, service: 'Cloudflare IPFS' },
              { url: `https://dweb.link/ipfs/${cid}`, service: 'Protocol Labs (dweb.link)' },
              { url: `https://gateway.ipfs.io/ipfs/${cid}`, service: 'IPFS Gateway' },
            ];
            
            // Build gateway list with priority based on detection
            if (isPinataUrl) {
              // Pinata detected: try Pinata first, then Web3Storage, then public
              gateways.push(...pinataGateways, ...web3StorageGateways, ...publicGateways);
            } else if (isWeb3StorageUrl) {
              // Web3Storage detected: try Web3Storage first, then Pinata, then public
              gateways.push(...web3StorageGateways, ...pinataGateways, ...publicGateways);
            } else {
              // No detection: try Web3Storage first (most common), then Pinata, then public
              gateways.push(...web3StorageGateways, ...pinataGateways, ...publicGateways);
            }
            
            for (const { url: ipfsUrl, service } of gateways) {
              try {
                const timeoutSignal = createTimeoutSignal(timeout);
                const resp = await fetchFn(ipfsUrl, { signal: timeoutSignal });
                
                if (resp?.ok) {
                  const json = await resp.json();
                  return json ?? null;
                }
              } catch (e: any) {
                const errorMsg = e?.message || String(e);
                // Don't log timeout errors for every gateway (too noisy)
                if (!errorMsg.includes('aborted') && !errorMsg.includes('timeout')) {
                  // Continue silently - will try next gateway
                }
                // Continue to next gateway
                continue;
              }
            }
            
            console.warn(`All IPFS gateways failed for CID: ${cid}`);
          }
          
          // Try as regular HTTP/HTTPS URL
          if (/^https?:\/\//i.test(tokenUri)) {
            const timeoutSignal = createTimeoutSignal(timeout);
            const resp = await fetchFn(tokenUri, { signal: timeoutSignal });
            if (resp?.ok) return await resp.json();
          }
        } catch (e) {
          console.warn('Error fetching/parsing token URI:', e);
        }
        
        return null;
      },
      
      getUrl(cidOrTokenUri: string): string {
        const cid = extractCid(cidOrTokenUri);
        if (!cid) {
          // If it's already a full URL, return it
          if (/^https?:\/\//i.test(cidOrTokenUri)) {
            return cidOrTokenUri;
          }
          throw new Error(`Invalid CID or tokenUri: ${cidOrTokenUri}`);
        }
        return getUrlFromCid(cid);
      },
    };
  }
  
  /**
   * Default IPFS storage instance (singleton pattern)
   * Uses environment variables, defaults to Pinata
   */
  let defaultIPFSStorage: IPFSStorage | null = null;
  
  /**
   * Get or create default IPFS storage instance (singleton)
   * Initializes from environment variables, defaults to Pinata
   */
  export function getIPFSStorage(): IPFSStorage {
    if (!defaultIPFSStorage) {
      const config: IPFSConfig = {
        pinataJwt: process.env.PINATA_JWT,
        pinataApiKey: process.env.PINATA_API_KEY,
        pinataApiSecret: process.env.PINATA_API_SECRET,
        web3StorageToken: process.env.WEB3_STORAGE_TOKEN || process.env.WEB3_STORAGE_API_KEY,
        gatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs/',
        ipfsApiUrl: process.env.IPFS_API_URL,
        timeout: 10000,
      };
      
      defaultIPFSStorage = createIPFSStorage(config);
    }
    
    return defaultIPFSStorage;
  }
  
  /**
   * Check if IPFS storage is initialized
   */
  export function isIPFSStorageInitialized(): boolean {
    return defaultIPFSStorage !== null;
  }
  
  /**
   * Reset default IPFS storage instance (useful for testing)
   */
  export function resetIPFSStorage(): void {
    defaultIPFSStorage = null;
  }
  