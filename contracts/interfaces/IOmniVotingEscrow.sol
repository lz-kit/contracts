// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IVotingEscrow.sol";

interface IOmniVotingEscrow is IVotingEscrow {
    error UnknownPacketType(uint16 packetType);

    event Sync(uint16 indexed dstChainId, address indexed addr);
    event OnSync(uint16 indexed srcChainId, bytes srcAddress, uint64 indexed nonce, address indexed addr);
}
