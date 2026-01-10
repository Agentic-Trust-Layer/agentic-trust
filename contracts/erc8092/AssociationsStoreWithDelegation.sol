// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title AssociationsStoreWithDelegation
 * @notice ERC-8092 AssociationsStore with support for DELEGATED keyType
 * 
 * This contract extends the standard ERC-8092 implementation to support signatures
 * from delegated accounts (e.g., MetaMask delegation). When approverKeyType is
 * DELEGATED (0x8002), the contract validates that the approver has a valid
 * delegation to the signer.
 */
contract AssociationsStoreWithDelegation {
    /// @notice DELEGATED keyType constant (0x8002)
    /// This keyType indicates that the signature should be validated via delegation
    bytes2 public constant KEY_TYPE_DELEGATED = 0x8002;
    
    /// @notice K1/ECDSA keyType constant (0x0001)
    bytes2 public constant KEY_TYPE_K1 = 0x0001;
    
    /// @notice MetaMask DelegationManager contract address
    /// This should be set to the deployed DelegationManager contract address
    address public immutable delegationManager;
    
    /// @notice EIP-712 domain separator for AssociatedAccountRecord
    bytes32 public immutable DOMAIN_SEPARATOR;
    
    /// @notice Association records storage
    mapping(bytes32 => SignedAssociationRecord) public associations;
    
    /// @notice Signed Association Record structure
    struct SignedAssociationRecord {
        uint40 revokedAt;
        bytes2 initiatorKeyType;
        bytes2 approverKeyType;
        bytes initiatorSignature;
        bytes approverSignature;
        AssociatedAccountRecord record;
    }
    
    /// @notice Associated Account Record structure
    struct AssociatedAccountRecord {
        bytes initiator;
        bytes approver;
        uint40 validAt;
        uint40 validUntil;
        bytes4 interfaceId;
        bytes data;
    }
    
    /// @notice Error thrown when delegation validation fails
    error InvalidDelegation(address approver, address signer);
    
    /// @notice Error thrown when signature validation fails
    error InvalidSignature(bytes32 associationId);
    
    /**
     * @notice Constructor
     * @param _delegationManager Address of the MetaMask DelegationManager contract
     */
    constructor(address _delegationManager) {
        delegationManager = _delegationManager;
        
        // Compute EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version)"),
                keccak256("AssociatedAccounts"),
                keccak256("1")
            )
        );
    }
    
    /**
     * @notice Store an association record with signature validation
     * @param sar The signed association record to store
     * @return associationId The deterministic association ID (EIP-712 hash of the record)
     */
    function storeAssociation(SignedAssociationRecord calldata sar) external returns (bytes32) {
        bytes32 associationId = _hashRecord(sar.record);
        
        // Validate initiator signature
        if (!_validateSignature(
            sar.record.initiator,
            associationId,
            sar.initiatorSignature,
            sar.initiatorKeyType
        )) {
            revert InvalidSignature(associationId);
        }
        
        // Validate approver signature
        if (!_validateApproverSignature(
            sar.record.approver,
            associationId,
            sar.approverSignature,
            sar.approverKeyType
        )) {
            revert InvalidSignature(associationId);
        }
        
        // Check if association already exists
        require(associations[associationId].revokedAt == 0, "Association already exists");
        
        // Store the association
        associations[associationId] = sar;
        
        return associationId;
    }
    
    /**
     * @notice Validate approver signature with support for DELEGATED keyType and delegation-aware K1
     * @param approver The approver address (ERC-7930 format)
     * @param digest The message digest to validate
     * @param signature The signature bytes
     * @param keyType The key type (0x0001 for K1, 0x8002 for DELEGATED)
     * @return valid True if signature is valid
     */
    function _validateApproverSignature(
        bytes calldata approver,
        bytes32 digest,
        bytes calldata signature,
        bytes2 keyType
    ) internal view returns (bool) {
        if (keyType == KEY_TYPE_DELEGATED) {
            return _validateDelegatedSignature(approver, digest, signature);
        } else if (keyType == KEY_TYPE_K1) {
            // First try standard ERC-1271 validation
            bool standardValidation = _validateK1Signature(approver, digest, signature);
            if (standardValidation) {
                return true;
            }
            
            // If standard validation fails, check delegation chain
            // This handles the case where:
            // - Approver (agentAccount) delegates to a smart account (sessionAA)
            // - Signer (operatorAddress) owns the delegated smart account
            // - The validator doesn't automatically check ownership
            return _validateK1WithDelegation(approver, digest, signature);
        } else {
            return false;
        }
    }
    
    /**
     * @notice Validate signature for DELEGATED keyType
     * @param approver The approver address (ERC-7930 format)
     * @param digest The message digest to validate
     * @param signature The signature bytes (from delegated signer)
     * @return valid True if delegation is valid and signature is correct
     */
    function _validateDelegatedSignature(
        bytes calldata approver,
        bytes32 digest,
        bytes calldata signature
    ) internal view returns (bool) {
        // Extract signer address from signature using ecrecover
        address signer = SignatureChecker.recover(digest, signature);
        
        // Resolve approver address from ERC-7930 format
        address approverAddress = _resolveEvmAddress(approver);
        
        // Check if approver has a valid delegation to signer
        // This queries the MetaMask DelegationManager contract
        return _hasValidDelegation(approverAddress, signer);
    }
    
    /**
     * @notice Validate signature for K1/ECDSA keyType using OpenZeppelin SignatureChecker
     * @param account The account address (ERC-7930 format)
     * @param digest The message digest to validate
     * @param signature The signature bytes
     * @return valid True if signature is valid
     */
    function _validateK1Signature(
        bytes calldata account,
        bytes32 digest,
        bytes calldata signature
    ) internal view returns (bool) {
        address accountAddress = _resolveEvmAddress(account);
        return SignatureChecker.isValidSignatureNow(accountAddress, digest, signature);
    }
    
    /**
     * @notice Validate K1 signature with delegation chain checking
     * This handles cases where the approver (delegator) has delegated to a smart account,
     * and the signer owns that delegated smart account. The standard ERC-1271 validator
     * may not automatically check ownership, so we check it here.
     * 
     * Flow:
     * 1. Extract signer from signature
     * 2. Check if approver delegates to any smart account
     * 3. Check if signer owns any of those delegated smart accounts
     * 4. If yes, validate signature using that smart account's ERC-1271
     * 
     * @param approver The approver address (ERC-7930 format) - the delegator
     * @param digest The message digest to validate
     * @param signature The signature bytes (from the signer EOA)
     * @return valid True if signature is valid through delegation chain
     */
    function _validateK1WithDelegation(
        bytes calldata approver,
        bytes32 digest,
        bytes calldata signature
    ) internal view returns (bool) {
        address approverAddress = _resolveEvmAddress(approver);
        
        // Extract signer from signature
        address signer;
        try SignatureChecker.recover(digest, signature) returns (address recovered) {
            signer = recovered;
        } catch {
            return false;
        }
        
        // Check if approver is a contract (has code)
        // If not, delegation-aware validation doesn't apply
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(approverAddress)
        }
        if (codeSize == 0) {
            return false; // Approver is an EOA, no delegation to check
        }
        
        // Try to find delegations from approver to smart accounts
        // We'll check common delegation patterns:
        // 1. Check if approver delegates to a smart account owned by signer
        // 2. For MetaMask delegations, we might need to check DelegationManager
        
        // Approach: Try checking if any smart account owned by signer validates the signature
        // and if there's a delegation from approver to that account
        
        // For now, we'll use a simplified approach:
        // - Check if the signer's signature is valid for any account they own
        // - Check if approver has a delegation to that account
        // 
        // However, we don't know all possible delegated accounts, so we'll try a different approach:
        // Check if signer is an EOA and validate directly if delegation exists
        
        // Since we can't easily enumerate all delegations, we'll check:
        // 1. If signer is an EOA (which it should be in our use case)
        // 2. Try to find if approver delegates to a smart account
        // 3. Check if that smart account's owner is the signer
        // 4. If yes, validate signature using that smart account's ERC-1271
        
        // For MetaMask smart accounts, we can check if there's a delegation
        // from approver to a smart account owned by signer
        // This is a simplified check - in production, you might need to query DelegationManager
        
        // Try checking DelegationManager for delegations from approver
        // If we find a delegation to an account owned by signer, validate using that account
        (bool hasDelegation, address delegate) = _findDelegationToSignerAccount(approverAddress, signer);
        
        if (hasDelegation && delegate != address(0)) {
            // Found a delegation from approver to an account owned by signer
            // Validate signature using that delegated account's ERC-1271
            return SignatureChecker.isValidSignatureNow(delegate, digest, signature);
        }
        
        return false;
    }
    
    /**
     * @notice Find if approver delegates to an account owned by signer
     * @param approver The delegator address  
     * @param signer The signer (potential owner of delegate)
     * @return found True if delegation found
     * @return delegate The delegated account address (if found)
     * 
     * This function tries multiple strategies to find delegations:
     * 1. Query DelegationManager using common interface patterns
     * 2. Check if signer is an EOA and validate signature directly
     * 3. For MetaMask smart accounts, check if approver has delegations
     * 
     * NOTE: This implementation tries common DelegationManager patterns.
     * You may need to adjust based on the actual DelegationManager interface.
     */
    function _findDelegationToSignerAccount(
        address approver,
        address signer
    ) internal view returns (bool found, address delegate) {
        // Check if signer is an EOA (no code)
        uint256 signerCodeSize;
        assembly {
            signerCodeSize := extcodesize(signer)
        }
        
        if (signerCodeSize != 0) {
            // Signer is a contract, not an EOA - delegation ownership check doesn't apply
            return (false, address(0));
        }
        
        // Try to query DelegationManager for delegations from approver
        // Common DelegationManager interface patterns:
        
        // Pattern 1: getDelegations(delegator) returns (address[] delegates)
        (bool success1, bytes memory data1) = delegationManager.staticcall(
            abi.encodeWithSignature("getDelegations(address)", approver)
        );
        
        if (success1 && data1.length > 0) {
            try this.decodeDelegationsArray(data1) returns (address[] memory delegates) {
                // Check each delegate to see if signer owns it
                for (uint i = 0; i < delegates.length; i++) {
                    address potentialDelegate = delegates[i];
                    if (potentialDelegate != address(0)) {
                        // Check if signer owns this delegate (check owner() function)
                        address owner = _getAccountOwner(potentialDelegate);
                        if (owner == signer) {
                            return (true, potentialDelegate);
                        }
                    }
                }
            } catch {
                // Decoding failed, try next pattern
            }
        }
        
        // Pattern 2: hasDelegation(delegator, delegate) returns (bool)
        // Since we don't know all possible delegates, we can't use this directly
        // But if we had a registry of possible delegates, we could check them
        
        // Pattern 3: For MetaMask smart accounts, delegations might be stored in the smart account itself
        // We could check the smart account's storage, but this is complex and implementation-dependent
        
        return (false, address(0));
    }
    
    /**
     * @notice Helper function to decode delegations array (must be external for try-catch)
     * @param data The encoded array data
     * @return delegates Array of delegate addresses
     */
    function decodeDelegationsArray(bytes memory data) external pure returns (address[] memory delegates) {
        return abi.decode(data, (address[]));
    }
    
    /**
     * @notice Get the owner of an account (smart account or EOA)
     * @param account The account to check
     * @return owner The owner address, or address(0) if not found or account is an EOA
     */
    function _getAccountOwner(address account) internal view returns (address owner) {
        // Check if account has an owner() function (common in smart accounts)
        (bool success, bytes memory data) = account.staticcall(
            abi.encodeWithSignature("owner()")
        );
        
        if (success && data.length >= 32) {
            owner = abi.decode(data, (address));
        } else {
            // Account might not have owner() function, or it's an EOA
            owner = address(0);
        }
        
        // If owner is still 0, check if account is an EOA
        // (EOAs don't have owners, so if it's a contract without owner, return 0)
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(account)
        }
        
        if (codeSize == 0 && owner == address(0)) {
            // Account is an EOA, so it's its own "owner"
            return account;
        }
        
        return owner;
    }
    
    /**
     * @notice Validate initiator signature (always uses K1)
     * @param initiator The initiator address (ERC-7930 format)
     * @param digest The message digest to validate
     * @param signature The signature bytes
     * @param keyType The key type (should be 0x0001 for K1)
     * @return valid True if signature is valid
     */
    function _validateSignature(
        bytes calldata initiator,
        bytes32 digest,
        bytes calldata signature,
        bytes2 keyType
    ) internal view returns (bool) {
        if (keyType != KEY_TYPE_K1) {
            return false;
        }
        return _validateK1Signature(initiator, digest, signature);
    }
    
    /**
     * @notice Check if approver has a valid delegation to signer
     * @param approver The approver (delegator) address
     * @param signer The signer (delegatee) address
     * @return valid True if delegation exists and is valid
     * 
     * NOTE: This implementation needs to be adjusted based on the actual
     * MetaMask DelegationManager contract interface. The DelegationManager
     * may use a different method to check delegations, such as:
     * - Checking delegation hashes stored in a mapping
     * - Validating delegation signatures on-chain
     * - Using a registry of active delegations
     * 
     * For now, this is a placeholder that should be updated with the
     * actual DelegationManager ABI and validation logic.
     */
    function _hasValidDelegation(
        address approver,
        address signer
    ) internal view returns (bool) {
        // Option 1: If DelegationManager has a mapping of delegations
        // (bool success, bytes memory data) = delegationManager.staticcall(
        //     abi.encodeWithSignature(
        //         "getDelegation(address,address)",
        //         approver,
        //         signer
        //     )
        // );
        // if (success && data.length > 0) {
        //     // Check if delegation exists and is valid
        //     return true;
        // }
        
        // Option 2: If DelegationManager validates delegation signatures
        // We would need to pass the delegation message and signature
        // and validate it on-chain
        
        // Option 3: For now, we'll use a simple interface check
        // This should be replaced with the actual DelegationManager interface
        (bool success, bytes memory data) = delegationManager.staticcall(
            abi.encodeWithSignature(
                "hasDelegation(address,address)",
                approver,
                signer
            )
        );
        
        if (!success || data.length == 0) {
            return false;
        }
        
        // Decode boolean result
        bool hasDelegation = abi.decode(data, (bool));
        
        // Additional checks could include:
        // - Delegation is not expired
        // - Delegation scope allows the operation
        // - Delegation has not been revoked
        
        return hasDelegation;
    }
    
    /**
     * @notice Resolve EVM address from ERC-7930 interoperable address format
     * @param account The ERC-7930 formatted address
     * @return addr The resolved EVM address
     */
    function _resolveEvmAddress(bytes calldata account) internal pure returns (address) {
        // ERC-7930 format: 0x0001 + chainId (3 bytes) + address (20 bytes)
        // For EVM v1, the format is: 0x0001 + chainId (3 bytes) + address (20 bytes)
        require(account.length >= 24, "Invalid ERC-7930 address format");
        require(bytes2(account[0:2]) == 0x0001, "Unsupported address format");
        
        // Extract address (last 20 bytes)
        address addr;
        assembly {
            addr := calldataload(add(account.offset, 4))
            addr := shr(96, addr) // Shift right to get 20 bytes
        }
        return addr;
    }
    
    /**
     * @notice Compute EIP-712 hash of an AssociatedAccountRecord
     * @param record The record to hash
     * @return hash The EIP-712 hash
     */
    function _hashRecord(AssociatedAccountRecord calldata record) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "AssociatedAccountRecord(bytes initiator,bytes approver,uint40 validAt,uint40 validUntil,bytes4 interfaceId,bytes data)"
                ),
                keccak256(record.initiator),
                keccak256(record.approver),
                record.validAt,
                record.validUntil,
                record.interfaceId,
                keccak256(record.data)
            )
        );
        
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash))
        );
    }
    
    /**
     * @notice Revoke an association
     * @param associationId The association ID to revoke
     * @param revokedAt The timestamp when revoked
     */
    function revokeAssociation(bytes32 associationId, uint40 revokedAt) external {
        require(associations[associationId].revokedAt == 0, "Association not found or already revoked");
        associations[associationId].revokedAt = revokedAt;
    }
    
    /**
     * @notice Get associations for an account
     * @param account The account to query (ERC-7930 format)
     * @return sars Array of signed association records
     */
    function getAssociationsForAccount(bytes calldata account) external view returns (SignedAssociationRecord[] memory sars) {
        // Implementation depends on storage structure
        // This is a placeholder - adjust based on actual storage pattern
        revert("Not implemented");
    }
}

