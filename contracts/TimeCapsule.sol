// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract TimeCapsule {
    struct Capsule {
        address creator;
        string title;
        string tags;
        bytes encryptedStory;    // Shutter-encrypted story ciphertext
        string decryptedStory;   // Plaintext story (after reveal)
        bool isRevealed;
        uint256 revealTime;      // Timestamp after which reveal is allowed
        string shutterIdentity;  // Shutter identity used for encryption
        string imageCID;         // IPFS CID of the encrypted image
        string pixelatedImageCID; // IPFS CID of the pixelated preview image
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

    mapping(uint256 => Capsule) public capsules;
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
        string pixelatedImageCID
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

        // Store the capsule data on-chain
        capsules[capsuleCount] = Capsule({
            creator: msg.sender,
            title: data.title,
            tags: data.tags,
            encryptedStory: data.encryptedStory,
            decryptedStory: "",
            isRevealed: false,
            revealTime: data.revealTime,
            shutterIdentity: data.shutterIdentity,
            imageCID: data.imageCID,
            pixelatedImageCID: data.pixelatedImageCID
        });
        emit CapsuleCreated(capsuleCount, msg.sender, data.title, data.tags, data.revealTime, data.shutterIdentity, data.imageCID, data.pixelatedImageCID);
        capsuleCount++;
    }

    /**
     * @dev Reveal the capsule's story after the Shutter network has released the decryption key.
     * @param _id The capsule ID to reveal.
     * @param _plaintext The decrypted story text.
     */
    function revealCapsule(uint256 _id, string calldata _plaintext) external {
        Capsule storage c = capsules[_id];
        require(!c.isRevealed, "Capsule already revealed");
        require(block.timestamp >= c.revealTime, "Too early to reveal");  // Ensure one-year time lock elapsed

        c.decryptedStory = _plaintext;
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

    // (Optional) a helper to retrieve capsule data in one go
    function getCapsule(uint256 _id) external view returns (Capsule memory) {
        return capsules[_id];
    }
}
