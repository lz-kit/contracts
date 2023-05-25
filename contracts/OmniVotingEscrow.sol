// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";
import "./interfaces/IOmniVotingEscrow.sol";
import "./VotingEscrow.sol";

/**
 * @title Omni Voting Escrow
 * @author LevX (team@levx.io)
 * @notice Voting Escrow with cross-chain support
 * @dev If `token` is not address(0), this chain is the 'base chain' where VotingEscrow can be minted.
 *  Other chains can only receive balance info from the base chain.
 */

contract OmniVotingEscrow is NonblockingLzApp, VotingEscrow, IOmniVotingEscrow {
    // packet type
    uint16 internal constant PT_SYNC = 0;

    uint16 public immutable baseChainId;

    mapping(uint16 => uint256) public epochSynced;
    mapping(uint16 => mapping(address => uint256)) public userPointEpochSynced;

    constructor(
        address _token,
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint16 _baseChainId
    ) NonblockingLzApp(_lzEndpoint) VotingEscrow(_token, _name, _symbol) {
        baseChainId = _baseChainId;
    }

    modifier onlyBaseChain() {
        if (token == address(0)) revert Unsupported();
        _;
    }

    function _checkpoint(
        address addr,
        LockedBalance memory old_locked,
        LockedBalance memory new_locked
    ) internal override onlyBaseChain {
        super._checkpoint(addr, old_locked, new_locked);
    }

    function estimateFee_SYNC(
        uint16 dstChainId,
        address addr,
        uint256 gasForCall,
        uint256 nativeAmount,
        address nativeAddress
    ) public view virtual returns (uint256 fee) {
        bytes memory adapterParams = abi.encodePacked(uint16(2), gasForCall, nativeAmount, nativeAddress);
        _checkGasLimit(dstChainId, PT_SYNC, adapterParams, 0);

        (fee, ) = lzEndpoint.estimateFees(
            dstChainId,
            address(this),
            abi.encodePacked(PT_SYNC, addr, _buildParams(dstChainId, addr)),
            false,
            adapterParams
        );
    }

    function sync(
        uint16 dstChainId,
        address addr,
        address payable refundAddress,
        uint256 gasForCall,
        uint256 nativeAmount,
        address nativeAddress
    ) external payable onlyBaseChain {
        bytes memory adapterParams = abi.encodePacked(uint16(2), gasForCall, nativeAmount, nativeAddress);
        _checkGasLimit(dstChainId, PT_SYNC, adapterParams, 0);

        bytes memory params = _buildParams(dstChainId, addr);
        epochSynced[dstChainId] = epoch;
        userPointEpochSynced[dstChainId][addr] = userPointEpoch[addr];

        _lzSend(dstChainId, abi.encode(PT_SYNC, addr, params), refundAddress, address(0), adapterParams, msg.value);

        emit Sync(dstChainId, addr);
    }

    function _buildParams(uint16 dstChainId, address addr) internal view returns (bytes memory) {
        Point[] memory points;
        uint256 _epochSynced = epochSynced[dstChainId];
        if (_epochSynced < epoch) {
            points = new Point[](epoch - _epochSynced);
            for (uint256 i; i < epoch - _epochSynced; ) {
                points[i] = pointHistory[_epochSynced + i + 1];
                unchecked {
                    ++i;
                }
            }
        }
        Point[] memory userPoints;
        int128[] memory _slopeChanges;
        uint256 userEpoch = userPointEpoch[addr];
        uint256 _userEpochSynced = userPointEpochSynced[dstChainId][addr];
        if (_userEpochSynced < userEpoch) {
            userPoints = new Point[](userEpoch - _userEpochSynced);
            _slopeChanges = new int128[](userEpoch - _userEpochSynced);
            for (uint256 i; i < userEpoch - _userEpochSynced; ) {
                userPoints[i] = userPointHistory[addr][_userEpochSynced + i + 1];
                _slopeChanges[i] = slopeChanges[userPoints[i].ts];
                unchecked {
                    ++i;
                }
            }
        }
        return abi.encode(points, userPoints, _slopeChanges, locked[addr]);
    }

    function _nonblockingLzReceive(
        uint16 srcChainId,
        bytes memory srcAddress,
        uint64 nonce,
        bytes memory payload
    ) internal override {
        (uint16 packetType, address addr, bytes memory params) = abi.decode(payload, (uint16, address, bytes));

        if (packetType == PT_SYNC) {
            // do not sync on base chain
            if (srcChainId == baseChainId && token == address(0)) {
                _onSync(addr, params);
                emit OnSync(srcChainId, srcAddress, nonce, addr);
            }
        } else {
            revert UnknownPacketType(packetType);
        }
    }

    function _onSync(address addr, bytes memory params) internal {
        (
            Point[] memory points,
            Point[] memory userPoints,
            int128[] memory _slopeChanges,
            LockedBalance memory _locked
        ) = abi.decode(params, (Point[], Point[], int128[], LockedBalance));
        // update pointHistory and epoch
        uint256 _epoch = epoch;
        for (uint256 i; i < points.length; ) {
            pointHistory[_epoch + i + 1] = points[i];
            unchecked {
                ++i;
            }
        }
        epoch = _epoch + points.length;
        // update userPointHistory, userPointEpoch and slopeChanges
        uint256 userEpoch = userPointEpoch[addr];
        for (uint256 i; i < userPoints.length; ) {
            userPointHistory[addr][userEpoch + i + 1] = userPoints[i];
            slopeChanges[userPoints[i].ts] = _slopeChanges[i];
            unchecked {
                ++i;
            }
        }
        userPointEpoch[addr] = userEpoch + userPoints.length;
        // update locked
        locked[addr] = _locked;
    }
}
