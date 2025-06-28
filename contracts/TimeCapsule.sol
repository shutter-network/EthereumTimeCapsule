// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract TimeCapsule {
    // Minimal struct for on-chain storage - only what's needed for validation
    struct CapsuleState {
        bool isRevealed;
        uint256 revealTime;      // Timestamp after which reveal is allowed
    }

    struct CapsuleData {
        string title;
        string tags;
        bytes encryptedStory;
        uint256 revealTime;
        string shutterIdentity;
        string imageCID;
        string pixelatedImageCID;
    }

    mapping(uint256 => CapsuleState) public capsules;
    uint256 public capsuleCount;

    // Fee configuration
    uint256 public constant COMMIT_FEE = 0.001 ether;
    address public beneficiary;

    event CapsuleCreated(
        uint256 indexed id,
        address indexed creator,
        string title,
        string tags,
        uint256 revealTime,
        string shutterIdentity,
        string imageCID,
        string pixelatedImageCID,
        bytes encryptedStory
    );
    event CapsuleRevealed(
        uint256 indexed id,
        address indexed revealer,
        string plaintextStory
    );
    event FeeWithdrawn(address indexed beneficiary, address indexed to, uint256 amount);

    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "Only beneficiary can call this function");
        _;
    }

    constructor(address _beneficiary) {
        require(_beneficiary != address(0), "Beneficiary cannot be zero address");
        beneficiary = _beneficiary;
    }

    /**
     * @dev Commit a new time capsule with encrypted content.
     * @param data Struct containing all capsule data (title, tags, encryptedStory, revealTime, shutterIdentity, imageCID, pixelatedImageCID).
     */
    function commitCapsule(CapsuleData calldata data)
        external
        payable
    {
        require(msg.value == COMMIT_FEE, "Must pay exactly 0.001 ether to commit a capsule");
        require(data.revealTime > block.timestamp, "Reveal time must be in the future");
        // (Optional) enforce roughly one-year lockup:
        // require(data.revealTime >= block.timestamp + 365 days, "Reveal time must be ~1 year out");

        // Store only minimal state needed for validation - all data is in events
        capsules[capsuleCount] = CapsuleState({
            isRevealed: false,
            revealTime: data.revealTime
        });
        
        emit CapsuleCreated(capsuleCount, msg.sender, data.title, data.tags, data.revealTime, data.shutterIdentity, data.imageCID, data.pixelatedImageCID, data.encryptedStory);
        capsuleCount++;
    }

    /**
     * @dev Reveal the capsule's story after the Shutter network has released the decryption key.
     * @param _id The capsule ID to reveal.
     * @param _plaintext The decrypted story text.
     */
    function revealCapsule(uint256 _id, string calldata _plaintext) external {
        CapsuleState storage c = capsules[_id];
        require(!c.isRevealed, "Capsule already revealed");
        require(block.timestamp >= c.revealTime, "Too early to reveal");  // Ensure time lock elapsed

        c.isRevealed = true;
        emit CapsuleRevealed(_id, msg.sender, _plaintext);
    }

    /**
     * @dev Withdraw collected fees. Only callable by the beneficiary.
     * @param to The address to send the withdrawn fees to.
     */
    function withdrawFees(address to) external onlyBeneficiary {
        require(to != address(0), "Cannot withdraw to zero address");
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        (bool success, ) = payable(to).call{value: balance}("");
        require(success, "Failed to withdraw fees");

        emit FeeWithdrawn(beneficiary, to, balance);
    }

    /**
     * @dev Get the minimal capsule state (for validation purposes)
     * @param _id The capsule ID to query
     * @return The capsule state containing isRevealed, revealTime, and creator
     */
    function getCapsuleState(uint256 _id) external view returns (CapsuleState memory) {
        return capsules[_id];
    }
    
    /**
     * @dev Check if a capsule can be revealed
     * @param _id The capsule ID to check
     * @return Whether the capsule can be revealed (time has passed and not already revealed)
     */
    function canReveal(uint256 _id) external view returns (bool) {
        CapsuleState storage c = capsules[_id];
        return !c.isRevealed && block.timestamp >= c.revealTime;
    }
}
