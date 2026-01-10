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
     * @notice Validate approver signature with support for DELEGATED keyType
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
            return _validateK1Signature(approver, digest, signature);
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

